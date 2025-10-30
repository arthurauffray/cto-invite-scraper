# CTO.new Invite Scraper Bot

[![GitHub Stars](https://img.shields.io/github/stars/arthurauffray/cto-invite-scraper?style=for-the-badge&logo=github&color=yellow)](https://github.com/arthurauffray/cto-invite-scraper/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/arthurauffray/cto-invite-scraper?style=for-the-badge&logo=github&color=blue)](https://github.com/arthurauffray/cto-invite-scraper/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/arthurauffray/cto-invite-scraper?style=for-the-badge&logo=github&color=red)](https://github.com/arthurauffray/cto-invite-scraper/issues)
[![GitHub Watchers](https://img.shields.io/github/watchers/arthurauffray/cto-invite-scraper?style=for-the-badge&logo=github&color=green)](https://github.com/arthurauffray/cto-invite-scraper/watchers)
[![License](https://img.shields.io/github/license/arthurauffray/cto-invite-scraper?style=for-the-badge&color=purple)](LICENSE)

A Discord selfbot that monitors the CTO.new invite sharing channel and automatically attempts to redeem invite codes when they're posted.

## ⚠️ Important Disclaimers

- **Selfbots are against Discord's Terms of Service.** Use at your own risk.
- This is for educational purposes. You're responsible for any consequences.
- The bot uses your Discord account, so make sure you understand the risks.

## 🚀 Setup Instructions

### 1. Clone/Download the Project
Make sure you have all the files in the `cto-invite-scraper` directory.

### 2. Install Dependencies
```bash
cd cto-invite-scraper
npm install
```

### 3. Get Your Discord Token
1. Open Discord in your web browser (not the app)
2. Press `F12` to open Developer Tools
3. Go to the `Network` tab
4. Refresh the page or click around Discord
5. Look for any request and find the `Authorization` header
6. Copy the token (it starts with your user ID and contains dots)

### 4. Get Your CTO.new Auth Token
1. Go to [cto.new](https://cto.new) and log in
2. Press `F12` to open Developer Tools  
3. Go to the `Network` tab
4. Try to redeem any invite code (even an invalid one)
5. Look for the request to `api.enginelabs.ai/invites/redeem`
6. Copy the `Bearer` token from the `Authorization` header

### 5. Get Your Clerk Client Cookie (REQUIRED)
The auth token expires after ~60 seconds, so the bot needs this cookie to refresh it automatically:

1. With DevTools still open, go to `Application` tab
2. Expand `Cookies` → click on `https://cto.new`
3. Find the `__client` cookie and copy its full value (it's a long JWT string)
4. Add to your `.env`: `CLERK_CLIENT_COOKIE=<value>`

The bot will automatically refresh your auth token every 15 seconds using this cookie!

### 6. Configure Environment Variables
Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

Then edit `.env` and add your tokens and cookie:
   ```
   DISCORD_TOKEN=your_discord_token_here
   CTO_AUTH_TOKEN=your_cto_auth_token_here
   CLERK_CLIENT_COOKIE=your_clerk_client_cookie_here
   ```

**Channel Configuration:**
The bot monitors these official CTO.new Discord channels by default:
- `1428387946293362789` - invite-sharing channel
- `1427788039144341584` - general channel  
- `1427787585052344372` - announcements channel

To monitor different channels, add to your `.env`:
```
CHANNEL_IDS=your_channel_id_1,your_channel_id_2,your_channel_id_3
```

**Optional:** Configure notifications (see [Notifications](#-notifications) section below)

**Metrics:** The bot automatically sends anonymous usage stats via [Abacus](https://abacus.jasoncameron.dev):
- `installs`: Incremented once when bot starts
- `redeems`: Incremented when an invite code is successfully redeemed  
- `active`: Incremented on success and every 30 minutes (heartbeat)

These metrics help track adoption and usage patterns. The data is completely anonymous (no personal info collected).

### 7. Run the Bot
```bash
npm start
```

## 🔧 How It Works

1. **Connects to Discord** using your account as a selfbot
2. **Monitors configured channels** (defaults to official CTO.new invite-sharing, general, and announcements channels)
3. **Detects invite codes** using regex pattern matching (12-character alphanumeric codes)
4. **Attempts redemption** via CTO.new's API
5. **Logs all activity** to the console with detailed status updates

## 📋 Features

- ✅ Real-time monitoring of Discord messages
- ✅ Smart invite code detection (filters out false positives)
- ✅ Automatic redemption attempts
- ✅ Duplicate code tracking (won't try the same code twice)
- ✅ Comprehensive error handling and logging
- ✅ Rate limiting between redemption attempts
- ✅ Graceful shutdown handling
- ✅ Advanced anti-obfuscation detection:
  - Spaces and zero-width characters
  - Discord markdown (spoilers, code blocks, bold, italic)
  - Unicode normalization and combining marks
  - Homoglyph mapping (Cyrillic, Greek, fullwidth lookalikes)
  - Multi-strategy reconstruction (direct, spaced, line-wise, token-merge, full-scan)
- ✅ Flexible notifications:
  - Success: When you successfully redeem a code
  - Already Redeemed: When you find a code but someone beat you to it
  - Token Issues: When your auth token needs attention
  - Delivery methods: webhook, channel ping, or DM to user
- ✅ Clean console output with optional debug mode

## 🔔 Notifications

The bot can notify you about important events:
- ✅ **Success**: Code redeemed successfully
- ⚠️ **Already Redeemed**: Found a code but someone got it first
- 🔐 **Token Issues**: Auth token needs attention

Configure one of the following (choose a mode):

```
# notification mode: webhook | channel | dm | none
NOTIFY_MODE=webhook

# for webhook mode
NOTIFY_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
# optional: ping a user in the webhook
NOTIFY_PING_USER_ID=123456789012345678

# for channel mode
NOTIFY_MODE=channel
NOTIFY_CHANNEL_ID=1428387946293362789
NOTIFY_PING_USER_ID=123456789012345678

# for dm mode
NOTIFY_MODE=dm
NOTIFY_DM_USER_ID=123456789012345678
```

Notes:
- If DMs fail with "Cannot send messages to this user", use webhook or channel mode instead.
- Webhook mentions use `<@USER_ID>` with allowed mentions.

## 🔍 Monitoring

The bot provides detailed console output including:
- Connection status
- New messages detected
- Invite codes found
- Redemption attempt results
- Error messages and reasons

Example output:
```
Logged in as YourUsername#1234!
Monitoring channel ID: 1428387946293362789
Bot is ready and watching for invite codes...
New message in invite channel from SomeUser#5678: Check out this code: abc123def456
Found 1 potential invite code(s): ['abc123def456']
Attempting to redeem code: abc123def456
❌ Code abc123def456 already redeemed
```

## 🛑 Stopping the Bot

Press `Ctrl+C` to stop the bot gracefully.

## 🔧 Configuration

You can modify these settings in your `.env` file:
- `CHANNEL_IDS`: Comma-separated list of Discord channel IDs to monitor
- `NOTIFY_MODE`: Notification method (webhook/channel/dm/none)
- `DEBUG_MODE`: Set to `true` for verbose logging (token refreshes, health checks, metrics)

Advanced settings in `bot.js`:
- `inviteCodePattern`: Regex pattern for detecting invite codes
- Rate limiting delays
- API timeout settings

## ⚠️ Troubleshooting

### "DISCORD_TOKEN not found"
Make sure you've created the `.env` file and added your Discord token.

### "CTO_AUTH_TOKEN not found"  
Make sure you've added your CTO.new authentication token to the `.env` file.

### "Failed to login to Discord"
Your Discord token might be invalid or expired. Get a fresh token following the setup steps.

### "Authentication failed"
Your CTO.new auth token might be expired. Get a fresh token from the browser.

### Bot not detecting messages
- Make sure you're in the correct Discord server
- Verify the channel ID is correct
- Check that your Discord account has access to the channel

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=arthurauffray/cto-invite-scraper&type=date&legend=top-left)](https://www.star-history.com/#arthurauffray/cto-invite-scraper&type=date&legend=top-left)

## ⚖️ Legal

This tool is provided as-is for educational purposes. Users are responsible for compliance with Discord's Terms of Service and any applicable laws or regulations.