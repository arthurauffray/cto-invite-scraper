# CTO.new Invite Scraper Bot

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

### 5. Configure Environment Variables
Create a `.env` file in the project root and add your tokens:
   ```
   DISCORD_TOKEN=your_discord_token_here
   CTO_AUTH_TOKEN=your_cto_auth_token_here
   ```

Metrics: we use Abacus to count redeemed codes for statistics. 100% anonymous.

### 6. Run the Bot
```bash
npm start
```

## 🔧 How It Works

1. **Connects to Discord** using your account as a selfbot
2. **Monitors the invite-sharing channel** (ID: 1428387946293362789)
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
- ✅ Global metrics (installs/redeems/active) via Abacus (opt-out with ABACUS_OPTOUT=true)
- ✅ Flexible notifications: webhook, channel ping, or DM to user

## 🔔 Notifications

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

You can modify these settings in `bot.js`:
- `targetChannelId`: The Discord channel to monitor
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

## ⚖️ Legal

This tool is provided as-is for educational purposes. Users are responsible for compliance with Discord's Terms of Service and any applicable laws or regulations.