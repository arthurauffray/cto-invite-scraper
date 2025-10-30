require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');

class CTOInviteScraper {
    constructor() {
        this.client = new Client();
        
        // Parse channel IDs from environment variable (comma-separated)
        // Default to official CTO.new channels if not specified
        const defaultChannels = '1428387946293362789,1427788039144341584,1427787585052344372';
        const channelIdsString = process.env.CHANNEL_IDS || defaultChannels;
        this.targetChannelIds = channelIdsString.split(',').map(id => id.trim());
        
        // Channel names for display (will be fetched from Discord)
        this.channelNames = {};
        
        this.ctoApiUrl = 'https://api.enginelabs.ai/invites/redeem';
        this.inviteCodePattern = /\b[a-z0-9]{12}\b/gi;
        this.processedCodes = new Set(); // Track already processed codes
        this.totalProcessed = 0;
        this.successCount = 0;
        this.invalidCount = 0;
        this.alreadyRedeemedCount = 0;
        this.authErrorCount = 0;
        this.rateLimitCount = 0;
        
        // Token management and retry system
        this.tokenValid = false; // Unknown until first health check
        this.retryQueue = [];
        this.isRetrying = false;
        this.lastTokenTest = Date.now();
        this.tokenTestInterval = 1 * 60 * 1000; // Test every 1 minutes (randomized)
        this.maxRetries = 3;
        this.retryDelay = 5000; // Start with 5 seconds
        
        // CTO token refresh (Clerk session management)
        this.clerkSessionId = null;
        this.clerkSessionUrl = null;
        this.lastTokenRefresh = Date.now();
        this.tokenRefreshInterval = 15 * 1000; // Refresh every 15 seconds
        this.isRefreshingToken = false; // Prevent concurrent refreshes

        // Abacus metrics
        const ABACUS_BASE = 'https://abacus.jasoncameron.dev';
        const ABACUS_PROJECT = 'cto-invite-scraper';
        this.metrics = {
            installsUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/installs`,
            redeemsUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/redeems`,
            activeUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/active`,
        };
        this.metricsEnabled = process.env.ABACUS_OPTOUT !== 'true';

        // Notification routing
        this.notify = {
            mode: (process.env.NOTIFY_MODE || 'none').toLowerCase(), // webhook | channel | dm | none
            webhookUrl: process.env.NOTIFY_WEBHOOK_URL || null,
            channelId: process.env.NOTIFY_CHANNEL_ID || null,
            dmUserId: process.env.NOTIFY_DM_USER_ID || null,
            pingUserId: process.env.NOTIFY_PING_USER_ID || null,
        };
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            console.clear(); // Clear console for a clean start
            const w = 50;
            console.log('\n╔' + '═'.repeat(w) + '╗');
            console.log('║  🤖 CTO.new Invite Scraper Bot v2.1' + ' '.repeat(14) + '║');
            console.log('╚' + '═'.repeat(w) + '╝');
            console.log(`✅ Logged in as: \x1b[36m${this.client.user.tag}\x1b[0m`);
            console.log(`📡 Monitoring channels:`);
            
            // Fetch channel names from Discord
            for (const id of this.targetChannelIds) {
                try {
                    const channel = await this.client.channels.fetch(id);
                    this.channelNames[id] = channel.name || 'Unknown';
                    console.log(`   • ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m`);
                } catch (error) {
                    this.channelNames[id] = 'Unknown Channel';
                    console.log(`   • ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m \x1b[91m[Error]\x1b[0m`);
                }
            }
            
            // Show support message on first run
            if (this.isFirstRun) {
                const w = 50;
                console.log('\n┌' + '─'.repeat(w) + '┐');
                console.log('│ 💙 Thanks for trying CTO Invite Scraper! 💙' + ' '.repeat(6) + '│');
                console.log('│' + ' '.repeat(w) + '│');
                console.log('│ This took hours to build and is free.' + ' '.repeat(12) + '│');
                console.log('│ If it helps you, please consider:' + ' '.repeat(16) + '│');
                console.log('│' + ' '.repeat(w) + '│');
                console.log('│   ⭐ Star on GitHub' + ' '.repeat(30) + '│');
                console.log('│   👤 Follow for more tools' + ' '.repeat(23) + '│');
                console.log('│' + ' '.repeat(w) + '│');
                console.log('│ It takes 2 seconds and helps the project!' + ' '.repeat(8) + '│');
                console.log('└' + '─'.repeat(w) + '┘');
                console.log('\x1b[90m⭐ https://github.com/arthurauffray/cto-invite-scraper\x1b[0m');
                console.log('\x1b[90m👤 https://github.com/arthurauffray\x1b[0m');
                console.log('');
                
                // Open URLs in browser
                const { exec } = require('child_process');
                const open = (url) => {
                    const command = process.platform === 'darwin' ? 'open' : 
                                  process.platform === 'win32' ? 'start' : 'xdg-open';
                    exec(`${command} ${url}`);
                };
                
                // Open repo page (where they can star)
                open('https://github.com/arthurauffray/cto-invite-scraper');
                await this.sleep(2000);
                
                // Open profile page (where they can follow)
                open('https://github.com/arthurauffray');
                
                // Give user 8 seconds to see the message and pages to load
                await this.sleep(8000);
            }
            
            // Start automatic token refresh FIRST (so we have a fresh token)
            await this.startTokenRefresh();
            
            // Check if user is on the waitlist
            await this.checkWaitlistStatus();
            
            // Then run token health check with the fresh token
            await this.startTokenMonitoring();
            
            console.log('\n\x1b[92m🎯 Bot is ready and watching for invite codes...\x1b[0m');
            console.log('\x1b[90m🛡️  Anti-obfuscation enabled\x1b[0m\n');
            
            // Start status display
            this.startStatusDisplay();

            // Metrics: count install and start active heartbeat
            if (this.metricsEnabled) {
                if (this.isFirstRun) {
                    this.pingMetric('installs');
                    this.markAsInstalled();
                }
                this.startActiveHeartbeat();
            }
        });

        this.client.on('messageCreate', async (message) => {
            // Only process messages from target channels
            if (!this.targetChannelIds.includes(message.channel.id)) {
                return;
            }

            // Don't process own messages
            if (message.author.id === this.client.user.id) {
                return;
            }

            const channelName = this.channelNames[message.channel.id];
            this.logMessage(`📥 New message in \x1b[33m${channelName}\x1b[0m`, `\x1b[36m${message.author.tag}\x1b[0m: ${this.truncateMessage(message.content)}`);
            
            await this.processMessage(message);
        });

        this.client.on('error', (error) => {
            this.logError('Discord client error:', error);
        });
    }

    async processMessage(message) {
        // Extract potential invite codes from the message
        const inviteCodes = this.extractInviteCodes(message.content);
        
        if (inviteCodes.length === 0) {
            this.logInfo('🔍 No invite codes detected in message');
            return;
        }

        this.logSuccess(`🎯 Found ${inviteCodes.length} potential invite code(s):`, `\x1b[93m${inviteCodes.join(', ')}\x1b[0m`);

        // Try to redeem each code (pass message timestamp for time-to-scrape calculation)
        for (const code of inviteCodes) {
            if (!this.processedCodes.has(code)) {
                await this.tryRedeemCodeWithRetry(code, message.createdTimestamp);
                this.processedCodes.add(code);
                this.totalProcessed++;
                
                // Add a small delay between redemption attempts
                await this.sleep(1000);
            } else {
                this.logWarning(`⏭️  Code \x1b[90m${code}\x1b[0m already processed, skipping`);
            }
        }
        
        console.log('\n' + '\x1b[90m' + '─'.repeat(50) + '\x1b[0m\n');
    }

    extractInviteCodes(text) {
        if (!text) return [];

        // Look for explicit removal instructions like "remove the X" or "delete X"
        const removalPatterns = [
            /remove\s+(?:the\s+)?([^\s\w]+)/gi,
            /delete\s+(?:the\s+)?([^\s\w]+)/gi,
            /take\s+out\s+(?:the\s+)?([^\s\w]+)/gi,
            /without\s+(?:the\s+)?([^\s\w]+)/gi
        ];
        
        let charsToRemove = new Set();
        for (const pattern of removalPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                // Extract the character(s) to remove
                const chars = match[1];
                for (const char of chars) {
                    charsToRemove.add(char);
                }
            }
        }

        // Aggressively normalize to defeat obfuscation
        let normalized = text
            .toLowerCase()
            // Remove zero-width and invisible chars
            .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
            // Remove Discord markdown: spoilers ||text||, code `text`, bold **text**, italic *text*
            .replace(/\|\|([^|]+)\|\|/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            // Unicode normalize (NFD then remove combining marks, then NFC)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .normalize('NFC');

        // Remove explicitly mentioned characters
        if (charsToRemove.size > 0) {
            const removeRegex = new RegExp(`[${Array.from(charsToRemove).map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}]`, 'gi');
            normalized = normalized.replace(removeRegex, '');
        }

        // Homoglyph/confusable mapping: common lookalike substitutions
        const homoglyphMap = {
            // Cyrillic lookalikes
            'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
            // Greek lookalikes
            'α': 'a', 'β': 'b', 'ε': 'e', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'y',
            // Common number/letter confusables
            'Ο': 'o', 'ο': 'o', 'О': 'o', 'о': 'o', // various O's
            'Α': 'a', 'А': 'a', // various A's
            'Ε': 'e', 'Е': 'e', // various E's
            'Ι': 'i', 'І': 'i', // various I's
            'Ν': 'n', 'Ν': 'n', // various N's
            '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
            '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', // fullwidth digits
            // More confusables
            'ⅰ': 'i', 'ⅱ': 'ii', 'ⅲ': 'iii', 'ⅳ': 'iv', 'ⅴ': 'v',
            'ℓ': 'l', 'ｌ': 'l', // fancy l's
        };

        // Apply homoglyph replacements
        for (const [fake, real] of Object.entries(homoglyphMap)) {
            normalized = normalized.replace(new RegExp(fake, 'g'), real);
        }

        const candidates = new Set();

        // Helper validator: exactly 12 chars, alphanumeric, contains both letters and digits
        const isValidCode = (s) => /^[a-z0-9]{12}$/.test(s) && /[a-z]/.test(s) && /\d/.test(s);

        // 1) Direct 12-char matches
        (normalized.match(/\b[a-z0-9]{12}\b/g) || []).forEach(m => {
            if (isValidCode(m)) candidates.add(m);
        });

        // 2) Spaced/obfuscated groups consisting of only letters/digits and spaces
        //    Collapse spaces and check for 12-char codes
        (normalized.match(/[a-z0-9][a-z0-9\s]{10,40}/g) || []).forEach(seg => {
            const compact = seg.replace(/\s+/g, '');
            if (isValidCode(compact)) candidates.add(compact);
        });

        // 3) Line-wise check: remove non-alphanumerics per line and test
        normalized.split(/\n+/).forEach(line => {
            const compact = line.replace(/[^a-z0-9]/g, '');
            if (isValidCode(compact)) candidates.add(compact);
        });

        // 4) Token merge: join adjacent alnum tokens until length >= 12, then test
        const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
            let acc = tokens[i];
            if (acc.length === 12 && isValidCode(acc)) {
                candidates.add(acc);
                continue;
            }
            for (let j = i + 1; j < tokens.length && acc.length < 12; j++) {
                acc += tokens[j];
                if (acc.length === 12 && isValidCode(acc)) {
                    candidates.add(acc);
                }
            }
        }

        // 5) Aggressive: strip ALL non-alphanumeric from entire text and scan for 12-char substrings
        const fullyCompact = normalized.replace(/[^a-z0-9]/g, '');
        for (let i = 0; i <= fullyCompact.length - 12; i++) {
            const sub = fullyCompact.substring(i, i + 12);
            if (isValidCode(sub)) candidates.add(sub);
        }

        return Array.from(candidates);
    }

    async tryRedeemCodeWithRetry(inviteCode, messageTimestamp, retryCount = 0) {
        const result = await this.tryRedeemCode(inviteCode, messageTimestamp);
        
        // If auth error and we haven't exceeded max retries
        if (result.shouldRetry && retryCount < this.maxRetries) {
            this.logWarning(`🔄 Queueing \x1b[93m${inviteCode}\x1b[0m for retry (attempt ${retryCount + 1}/${this.maxRetries})`);
            
            // Add to retry queue if not already there
            if (!this.retryQueue.find(item => item.code === inviteCode)) {
                this.retryQueue.push({
                    code: inviteCode,
                    retryCount: retryCount + 1,
                    timestamp: Date.now(),
                    messageTimestamp: messageTimestamp
                });
            }
            
            // Start retry processing if not already running
            if (!this.isRetrying) {
                this.processRetryQueue();
            }
        }
        
        return result;
    }

    async tryRedeemCode(inviteCode, messageTimestamp) {
        this.logInfo(`🔄 Attempting to redeem code: \x1b[93m${inviteCode}\x1b[0m`);
        
        // Calculate time-to-scrape: time from message sent to request sent
        const requestSentTime = Date.now();
        const timeToScrape = messageTimestamp ? requestSentTime - messageTimestamp : null;
        
        try {
            const response = await axios.post(this.ctoApiUrl, {
                inviteCode: inviteCode
            }, {
                headers: {
                    'accept': 'application/json',
                    'accept-language': 'en,en-US;q=0.9',
                    'authorization': `Bearer ${process.env.CTO_AUTH_TOKEN}`,
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'dnt': '1',
                    'origin': 'https://cto.new',
                    'pragma': 'no-cache',
                    'priority': 'u=1, i',
                    'referer': 'https://cto.new/onboarding',
                    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"macOS"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'cross-site',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
                },
                timeout: 10000 // 10 second timeout
            });

            // Format time-to-scrape display
            const timeToScrapeDisplay = timeToScrape !== null 
                ? ` \x1b[90m(scraped in ${(timeToScrape / 1000).toFixed(3)}s)\x1b[0m`
                : '';
            
            this.logSuccess(`🎉 SUCCESS! Code \x1b[92m${inviteCode}\x1b[0m redeemed successfully!${timeToScrapeDisplay}`);
            this.successCount++;
            this.tokenValid = true; // Token is working
            
            // Show celebration
            const w = 50;
            console.log('\n╔' + '═'.repeat(w) + '╗');
            console.log('║    🏆 INVITE CODE REDEEMED! 🏆' + ' '.repeat(17) + '║');
            if (timeToScrape !== null) {
                const timeStr = `${(timeToScrape / 1000).toFixed(3)}s`;
                const speedLine = `    ⚡ Scrape speed: ${timeStr}`;
                // ⚡ is 1 emoji, so visual length is speedLine.length + 1
                console.log('║' + speedLine + ' '.repeat(w - speedLine.length - 1) + '║');
            }
            console.log('╚' + '═'.repeat(w) + '╝\n');
            
            // Metrics & success notification
            if (this.metricsEnabled) {
                this.client.once('ready', async () => {
                    console.clear(); // Clear console for a clean start
                    const w = 50;
                    console.log('\n╔' + '═'.repeat(w) + '╗');
                    console.log('║  🤖 CTO.new Invite Scraper Bot v2.1' + ' '.repeat(14) + '║');
                    console.log('╚' + '═'.repeat(w) + '╝');
                    console.log(`✅ Logged in as: \x1b[36m${this.client.user.tag}\x1b[0m`);
                    console.log(`📡 Monitoring channels:`);
                    // Fetch channel names from Discord
                    for (const id of this.targetChannelIds) {
                        try {
                            const channel = await this.client.channels.fetch(id);
                            this.channelNames[id] = channel.name || 'Unknown';
                            console.log(`   • ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m`);
                        } catch (error) {
                            this.channelNames[id] = 'Unknown Channel';
                            console.log(`   • ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m \x1b[91m[Error]\x1b[0m`);
                        }
                    }

                    // Show support message on first run
                    if (this.isFirstRun) {
                        const w = 50;
                        console.log('\n┌' + '─'.repeat(w) + '┐');
                        console.log('│ 💙 Thanks for trying CTO Invite Scraper! 💙' + ' '.repeat(6) + '│');
                        console.log('│' + ' '.repeat(w) + '│');
                        console.log('│ This took hours to build and is free.' + ' '.repeat(12) + '│');
                        console.log('│ If it helps you, please consider:' + ' '.repeat(16) + '│');
                        console.log('│' + ' '.repeat(w) + '│');
                        console.log('│   ⭐ Star on GitHub' + ' '.repeat(30) + '│');
                        console.log('│   👤 Follow for more tools' + ' '.repeat(23) + '│');
                        console.log('│' + ' '.repeat(w) + '│');
                        console.log('│ It takes 2 seconds and helps the project!' + ' '.repeat(8) + '│');
                        console.log('└' + '─'.repeat(w) + '┘');
                        console.log('\x1b[90m⭐ https://github.com/arthurauffray/cto-invite-scraper\x1b[0m');
                        console.log('\x1b[90m� https://github.com/arthurauffray\x1b[0m');
                        console.log('');
                        // Open URLs in browser
                        const { exec } = require('child_process');
                        const open = (url) => {
                            const command = process.platform === 'darwin' ? 'open' : 
                                          process.platform === 'win32' ? 'start' : 'xdg-open';
                            exec(`${command} ${url}`);
                        };
                        // Open repo page (where they can star)
                        open('https://github.com/arthurauffray/cto-invite-scraper');
                        await this.sleep(2000);
                        // Open profile page (where they can follow)
                        open('https://github.com/arthurauffray');
                        await this.sleep(8000);
                    }

                    // Print Abacus stats if debug mode is on
                    await this.printAbacusStats();

                    // Start automatic token refresh FIRST (so we have a fresh token)
                    await this.startTokenRefresh();

                    // Check if user is on the waitlist (with retry)
                    await this.checkWaitlistStatus();

                    // Then run token health check with the fresh token
                    await this.startTokenMonitoring();

                    console.log('\n\x1b[92m🎯 Bot is ready and watching for invite codes...\x1b[0m');
                    console.log('\x1b[90m🛡️  Anti-obfuscation enabled\x1b[0m\n');

                    // Start status display
                    this.startStatusDisplay();

                    // Metrics: count install and start active heartbeat
                    if (this.metricsEnabled) {
                        if (this.isFirstRun) {
                            this.pingMetric('installs');
                            this.markAsInstalled();
                        }
                        this.startActiveHeartbeat();
                    }
                });
    // Print Abacus statistics on startup if debug mode is enabled
    async printAbacusStats() {
        if (!this.metricsEnabled || process.env.DEBUG_MODE !== 'true') return;
        this.logInfo('📊 Fetching Abacus statistics...');
        const kinds = ['installs', 'redeems', 'active'];
        for (const kind of kinds) {
            try {
                const url = this.metrics[`${kind}Url`];
                const response = await axios.get(url, { timeout: 5000 });
                this.logInfo(`📈 ${kind}: ${response.data.value}`);
            } catch (e) {
                this.logWarning(`Abacus metric fetch failed for ${kind}`, e.message);
            }
        }
    }
                        this.logInfo(`   Respecting Retry-After header: ${retrySeconds}s`);
                        await this.sleep(retrySeconds * 1000);
                    } else {
                        // Otherwise use exponential backoff on retry
                        this.logInfo(`   Using exponential backoff on retry`);
                    }
                    
                    return { success: false, shouldRetry: true };
                } else if (status === 404) {
                    this.logWarning(`🔍 Code \x1b[93m${inviteCode}\x1b[0m is invalid or doesn't exist${timeToScrapeDisplay}`);
                    this.logInfo(`   This code may be fake, expired, or incorrectly formatted`);
                    this.invalidCount++;
                    return { success: false, shouldRetry: false };
                } else {
                    this.logError(`❌ Failed to redeem \x1b[93m${inviteCode}\x1b[0m: ${status}${timeToScrapeDisplay}`, JSON.stringify(data, null, 2));
                    return { success: false, shouldRetry: false };
                }
            } else if (error.code === 'ECONNABORTED') {
                this.logError(`⏰ Timeout attempting to redeem \x1b[93m${inviteCode}\x1b[0m${timeToScrapeDisplay}`);
                return { success: false, shouldRetry: true }; // Retry timeouts
            } else {
                this.logError(`🌐 Network error redeeming \x1b[93m${inviteCode}\x1b[0m:${timeToScrapeDisplay}`, error.message);
                return { success: false, shouldRetry: true }; // Retry network errors
            }
        }
    }

    async processRetryQueue() {
        if (this.isRetrying || this.retryQueue.length === 0) return;
        
        this.isRetrying = true;
        this.logInfo(`🔄 Processing retry queue with ${this.retryQueue.length} items`);
        
        while (this.retryQueue.length > 0) {
            // Wait for exponential backoff delay
            const delay = this.retryDelay * Math.pow(2, Math.min(this.retryQueue[0].retryCount - 1, 4));
            this.logInfo(`⏳ Waiting ${delay/1000}s before retry...`);
            await this.sleep(delay);
            
            const retryItem = this.retryQueue.shift();
            this.logInfo(`🔄 Retrying code: \x1b[93m${retryItem.code}\x1b[0m (attempt ${retryItem.retryCount}/${this.maxRetries})`);
            
            const result = await this.tryRedeemCode(retryItem.code, retryItem.messageTimestamp);
            
            // If still failing and we have retries left, add back to queue
            if (result.shouldRetry && retryItem.retryCount < this.maxRetries) {
                this.retryQueue.push({
                    code: retryItem.code,
                    retryCount: retryItem.retryCount + 1,
                    timestamp: Date.now(),
                    messageTimestamp: retryItem.messageTimestamp
                });
            } else if (result.shouldRetry) {
                this.logError(`❌ Max retries exceeded for code \x1b[93m${retryItem.code}\x1b[0m`);
            }
        }
        
        this.isRetrying = false;
        this.logInfo(`✅ Retry queue processing completed`);
    }

    async notifyTokenIssue() {
        const msg = [
            `🚨 **CTO Invite Bot Alert** 🚨`,
            ``,
            `Your CTO.new session appears to be expired or invalid.`,
            `The bot's auto-refresh may not be working properly.`,
            ``,
            `**To fix:**`,
            `1. Go to https://cto.new and log in`,
            `2. Open browser DevTools (F12) → Application tab`,
            `3. Go to Cookies → https://cto.new`,
            `4. Copy the \`__client\` cookie value`,
            `5. Update \`CLERK_CLIENT_COOKIE\` in your .env file`,
            `6. Restart the bot`,
            ``,
            `The bot will continue trying to redeem codes in the meantime.`,
            ``,
            `Timestamp: ${new Date().toLocaleString()}`
        ].join('\n');
        const ok = await this.sendNotification('Token issue', msg);
        if (ok) this.logSuccess(`📱 Notification sent about token issue`);
    }

    async notifySuccess(code, data, timeToScrape) {
        const lines = [
            `� **CTO.NEW INVITE REDEEMED!** 🎊`,
            ``,
            `✅ You now have access to CTO.new!`,
            `Code: \`${code}\``,
        ];
        
        // Add time-to-scrape if available
        if (timeToScrape !== null && timeToScrape !== undefined) {
            lines.push(`⚡ Speed: \`${(timeToScrape / 1000).toFixed(3)}s\` from post to redemption`);
        }
        
        lines.push(``);
        lines.push(`🎯 Visit https://cto.new to get started!`);
        lines.push(`⭐ Don't forget to star the bot: https://github.com/arthurauffray/cto-invite-scraper`);
        lines.push(``);
        lines.push(`Timestamp: ${new Date().toLocaleString()}`);
        
        const msg = lines.join('\n');
        await this.sendNotification('🎉 SUCCESS!', msg);
    }

    async notifyAlreadyRedeemed(code, timeToScrape) {
        const lines = [
            `⚠️ **Code Already Redeemed** ⚠️`,
            ``,
            `The bot found code \`${code}\` but someone else got it first.`,
        ];
        
        // Add time-to-scrape if available
        if (timeToScrape !== null && timeToScrape !== undefined) {
            lines.push(`⏱️ Scrape speed: \`${(timeToScrape / 1000).toFixed(3)}s\``);
            lines.push(`You were fast, but someone was faster!`);
        }
        
        lines.push(``);
        lines.push(`Keep watching - another code might appear soon!`);
        lines.push(``);
        lines.push(`Timestamp: ${new Date().toLocaleString()}`);
        
        const msg = lines.join('\n');
        await this.sendNotification('⚠️ Already Redeemed', msg);
    }

    async sendNotification(title, content) {
        const mode = this.notify.mode;
        if (mode === 'none') return false;
        const mention = this.notify.pingUserId ? `<@${this.notify.pingUserId}> ` : '';
        const fullContent = `${mention}${content}`;

        try {
            if (mode === 'webhook' && this.notify.webhookUrl) {
                await axios.post(this.notify.webhookUrl, {
                    content: fullContent,
                    allowed_mentions: this.notify.pingUserId ? { users: [this.notify.pingUserId] } : { parse: [] }
                }, { timeout: 5000 });
                return true;
            }
            if (mode === 'channel' && this.notify.channelId) {
                const ch = await this.client.channels.fetch(this.notify.channelId).catch(() => null);
                if (ch && ch.isTextBased && ch.isTextBased()) {
                    await ch.send(fullContent);
                    return true;
                }
            }
            if (mode === 'dm' && this.notify.dmUserId) {
                const user = await this.client.users.fetch(this.notify.dmUserId).catch(() => null);
                if (user) {
                    const dm = await user.createDM();
                    await dm.send(fullContent);
                    return true;
                }
            }
        } catch (e) {
            this.logWarning('Notification send failed', e.message);
        }
        return false;
    }

    async startTokenMonitoring() {
        // Run immediate token health check on startup
        if (process.env.DEBUG_MODE === 'true') {
            this.logInfo('🧪 Running initial token health check...');
        }
        await this.testTokenHealth();
        
        // Test token health every 10-15 minutes (randomized)
        setInterval(async () => {
            const randomDelay = Math.random() * 300000; // 0-5 minutes random
            await this.sleep(randomDelay);
            await this.testTokenHealth();
        }, this.tokenTestInterval);
    }

    async testTokenHealth() {
        // Generate a random fake invite code to test the API
        const testCode = this.generateFakeCode();
        
        if (process.env.DEBUG_MODE === 'true') {
            this.logInfo(`🧪 Testing token health with fake code: \x1b[90m${testCode}\x1b[0m`);
        }
        
        try {
            await axios.post(this.ctoApiUrl, {
                inviteCode: testCode
            }, {
                headers: {
                    'accept': 'application/json',
                    'authorization': `Bearer ${process.env.CTO_AUTH_TOKEN}`,
                    'content-type': 'application/json',
                    'origin': 'https://cto.new',
                    'referer': 'https://cto.new/onboarding',
                },
                timeout: 5000
            });
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                
                if (status === 401 || status === 403) {
                    this.logError(`🚨 Token health check failed: ${status}`);
                    this.tokenValid = false;
                    await this.notifyTokenIssue();
                } else if (status === 404) {
                    // Expected for fake code - token is working
                    if (process.env.DEBUG_MODE === 'true') {
                        this.logSuccess(`✅ Token health check passed`);
                    }
                    this.tokenValid = true;
                } else {
                    if (process.env.DEBUG_MODE === 'true') {
                        this.logInfo(`🔍 Token test got status ${status} - likely working`);
                    }
                    this.tokenValid = true;
                }
            } else {
                this.logWarning(`⚠️  Token health check network error:`, error.message);
            }
        }
        
        this.lastTokenTest = Date.now();
    }

    async checkWaitlistStatus() {
        this.logInfo('🔍 Checking your CTO.new account status...');
        
        // Sonnet 4.5: retry logic with exponential backoff
        const maxAttempts = 3;
        let attempt = 0;
        let lastError = null;
        while (attempt < maxAttempts) {
            try {
                const reqUrl = 'https://api.enginelabs.ai/current-user/status';
                const reqHeaders = {
                    'accept': 'application/json',
                    'authorization': `Bearer ${process.env.CTO_AUTH_TOKEN}`,
                    'origin': 'https://cto.new',
                    'referer': 'https://cto.new/onboarding',
                };
                const response = await axios.get(reqUrl, {
                    headers: reqHeaders,
                    timeout: 5000
                });
                const status = response.data?.status;
                if (status === 'ACTIVE') {
                    const w = 50;
                    console.log('\n╔' + '═'.repeat(w) + '╗');
                    console.log('║ 🎉 You already have CTO.new access! 🎉' + ' '.repeat(9) + '║');
                    console.log('║ Bot will monitor codes anyway if you want.' + ' '.repeat(7) + '║');
                    console.log('╚' + '═'.repeat(w) + '╝\n');
                    await this.sleep(2000);
                } else if (status === 'WAITLIST') {
                    this.logSuccess('✅ You\'re on the waitlist - watching for codes!');
                } else {
                    this.logWarning(`⚠️  Unknown status: ${status}`);
                }
                return;
            } catch (error) {
                lastError = error;
                this.logWarning(`⚠️  Could not verify waitlist status (attempt ${attempt + 1}/${maxAttempts})`);
                if (error.response) {
                    this.logWarning(`   Status: ${error.response.status}`);
                    if (process.env.DEBUG_MODE === 'true') {
                        this.logWarning('   Response data:', JSON.stringify(error.response.data));
                        this.logWarning('   Request headers:', JSON.stringify(error.response.config?.headers));
                    }
                } else if (error.request) {
                    if (process.env.DEBUG_MODE === 'true') {
                        this.logWarning('   No response received from server.');
                        this.logWarning('   Request config:', JSON.stringify(error.config));
                    }
                } else {
                    if (process.env.DEBUG_MODE === 'true') {
                        this.logWarning('   Error message:', error.message);
                    }
                }
                attempt++;
                if (attempt < maxAttempts) {
                    // Exponential backoff: 2^attempt * 1s
                    const delay = Math.pow(2, attempt) * 1000;
                    this.logInfo(`⏳ Retrying waitlist check in ${(delay / 1000).toFixed(1)}s...`);
                    await this.sleep(delay);
                }
            }
        }
        // If we get here, all attempts failed
        this.logError('❌ All attempts to verify waitlist status failed.');
        if (lastError && process.env.DEBUG_MODE === 'true') {
            this.logError('   Last error:', lastError.message);
        }
    }

    generateFakeCode() {
        // Generate a 12-character fake code for testing
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 12; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    extractClerkSessionId(jwt) {
        // Decode JWT to extract session ID (sid claim)
        try {
            const parts = jwt.split('.');
            if (parts.length !== 3) return null;
            
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            return payload.sid || null;
        } catch (error) {
            this.logWarning('Failed to decode JWT:', error.message);
            return null;
        }
    }

    async startTokenRefresh() {
        // Extract session ID from current token
        const sessionId = this.extractClerkSessionId(process.env.CTO_AUTH_TOKEN);
        
        if (!sessionId) {
            this.logError('❌ Could not extract Clerk session ID from token.');
            this.logError('   Your CTO_AUTH_TOKEN may be invalid or malformed.');
            process.exit(1);
        }
        
        this.clerkSessionId = sessionId;
        this.clerkSessionUrl = `https://clerk.cto.new/v1/client/sessions/${sessionId}/touch?__clerk_api_version=2025-04-10&_clerk_js_version=5.103.1`;
        
        if (process.env.DEBUG_MODE === 'true') {
            this.logInfo(`🔄 Token auto-refresh enabled (every ${this.tokenRefreshInterval/1000}s)`);
        }
        
        // Refresh token immediately
        await this.refreshCTOToken();
        
        // Set up periodic refresh
        setInterval(async () => {
            await this.refreshCTOToken();
        }, this.tokenRefreshInterval);
    }

    async refreshCTOToken() {
        if (!this.clerkSessionUrl) return;
        
        // Prevent concurrent refreshes
        if (this.isRefreshingToken) {
            return;
        }
        
        this.isRefreshingToken = true;
        
        const clerkClientCookie = process.env.CLERK_CLIENT_COOKIE;
        
        try {
            const response = await axios.post(this.clerkSessionUrl, 'active_organization_id=', {
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/x-www-form-urlencoded',
                    'origin': 'https://cto.new',
                    'referer': 'https://cto.new/onboarding',
                    'cookie': `__client=${clerkClientCookie}`,
                },
                timeout: 5000
            });
            
            const newToken = response.data?.response?.last_active_token?.jwt;
            
            if (newToken) {
                // Update the token in process.env
                process.env.CTO_AUTH_TOKEN = newToken;
                this.lastTokenRefresh = Date.now();
                // More subtle token refresh message
                if (process.env.DEBUG_MODE === 'true') {
                    this.logInfo(`\x1b[90m🔄 Token refreshed\x1b[0m`);
                }
                this.tokenValid = true;
            } else {
                this.logWarning('⚠️  Token refresh returned no new JWT');
            }
        } catch (error) {
            this.logError('❌ Token refresh failed:', error.message);
            if (error.response) {
                this.logError(`   Status: ${error.response.status}`);
                if (error.response.status === 401) {
                    this.logError('   Your CLERK_CLIENT_COOKIE may be invalid or expired.');
                    this.logError('   Please get a fresh cookie from https://cto.new');
                }
            }
        } finally {
            this.isRefreshingToken = false;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Helper to create consistent box lines
    boxLine(content, width = 50) {
        // Simply pad with spaces to width - let terminal handle emoji rendering
        if (content.length >= width) {
            return content.substring(0, width);
        }
        return content + ' '.repeat(width - content.length);
    }

    // Logging methods with colors and formatting
    logMessage(title, content) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n\x1b[90m[${timestamp}]\x1b[0m ${title}`);
        if (content) console.log(`   ${content}`);
    }

    logInfo(message, details = null) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\x1b[90m[${timestamp}]\x1b[0m ℹ️  ${message}`);
        if (details) console.log(`   \x1b[90m${details}\x1b[0m`);
    }

    logSuccess(message, details = null) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\x1b[90m[${timestamp}]\x1b[0m \x1b[92m✅ ${message}\x1b[0m`);
        if (details) console.log(`   ${details}`);
    }

    logWarning(message, details = null) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\x1b[90m[${timestamp}]\x1b[0m \x1b[93m⚠️  ${message}\x1b[0m`);
        if (details) console.log(`   \x1b[93m${details}\x1b[0m`);
    }

    logError(message, details = null) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\x1b[90m[${timestamp}]\x1b[0m \x1b[91m❌ ${message}\x1b[0m`);
        if (details) console.log(`   \x1b[91m${details}\x1b[0m`);
    }

    truncateMessage(message, maxLength = 100) {
        if (message.length <= maxLength) return message;
        return message.substring(0, maxLength) + '\x1b[90m...\x1b[0m';
    }

    startStatusDisplay() {
        // Update status every 30 seconds
        setInterval(() => {
            this.updateStatus();
        }, 30000);
    }

    // Metrics: send a GET request to pre-configured Abacus URL
    async pingMetric(kind) {
        const map = {
            installs: this.metrics.installsUrl,
            redeems: this.metrics.redeemsUrl,
            active: this.metrics.activeUrl,
        };
        const url = map[kind];
        if (!url) return;
        try {
            const response = await axios.get(url, { timeout: 5000 });
            // Only log in debug mode
            if ((kind === 'installs' || kind === 'redeems') && process.env.DEBUG_MODE === 'true') {
                this.logInfo(`📈 ${kind}: ${response.data.value}`);
            }
        } catch (e) {
            if (process.env.DEBUG_MODE === 'true') {
                this.logError(`Metric ping failed for ${kind}`, e.message);
            }
        }
    }

    startActiveHeartbeat() {
        // Ping active every 30 minutes
        setInterval(() => {
            this.pingMetric('active');
        }, 30 * 60 * 1000);
        
        if (process.env.DEBUG_MODE === 'true') {
            this.logInfo('📡 Active heartbeat started (30m)');
        }
    }

    markAsInstalled() {
        // Write BOT_INSTALLED=true to .env file
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '.env');
        
        try {
            let envContent = '';
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            
            // Check if BOT_INSTALLED already exists
            if (!envContent.includes('BOT_INSTALLED')) {
                // Add to end of file
                const newLine = envContent.endsWith('\n') ? '' : '\n';
                envContent += `${newLine}\n# DO NOT MODIFY - Auto-generated flag to track first install\nBOT_INSTALLED=true\n`;
                fs.writeFileSync(envPath, envContent, 'utf8');
                this.logInfo('📝 Marked bot as installed in .env');
            }
        } catch (error) {
            this.logWarning('Failed to update .env file', error.message);
        }
    }

    updateStatus() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        const w = 50;
        const title = ' Status Update ';
        const titlePadding = Math.floor((w - title.length) / 2);
        const topBorder = '┌' + '─'.repeat(titlePadding) + title + '─'.repeat(w - titlePadding - title.length) + '┐';
        
        console.log('\n' + topBorder);
        
        const line1 = ` ⏰ Uptime: ${hours}h ${minutes}m ${seconds}s`;
        console.log('│' + line1 + ' '.repeat(w - line1.length - 1) + '│');
        
        const line2 = ` 🔢 Processed: ${this.totalProcessed} | ✅ Success: ${this.successCount}`;
        console.log('│' + line2 + ' '.repeat(Math.max(0, w - line2.length - 5)) + '\x1b[92m' + ' '.repeat(4) + '\x1b[0m│');
        
        const line3 = ` ⚠️  Redeemed: ${this.alreadyRedeemedCount} | ❌ Invalid: ${this.invalidCount}`;
        console.log('│' + line3 + ' '.repeat(w - line3.length) + '│');
        
        // Only show retry queue if non-zero
        if (this.retryQueue.length > 0 || this.authErrorCount > 0 || this.rateLimitCount > 0) {
            const line4 = ` 🔄 Retry queue: ${this.retryQueue.length} | 🔐 Auth errors: ${this.authErrorCount}`;
            console.log('│' + line4 + ' '.repeat(w - line4.length - 2) + '│');
            
            if (this.rateLimitCount > 0) {
                const line5 = ` ⏱️  Rate limits: ${this.rateLimitCount}`;
                console.log('│' + line5 + ' '.repeat(w - line5.length - 1) + '│');
            }
        }
        
        const tokenEmoji = this.tokenValid ? '✅' : '❌';
        const timeSinceTest = Math.floor((Date.now() - this.lastTokenTest) / 60000);
        const line5 = ` 🏥 Token: ${tokenEmoji} | 🧪 Last test: ${timeSinceTest}m ago`;
        console.log('│' + line5 + ' '.repeat(w - line5.length - 1) + '│');
        console.log('└' + '─'.repeat(w) + '┘\n');
    }

    async start() {
        if (!process.env.DISCORD_TOKEN) {
            console.error('❌ DISCORD_TOKEN not found in environment variables');
            console.error('Please set your Discord token in the .env file');
            process.exit(1);
        }

        if (!process.env.CTO_AUTH_TOKEN) {
            console.error('❌ CTO_AUTH_TOKEN not found in environment variables');
            console.error('Please set your CTO.new auth token in the .env file');
            process.exit(1);
        }

        if (!process.env.CLERK_CLIENT_COOKIE) {
            console.error('❌ CLERK_CLIENT_COOKIE not found in environment variables');
            console.error('Please set your Clerk client cookie in the .env file');
            console.error('');
            console.error('To get this:');
            console.error('1. Open https://cto.new in your browser');
            console.error('2. Press F12 → Application tab → Cookies → https://cto.new');
            console.error('3. Copy the __client cookie value');
            console.error('4. Add to .env: CLERK_CLIENT_COOKIE=<value>');
            process.exit(1);
        }

        this.startTime = Date.now();
        
        // Check if this is the first run
        this.isFirstRun = process.env.BOT_INSTALLED !== 'true';

        try {
            await this.client.login(process.env.DISCORD_TOKEN);
        } catch (error) {
            console.error('❌ Failed to login to Discord:', error.message);
            process.exit(1);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot...');
    process.exit(0);
});

// Start the bot
const bot = new CTOInviteScraper();
bot.start().catch(console.error);

module.exports = CTOInviteScraper;