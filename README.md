# Microsoft Family Safety Plugin for Allow2Automate

Integrate Microsoft Family Safety parental controls with Allow2 quota management.

## Features

- **OAuth Authentication**: Secure Microsoft Account sign-in
- **Automatic Quota Sync**: Enforce Allow2 quotas in Microsoft Family Safety
- **Smart Sync Strategy**:
  - Normal mode: Hourly syncs when quota > 30 minutes
  - Aggressive mode: 10-minute syncs when quota < 30 minutes
  - Immediate sync when quota increases or reaches zero
- **Cross-Platform**: Works on Windows, Xbox, and Android devices
- **Child Account Linking**: Link Microsoft Family children with Allow2 accounts

## Installation

1. Install via Allow2Automate marketplace
2. Enable the plugin in Allow2Automate settings
3. Configure authentication and link children

## Setup

### 1. Authenticate with Microsoft

Click "Sign in with Microsoft" in the plugin settings. A browser window will open for you to sign in with your Microsoft account (the parent account that manages Microsoft Family Safety).

### 2. Link Children

After authentication:
1. Click "Refresh Children" to load your family members
2. For each child, select the corresponding Allow2 account from the dropdown
3. Click "Link" to connect them

### 3. Quota Enforcement

Once linked, the plugin will automatically:
- Monitor Allow2 quotas for each child
- Update Microsoft Family screen time limits
- Send notifications when quota is low
- Immediately restrict access when quota is exhausted

## How Quota Sync Works

The plugin uses a smart three-tier sync strategy:

### Normal Mode (> 30 minutes remaining)
- Syncs every hour (configurable)
- Minimal API calls
- Efficient for full quotas

### Aggressive Mode (< 30 minutes remaining)
- Syncs every 10 minutes
- Ensures timely enforcement
- Prevents quota overrun

### Immediate Mode
- Syncs instantly when:
  - Quota increases (parent adds time)
  - Quota reaches zero (needs immediate restriction)

## Example Scenarios

### Scenario 1: Daily Reset
```
6:00 AM - Allow2 quota resets to 120 minutes
          → Plugin syncs immediately (quota increased)
          → Microsoft Family: 120 minutes allowed

7:00 AM - Normal mode (hourly sync)
8:00 AM - Normal mode (hourly sync)
...
```

### Scenario 2: Low Quota
```
4:30 PM - Child has 25 minutes remaining
          → Plugin enters aggressive mode
          → Syncs every 10 minutes

4:40 PM - 15 minutes remaining → Sync
4:50 PM - 5 minutes remaining → Sync + Warning notification
5:00 PM - 0 minutes remaining → Immediate sync + Access restricted
```

### Scenario 3: Bonus Time
```
3:00 PM - Child has 10 minutes remaining (aggressive mode)
3:05 PM - Parent adds 60 minutes bonus in Allow2
          → Plugin syncs immediately (quota increased)
          → Microsoft Family: 70 minutes allowed
          → Switches back to normal mode
```

## Configuration

### Settings
- **Sync Interval**: Default 10 minutes (600000 ms)
- **Aggressive Threshold**: Default 30 minutes
- **Headless Mode**: Browser runs in background (default: true)

### Customization

Edit plugin state to adjust sync behavior:
```javascript
{
  settings: {
    syncInterval: 600000,           // 10 minutes
    aggressiveSyncThreshold: 30,    // Minutes
    headless: true                  // Background browser
  }
}
```

## API Endpoints

The plugin uses the unofficial Microsoft Family Mobile API:
- Base URL: `https://familymobile.microsoft.com`
- OAuth: `https://login.live.com/oauth20_authorize.srf`

**Note**: This is reverse-engineered from the Microsoft Family Safety mobile app and is not officially documented.

## Troubleshooting

### Authentication Failed
- Ensure you're using the correct Microsoft account (parent account)
- Check that Microsoft Family Safety is set up for your family
- Try re-authenticating

### Children Not Loading
- Click "Refresh Children" button
- Ensure children are added to your Microsoft family
- Check browser console for errors

### Quotas Not Syncing
- Verify children are linked correctly
- Check "Last sync" timestamp
- Click "Sync Quotas Now" to force immediate sync
- Ensure plugin is enabled

### Token Expired
- Tokens expire after ~1 hour by default
- Re-authenticate when prompted
- The plugin will notify you before expiration

## Privacy & Security

- OAuth tokens are stored securely in encrypted plugin state
- Browser sessions use persistent contexts (minimal re-auth)
- All API calls use HTTPS
- No credentials are stored, only OAuth tokens

## Platform Support

### Tested Platforms
- ✅ Windows 10/11
- ✅ Xbox (One, Series X/S)
- ✅ Android devices with Family Safety app

### Limitations
- Microsoft Family Safety may take up to 30 minutes to propagate changes
- iOS devices have limited screen time API support
- Some games/apps may require local enforcement

## Contributing

Found a bug or have a feature request?
- GitHub: https://github.com/Allow2/allow2automate-microsoft-family
- Issues: https://github.com/Allow2/allow2automate-microsoft-family/issues

## License

MIT License - See LICENSE file for details

## Credits

- Built by Allow2 team
- Uses Microsoft Family Mobile API (unofficial)
- Inspired by ha-familysafety Home Assistant integration

---

**Note**: This plugin is not affiliated with or endorsed by Microsoft Corporation.
