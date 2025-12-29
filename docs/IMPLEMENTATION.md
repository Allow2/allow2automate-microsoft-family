# Microsoft Family Safety Plugin - Implementation Summary

## Overview

The Microsoft Family Safety plugin for Allow2Automate provides integration between Allow2 parental control quotas and Microsoft Family Safety screen time limits. This enables parents to manage screen time across Windows, Xbox, and Android devices using Allow2's quota system.

## Architecture

### Key Components

1. **MicrosoftFamilyService** (`src/services/MicrosoftFamilyService.js`)
   - Handles OAuth authentication with Microsoft
   - Communicates with unofficial Microsoft Family Mobile API
   - Manages browser automation via Playwright
   - Implements caching for API responses

2. **Plugin Factory** (`src/index.js`)
   - Implements Allow2Automate plugin lifecycle
   - Manages quota monitoring and enforcement
   - Handles IPC communication with renderer
   - Implements smart sync strategy

3. **TabContent UI** (`src/Components/TabContent.js`)
   - React component for plugin configuration
   - OAuth authentication flow
   - Child account linking interface
   - Status display and manual controls

## API Integration

### Microsoft Family Mobile API

**Base URL**: `https://familymobile.microsoft.com`

**Authentication**:
- OAuth 2.0 with Microsoft Account
- Client ID: `00000000402b5328` (Microsoft Family Safety app)
- Scope: `service::familymobile.microsoft.com::MBI_SSL`
- Redirect URI: `https://login.live.com/oauth20_desktop.srf`

**Endpoints** (Unofficial):
```javascript
POST /getFamilyInfo
{
  "familyId": "...",
  "users": [
    {
      "userId": "...",
      "firstName": "...",
      "lastName": "...",
      "email": "...",
      "isChild": true,
      "age": 12,
      "profilePictureUrl": "..."
    }
  ]
}

POST /getScreenTimeSettings
{
  "userId": "child-id",
  "familyId": "family-id"
}

POST /setScreenTimeLimit
{
  "userId": "child-id",
  "familyId": "family-id",
  "dailyLimitMinutes": 120,
  "enabled": true
}
```

## Quota Sync Strategy

### Three-Tier System

#### 1. Normal Mode (> 30 minutes)
- **Interval**: 10 minutes (configurable via `settings.syncInterval`)
- **Use case**: Full quota, routine monitoring
- **Behavior**: Minimal API calls, efficient resource usage

#### 2. Aggressive Mode (< 30 minutes)
- **Interval**: 10 minutes fixed
- **Trigger**: `remainingMinutes < settings.aggressiveSyncThreshold` (default: 30)
- **Use case**: Low quota, needs frequent enforcement
- **Behavior**: Ensures timely quota restrictions

#### 3. Immediate Mode
- **Interval**: Instant (on-demand)
- **Triggers**:
  - Quota increases (parent adds time)
  - Quota reaches zero (needs immediate restriction)
- **Behavior**: Priority sync, no delay

### Decision Logic

```javascript
function determineSyncStrategy(allow2ChildId, newMinutes) {
  const oldMinutes = quotaState[allow2ChildId]?.allow2Minutes || newMinutes;
  const lastSync = quotaState[allow2ChildId]?.lastSyncTime || 0;

  // IMMEDIATE: Quota increased
  if (newMinutes > oldMinutes) return 'sync';

  // IMMEDIATE: Quota exhausted
  if (newMinutes === 0 && oldMinutes > 0) return 'sync';

  // AGGRESSIVE: Below threshold (<30 min)
  if (newMinutes < 30) {
    if ((Date.now() - lastSync) >= 600000) return 'sync'; // 10 min
  }

  // NORMAL: Scheduled sync
  if ((Date.now() - lastSync) >= syncInterval) return 'sync';

  return 'skip';
}
```

## State Management

### Plugin State Structure

```javascript
{
  authenticated: false,
  accessToken: "...",
  tokenExpiry: 1234567890000,

  children: {
    "ms-child-id-1": {
      id: "ms-child-id-1",
      name: "Alice",
      email: "alice@family.com",
      isChild: true,
      age: 12,
      avatar: "https://..."
    }
  },

  childLinks: {
    "ms-child-id-1": "allow2-child-id-1"
  },

  quotaState: {
    "allow2-child-id-1": {
      lastSyncTime: 1234567890000,
      lastSyncMinutes: 45,
      allow2Minutes: 45
    }
  },

  settings: {
    headless: true,
    syncInterval: 600000,        // 10 minutes
    aggressiveSyncThreshold: 30  // Minutes
  },

  lastSync: 1234567890000
}
```

## IPC Handlers

### Main Process Handlers

| Handler | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `msFamily.authenticate` | None | `{ success, expiresAt }` | OAuth sign-in |
| `msFamily.getChildren` | None | `{ children }` | Fetch family members |
| `msFamily.linkChild` | `{ msChildId, allow2ChildId }` | `{ success }` | Link accounts |
| `msFamily.unlinkChild` | `{ msChildId }` | `{ success }` | Unlink accounts |
| `msFamily.getScreenTime` | `{ msChildId }` | `{ screenTime }` | Get current limits |
| `msFamily.setScreenTime` | `{ msChildId, minutes }` | `{ success }` | Set limit manually |
| `msFamily.getStatus` | None | `{ ...state }` | Get plugin status |
| `msFamily.syncNow` | None | `{ success, syncTime }` | Force sync |

### Renderer (UI) Usage

```javascript
// Authenticate
const [error, result] = await window.ipcRenderer.invoke('msFamily.authenticate');

// Get children
const [error, result] = await window.ipcRenderer.invoke('msFamily.getChildren');

// Link child
const [error, result] = await window.ipcRenderer.invoke('msFamily.linkChild', {
  msChildId: 'ms-child-123',
  allow2ChildId: 'allow2-child-456'
});
```

## Plugin Lifecycle

### 1. onLoad(loadState)
- Restore persisted state
- Initialize MicrosoftFamilyService
- Restore authentication tokens if valid
- Setup IPC handlers

### 2. newState(newState)
- Update plugin state
- Restart quota monitor if child links changed

### 3. onSetEnabled(enabled)
- Start/stop quota monitoring
- Update plugin status
- Persist configuration

### 4. onUnload(callback)
- Stop quota monitor
- Close browser sessions
- Cleanup resources

## Quota Monitoring Loop

```javascript
setInterval(async () => {
  // For each linked child
  for (const [msChildId, allow2ChildId] of childLinks) {
    // Get Allow2 quota
    const quota = await allow2.getQuota(allow2ChildId);
    const remainingMinutes = quota.remaining / 60;

    // Determine if sync needed
    if (shouldSync(allow2ChildId, remainingMinutes)) {
      // Update Microsoft Family limit
      await familyService.setScreenTimeLimit(msChildId, remainingMinutes);

      // Send notifications if low
      if (remainingMinutes < 10) {
        notify('Low screen time', `${child.name} has ${remainingMinutes} min left`);
      }
    }
  }
}, syncInterval);
```

## Security Considerations

### OAuth Token Storage
- Tokens stored in plugin state (encrypted by Allow2Automate)
- Automatic expiry checking
- Refresh token support (when available)

### API Security
- All requests use HTTPS
- Bearer token authentication
- Rate limiting respected

### Browser Security
- Headless mode by default
- Persistent context (minimize auth)
- Sandbox process isolation

## Error Handling

### Authentication Errors
- Token expiry → Re-authenticate prompt
- Network errors → Retry with backoff
- Invalid credentials → User notification

### API Errors
- Rate limiting → Back off exponentially
- 401 Unauthorized → Re-authenticate
- 404 Not Found → Child may not exist
- 500 Server Error → Retry with delay

### Sync Errors
- Quota API fails → Skip sync, log error
- Microsoft API fails → Cache last known value
- Network timeout → Retry next cycle

## Performance Optimizations

### Caching
- Family members: 5-minute cache
- Screen time data: 5-minute cache per child
- Invalidate on updates

### Rate Limiting
- Minimum 1-second delay between API calls
- Respect Microsoft's rate limits
- Use cache aggressively

### Resource Management
- Single browser instance
- Persistent context (no re-launch)
- Close pages after use
- Cleanup on unload

## Testing Strategy

### Unit Tests
- MicrosoftFamilyService methods
- Quota sync logic
- State management

### Integration Tests
- OAuth flow (manual)
- API communication
- IPC handlers

### End-to-End Tests
- Full authentication flow
- Child linking workflow
- Quota enforcement scenarios

## Known Limitations

1. **API Unofficial**: Microsoft may change endpoints without notice
2. **Propagation Delay**: Microsoft Family may take up to 30 minutes to apply changes
3. **Platform Support**: Limited to Windows, Xbox, Android (iOS partial)
4. **Token Expiry**: Requires re-auth approximately hourly

## Future Enhancements

1. **Token Refresh**: Implement refresh token flow for longer sessions
2. **Activity Reporting**: Read usage data from Microsoft Family
3. **App-Specific Limits**: Control individual apps/games
4. **Schedule Support**: Time-of-day restrictions
5. **Web Filtering**: Manage safe browsing settings

## Dependencies

### Runtime (Peer Dependencies)
- `playwright@^1.40.0` - Browser automation (provided by host)
- `react@^16.0.0` - UI framework (provided by host)
- `react-dom@^16.0.0` - React rendering (provided by host)
- `@material-ui/core@^4.0.0` - UI components (provided by host)

### Build Dependencies
- `@babel/*` - Transpilation
- `rollup` - Bundling
- `rollup-plugin-*` - Build plugins

### No Runtime Dependencies
The plugin has zero production dependencies beyond peer dependencies provided by the host application.

## File Structure

```
allow2automate-microsoft-family/
├── package.json                    # Plugin manifest
├── rollup.config.js                # Build configuration
├── .babelrc                        # Babel configuration
├── README.md                       # User documentation
├── src/
│   ├── index.js                    # Plugin factory + lifecycle
│   ├── Components/
│   │   └── TabContent.js           # React UI component
│   └── services/
│       ├── MicrosoftFamilyService.js  # API client
│       ├── OAuthService.js         # OAuth helper (optional)
│       └── TokenStorage.js         # Token encryption (optional)
├── docs/
│   └── IMPLEMENTATION.md           # This file
└── dist/
    ├── index.js                    # CommonJS bundle
    └── index.es.js                 # ES module bundle
```

## Build Process

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Watch mode (development)
npm start

# Test
npm test
```

## Deployment

1. Build the plugin: `npm run build`
2. Publish to npm: `npm publish`
3. Register in Allow2Automate marketplace
4. Users install via marketplace

## Support

- **GitHub**: https://github.com/Allow2/allow2automate-microsoft-family
- **Issues**: https://github.com/Allow2/allow2automate-microsoft-family/issues
- **Email**: support@allow2.com

---

**Last Updated**: 2025-12-29
**Version**: 0.0.1
**Status**: ✅ Production Ready (Pending Real-World Testing)
