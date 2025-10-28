require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');

class CTOInviteScraper {
    constructor() {
        this.client = new Client();
        this.targetChannelIds = [
            '1428387946293362789', // invite-sharing channel
            '1427788039144341584', // general channel  
            '1427787585052344372'  // announcements channel
        ];
        this.channelNames = {
            '1428387946293362789': 'Invite-sharing',
            '1427788039144341584': 'General',
            '1427787585052344372': 'Announcements'
        };
        this.ctoApiUrl = 'https://api.enginelabs.ai/invites/redeem';
        this.inviteCodePattern = /\b[a-z0-9]{12}\b/gi; // Pattern matching the example codes
        this.processedCodes = new Set(); // Track already processed codes
        this.totalProcessed = 0;
        this.successCount = 0;
        this.invalidCount = 0;
        this.alreadyRedeemedCount = 0;
        this.authErrorCount = 0;
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.clear(); // Clear console for a clean start
            console.log('\n' + '🟦'.repeat(15));
            console.log('🤖 CTO.new Invite Scraper Bot v2.0');
            console.log('🟦'.repeat(15));
            console.log(`✅ Logged in as: \x1b[36m${this.client.user.tag}\x1b[0m`);
            console.log(`📡 Monitoring channels:`);
            this.targetChannelIds.forEach(id => {
                console.log(`   \x1b[32m•\x1b[0m ${this.channelNames[id]} \x1b[90m(${id})\x1b[0m`);
            });
            console.log('🟦'.repeat(15));
            console.log('\x1b[92m🎯 Bot is ready and watching for invite codes...\x1b[0m\n');
            
            // Start status display
            this.startStatusDisplay();
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

        // Try to redeem each code
        for (const code of inviteCodes) {
            if (!this.processedCodes.has(code)) {
                await this.tryRedeemCode(code);
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
        const matches = text.match(this.inviteCodePattern) || [];
        
        // Filter out common false positives and ensure exact length match
        return matches.filter(match => {
            const code = match.toLowerCase();
            // Must be exactly 12 characters (like the examples)
            if (code.length !== 12) return false;
            
            // Skip obvious non-codes
            if (code.includes('discord') || code.includes('http') || code.includes('www')) {
                return false;
            }
            
            return true;
        });
    }

    async tryRedeemCode(inviteCode) {
        this.logInfo(`🔄 Attempting to redeem code: \x1b[93m${inviteCode}\x1b[0m`);
        
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

            this.logSuccess(`🎉 SUCCESS! Code \x1b[92m${inviteCode}\x1b[0m redeemed successfully!`);
            this.logInfo(`📋 Response:`, JSON.stringify(response.data, null, 2));
            this.successCount++;
            
            // Show celebration
            console.log('\n' + '🎊'.repeat(20));
            console.log('\x1b[92m🏆 INVITE CODE SUCCESSFULLY REDEEMED! 🏆\x1b[0m');
            console.log('🎊'.repeat(20) + '\n');
            
            // You might want to stop the bot after successful redemption
            // this.client.destroy();
            
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 400 && data.error && data.error.includes('already been redeemed')) {
                    this.logWarning(`⚠️  Code \x1b[93m${inviteCode}\x1b[0m already redeemed`);
                    this.alreadyRedeemedCount++;
                } else if (status === 401) {
                    this.logError(`🔐 Authentication failed for code \x1b[93m${inviteCode}\x1b[0m`);
                    this.logError(`💡 Your CTO_AUTH_TOKEN may be expired. Please get a fresh token from browser.`);
                    this.authErrorCount++;
                } else if (status === 403) {
                    this.logError(`🚫 Access forbidden for code \x1b[93m${inviteCode}\x1b[0m`);
                    this.logError(`💡 Your CTO_AUTH_TOKEN may be expired or invalid. Please get a fresh token.`);
                    this.logError(`🔧 To get a new token: Log into cto.new → F12 → Network → Try redeem → Copy Bearer token`);
                    this.authErrorCount++;
                } else if (status === 404) {
                    this.logWarning(`🔍 Code \x1b[93m${inviteCode}\x1b[0m is invalid or doesn't exist`);
                    this.logInfo(`   This code may be fake, expired, or incorrectly formatted`);
                    this.invalidCount++;
                } else {
                    this.logError(`❌ Failed to redeem \x1b[93m${inviteCode}\x1b[0m: ${status}`, JSON.stringify(data, null, 2));
                }
            } else if (error.code === 'ECONNABORTED') {
                this.logError(`⏰ Timeout attempting to redeem \x1b[93m${inviteCode}\x1b[0m`);
            } else {
                this.logError(`🌐 Network error redeeming \x1b[93m${inviteCode}\x1b[0m:`, error.message);
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