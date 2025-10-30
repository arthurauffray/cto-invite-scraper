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
        
        // Channel names for display (will be fetched from Discord or use generic names)
        this.channelNames = {};
        
        this.ctoApiUrl = 'https://api.enginelabs.ai/invites/redeem';
        this.inviteCodePattern = /\b[a-z0-9]{12}\b/gi; // Pattern matching the example codes
        this.processedCodes = new Set(); // Track already processed codes
        this.totalProcessed = 0;
        this.successCount = 0;
        this.invalidCount = 0;
        this.alreadyRedeemedCount = 0;
        this.authErrorCount = 0;
        
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

        // Abacus metrics
        const ABACUS_BASE = 'https://abacus.jasoncameron.dev';
        const ABACUS_PROJECT = 'cto-invite-scraper';
        this.metrics = {
            installsUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/installs`,
            redeemsUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/redeems`,
            activeUrl: `${ABACUS_BASE}/hit/${ABACUS_PROJECT}/active`,
        };
        // Users can opt out by setting ABACUS_OPTOUT=true
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
            console.log('\n' + '🟦'.repeat(15));
            console.log('🤖 CTO.new Invite Scraper Bot v2.0');
            console.log('🟦'.repeat(15));
            console.log(`✅ Logged in as: \x1b[36m${this.client.user.tag}\x1b[0m`);
            console.log(`📡 Monitoring channels:`);
            
            // Fetch channel names from Discord
            for (const id of this.targetChannelIds) {
                try {
                    const channel = await this.client.channels.fetch(id);
                    this.channelNames[id] = channel.name || 'Unknown';
                    console.log(`   \x1b[32m•\x1b[0m ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m`);
                } catch (error) {
                    this.channelNames[id] = 'Unknown Channel';
                    console.log(`   \x1b[32m•\x1b[0m ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m \x1b[91m[Error fetching name]\x1b[0m`);
                }
            }
            
            console.log('🟦'.repeat(15));
            
            // Run token health check before showing ready status
            await this.startTokenMonitoring();
            
            // Start automatic token refresh
            await this.startTokenRefresh();
            
            console.log('\x1b[92m🎯 Bot is ready and watching for invite codes...\x1b[0m');
            console.log('\x1b[90m🛡️  Anti-obfuscation: spaces, zero-width, markdown, Unicode homoglyphs, combining marks\x1b[0m\n');
            
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
            this.logInfo(`📋 Response:`, JSON.stringify(response.data, null, 2));
            this.successCount++;
            this.tokenValid = true; // Token is working
            
            // Show celebration
            console.log('\n' + '🎊'.repeat(20));
            console.log('\x1b[92m🏆 INVITE CODE SUCCESSFULLY REDEEMED! 🏆\x1b[0m');
            if (timeToScrape !== null) {
                console.log(`⚡ Time to scrape: \x1b[96m${(timeToScrape / 1000).toFixed(3)}s\x1b[0m`);
            }
            console.log('🎊'.repeat(20) + '\n');
            
            // Metrics & success notification
            if (this.metricsEnabled) {
                this.pingMetric('redeems');
                this.pingMetric('active');
            }
            await this.notifySuccess(inviteCode, response.data, timeToScrape);
            
            // Shutdown bot after successful redemption
            this.logInfo('🛑 Shutting down bot after successful redemption...');
            setTimeout(() => {
                this.client.destroy();
                process.exit(0);
            }, 2000); // 2 second delay to allow notification to send
            
            return { success: true, shouldRetry: false };
            
        } catch (error) {
            // Format time-to-scrape display for errors
            const timeToScrapeDisplay = timeToScrape !== null 
                ? ` \x1b[90m(attempt in ${(timeToScrape / 1000).toFixed(3)}s)\x1b[0m`
                : '';
            
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 400 && data.error && data.error.includes('already been redeemed')) {
                    this.logWarning(`⚠️  Code \x1b[93m${inviteCode}\x1b[0m already redeemed${timeToScrapeDisplay}`);
                    this.alreadyRedeemedCount++;
                    return { success: false, shouldRetry: false };
                } else if (status === 401 || status === 403) {
                    // Auth errors - mark token as potentially invalid and suggest retry
                    this.tokenValid = false;
                    this.authErrorCount++;
                    
                    if (status === 401) {
                        this.logError(`🔐 Authentication failed for code \x1b[93m${inviteCode}\x1b[0m${timeToScrapeDisplay}`);
                    } else {
                        this.logError(`🚫 Access forbidden for code \x1b[93m${inviteCode}\x1b[0m${timeToScrapeDisplay}`);
                    }
                    
                    this.logError(`💡 Token may be expired. Will retry and notify if needed.`);
                    
                    // Send Discord notification about token issues
                    await this.notifyTokenIssue();
                    
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
            `Your CTO.new auth token appears to be expired or invalid.`,
            `Bot will continue trying to redeem codes but may fail until token is refreshed.`,
            ``,
            `**To fix:**`,
            `1. Go to cto.new and log in`,
            `2. Open browser dev tools (F12)`,
            `3. Try to redeem any invite code`,
            `4. Copy the Bearer token from Network tab`,
            `5. Update your .env file`,
            `6. Restart the bot`,
            ``,
            `Timestamp: ${new Date().toLocaleString()}`
        ].join('\n');
        const ok = await this.sendNotification('Token issue', msg);
        if (ok) this.logSuccess(`📱 Notification sent about token issue`);
    }

    async notifySuccess(code, data, timeToScrape) {
        const lines = [
            `🎉 **Invite redeemed successfully!**`,
            `Code: \`${code}\``,
        ];
        
        // Add time-to-scrape if available
        if (timeToScrape !== null && timeToScrape !== undefined) {
            lines.push(`⚡ Scraped in: \`${(timeToScrape / 1000).toFixed(3)}s\``);
        }
        
        const msg = lines.join('\n');
        await this.sendNotification('Redeem success', msg);
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
        this.logInfo('🧪 Running initial token health check...');
        await this.testTokenHealth();
        
        // Test token health every 10-15 minutes (randomized)
        setInterval(async () => {
            const randomDelay = Math.random() * 300000; // 0-5 minutes random
            await this.sleep(randomDelay);
            await this.testTokenHealth();
        }, this.tokenTestInterval);
        
        this.logInfo(`🔍 Token monitoring started (testing every ~${this.tokenTestInterval/60000} minutes)`);
    }

    async testTokenHealth() {
        // Generate a random fake invite code to test the API
        const testCode = this.generateFakeCode();
        this.logInfo(`🧪 Testing token health with fake code: \x1b[90m${testCode}\x1b[0m`);
        
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
                    this.logSuccess(`✅ Token health check passed (404 as expected)`);
                    this.tokenValid = true;
                } else {
                    this.logInfo(`🔍 Token test got status ${status} - likely working`);
                    this.tokenValid = true;
                }
            } else {
                this.logWarning(`⚠️  Token health check network error:`, error.message);
            }
        }
        
        this.lastTokenTest = Date.now();
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
            this.logWarning('⚠️  Could not extract Clerk session ID from token. Token refresh disabled.');
            return;
        }
        
        this.clerkSessionId = sessionId;
        this.clerkSessionUrl = `https://clerk.cto.new/v1/client/sessions/${sessionId}/touch?__clerk_api_version=2025-04-10&_clerk_js_version=5.103.1`;
        
        this.logInfo(`🔄 Token auto-refresh enabled (every ${this.tokenRefreshInterval/1000}s)`);
        
        // Refresh token immediately
        await this.refreshCTOToken();
        
        // Set up periodic refresh
        setInterval(async () => {
            await this.refreshCTOToken();
        }, this.tokenRefreshInterval);
    }

    async refreshCTOToken() {
        if (!this.clerkSessionUrl) return;
        
        try {
            const response = await axios.post(this.clerkSessionUrl, 'active_organization_id=', {
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/x-www-form-urlencoded',
                    'origin': 'https://cto.new',
                    'referer': 'https://cto.new/onboarding',
                },
                timeout: 5000
            });
            
            const newToken = response.data?.response?.last_active_token?.jwt;
            
            if (newToken) {
                // Update the token in process.env
                process.env.CTO_AUTH_TOKEN = newToken;
                this.lastTokenRefresh = Date.now();
                this.logInfo(`🔄 Token refreshed successfully \x1b[90m(expires in ~60s)\x1b[0m`);
                this.tokenValid = true;
            } else {
                this.logWarning('⚠️  Token refresh returned no new JWT');
            }
        } catch (error) {
            this.logError('❌ Token refresh failed:', error.message);
            if (error.response) {
                this.logError(`   Status: ${error.response.status}`);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
            // Log the count occasionally for transparency
            if (kind === 'installs' || kind === 'redeems') {
                this.logInfo(`📈 ${kind}: ${response.data.value}`);
            }
        } catch (e) {
            this.logError(`Metric ping failed for ${kind}`, e.message);
        }
    }

    startActiveHeartbeat() {
        // Ping active every 30 minutes
        setInterval(() => {
            this.pingMetric('active');
        }, 30 * 60 * 1000);
        this.logInfo('📡 Active heartbeat started (30m)');
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
        
        console.log('\n' + '\x1b[96m' + '🟦'.repeat(15) + '\x1b[0m');
        console.log('\x1b[96m📊 STATUS UPDATE\x1b[0m');
        console.log(`⏰ Uptime: \x1b[92m${hours}h ${minutes}m ${seconds}s\x1b[0m`);
        console.log(`🔢 Total processed: \x1b[94m${this.totalProcessed}\x1b[0m`);
        console.log(`🎉 Successful: \x1b[92m${this.successCount}\x1b[0m`);
        console.log(`⚠️  Already redeemed: \x1b[93m${this.alreadyRedeemedCount}\x1b[0m`);
        console.log(`🔍 Invalid codes: \x1b[91m${this.invalidCount}\x1b[0m`);
        console.log(`🔐 Auth errors: \x1b[91m${this.authErrorCount}\x1b[0m`);
        console.log(`💾 Codes in memory: \x1b[90m${this.processedCodes.size}\x1b[0m`);
        console.log(`🔄 Retry queue: \x1b[94m${this.retryQueue.length}\x1b[0m`);
        console.log(`🏥 Token status: ${this.tokenValid ? '\x1b[92m✅ Valid\x1b[0m' : '\x1b[91m❌ Invalid\x1b[0m'}`);
        
        const timeSinceTest = Math.floor((Date.now() - this.lastTokenTest) / 60000);
        console.log(`🧪 Last token test: \x1b[90m${timeSinceTest}m ago\x1b[0m`);
        console.log('\x1b[96m' + '🟦'.repeat(15) + '\x1b[0m\n');
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