require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');

class CTOInviteScraper {
    constructor() {
        this.client = new Client();
        this.targetChannelId = '1428387946293362789'; // invite-sharing channel
        this.ctoApiUrl = 'https://api.enginelabs.ai/invites/redeem';
        this.inviteCodePattern = /\b[a-z0-9]{12}\b/gi; // Pattern matching the example codes
        this.processedCodes = new Set(); // Track already processed codes
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('ready', () => {
            console.log(`Logged in as ${this.client.user.tag}!`);
            console.log(`Monitoring channel ID: ${this.targetChannelId}`);
            console.log('Bot is ready and watching for invite codes...');
        });

        this.client.on('messageCreate', async (message) => {
            // Only process messages from the target channel
            if (message.channel.id !== this.targetChannelId) {
                return;
            }

            // Don't process own messages
            if (message.author.id === this.client.user.id) {
                return;
            }

            console.log(`New message in invite channel from ${message.author.tag}: ${message.content}`);
            
            await this.processMessage(message);
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });
    }

    async processMessage(message) {
        // Extract potential invite codes from the message
        const inviteCodes = this.extractInviteCodes(message.content);
        
        if (inviteCodes.length === 0) {
            console.log('No invite codes detected in message');
            return;
        }

        console.log(`Found ${inviteCodes.length} potential invite code(s):`, inviteCodes);

        // Try to redeem each code
        for (const code of inviteCodes) {
            if (!this.processedCodes.has(code)) {
                await this.tryRedeemCode(code);
                this.processedCodes.add(code);
                
                // Add a small delay between redemption attempts
                await this.sleep(1000);
            } else {
                console.log(`Code ${code} already processed, skipping`);
            }
        }
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
        console.log(`Attempting to redeem code: ${inviteCode}`);
        
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

            console.log(`✅ SUCCESS! Code ${inviteCode} redeemed successfully!`);
            console.log('Response:', response.data);
            
            // You might want to stop the bot after successful redemption
            // this.client.destroy();
            
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 400 && data.error && data.error.includes('already been redeemed')) {
                    console.log(`❌ Code ${inviteCode} already redeemed`);
                } else if (status === 401) {
                    console.log(`❌ Authentication failed for code ${inviteCode} - check your CTO_AUTH_TOKEN`);
                } else {
                    console.log(`❌ Failed to redeem ${inviteCode}: ${status} - ${JSON.stringify(data)}`);
                }
            } else if (error.code === 'ECONNABORTED') {
                console.log(`❌ Timeout attempting to redeem ${inviteCode}`);
            } else {
                console.log(`❌ Network error redeeming ${inviteCode}:`, error.message);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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