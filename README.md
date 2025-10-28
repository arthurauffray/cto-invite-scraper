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
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and add your tokens:
   ```
   DISCORD_TOKEN=your_discord_token_here
   CTO_AUTH_TOKEN=your_cto_auth_token_here
   ```

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

## 🔒 Security Notes

- Never share your `.env` file or tokens with anyone
- Tokens can expire and may need to be refreshed
- Keep the bot running on a trusted computer/server
- Monitor the console output for any issues

## 📞 Support

If you encounter issues:
1. Check the console output for error messages
2. Verify your tokens are correct and haven't expired
3. Make sure you have access to the Discord channel
4. Ensure your internet connection is stable

## ⚖️ Legal

This tool is provided as-is for educational purposes. Users are responsible for compliance with Discord's Terms of Service and any applicable laws or regulations.