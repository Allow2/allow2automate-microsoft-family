# Microsoft Family Safety API Discovery

## Background

Microsoft does not provide an official public API for Microsoft Family Safety screen time management. This document describes the unofficial API discovered through reverse engineering of the Microsoft Family Safety mobile app.

## Discovery Method

Analysis of the open-source **ha-familysafety** Home Assistant integration (https://github.com/pantherale0/ha-familysafety) revealed the unofficial API endpoints used by the Microsoft Family Safety mobile application.

## Authentication

### OAuth 2.0 Flow

**Authorization Endpoint**:
```
https://login.live.com/oauth20_authorize.srf
```

**Parameters**:
- `client_id`: `00000000402b5328` (Microsoft Family Safety app client ID)
- `scope`: `service::familymobile.microsoft.com::MBI_SSL`
- `response_type`: `token`
- `redirect_uri`: `https://login.live.com/oauth20_desktop.srf`

**Response**:
The redirect URL contains the access token in the hash fragment:
```
https://login.live.com/oauth20_desktop.srf#access_token=...&token_type=bearer&expires_in=3600&scope=...
```

**Token Characteristics**:
- Type: Bearer token
- Typical expiry: 3600 seconds (1 hour)
- No refresh token in standard flow

## API Endpoints

### Base URL
```
https://familymobile.microsoft.com
```

### Common Headers
```http
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Microsoft-Family-Safety-App/1.0
```

### Endpoints (Unofficial)

#### 1. Get Family Information
```http
POST /getFamilyInfo
```

**Response**:
```json
{
  "familyId": "family-uuid",
  "users": [
    {
      "userId": "user-uuid",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "isChild": true,
      "age": 12,
      "profilePictureUrl": "https://..."
    }
  ]
}
```

#### 2. Get Screen Time Settings
```http
POST /getScreenTimeSettings
Content-Type: application/json

{
  "userId": "user-uuid",
  "familyId": "family-uuid"
}
```

**Response**:
```json
{
  "enabled": true,
  "dailyLimitMinutes": 120,
  "todayUsageMinutes": 45,
  "schedule": {
    "monday": { "start": "08:00", "end": "20:00" },
    "tuesday": { "start": "08:00", "end": "20:00" }
  }
}
```

#### 3. Set Screen Time Limit
```http
POST /setScreenTimeLimit
Content-Type: application/json

{
  "userId": "user-uuid",
  "familyId": "family-uuid",
  "dailyLimitMinutes": 120,
  "enabled": true
}
```

**Response**:
```json
{
  "success": true,
  "userId": "user-uuid",
  "dailyLimitMinutes": 120
}
```

## API Behavior

### Rate Limiting
- No documented rate limits
- Conservative approach: 1 request per second recommended
- Implement exponential backoff on errors

### Propagation Delay
- Screen time limit changes may take up to 30 minutes to propagate across devices
- No immediate feedback on device restriction
- Multiple syncs recommended for time-sensitive enforcement

### Error Responses

**401 Unauthorized**:
```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired access token"
}
```
Action: Re-authenticate

**404 Not Found**:
```json
{
  "error": "NotFound",
  "message": "User not found"
}
```
Action: Verify user ID, refresh family members

**500 Internal Server Error**:
```json
{
  "error": "InternalServerError",
  "message": "An error occurred processing your request"
}
```
Action: Retry with exponential backoff

## Implementation Notes

### Browser Automation Alternative

Since the OAuth flow requires user interaction, Playwright browser automation is used:

```javascript
// Open browser for authentication
const page = await context.newPage();
await page.goto('https://login.live.com/oauth20_authorize.srf?...');

// Wait for redirect with token
await page.waitForURL(/oauth20_desktop\.srf/);

// Extract token from URL hash
const url = page.url();
const hash = url.split('#')[1];
const params = new URLSearchParams(hash);
const accessToken = params.get('access_token');
```

### API Request Pattern

```javascript
async function apiRequest(endpoint, data) {
  const response = await fetch(`https://familymobile.microsoft.com${endpoint}`, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: data ? JSON.stringify(data) : undefined
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}
```

### Caching Strategy

To minimize API calls:

```javascript
const cache = {
  familyMembers: {
    data: null,
    timestamp: null,
    ttl: 300000  // 5 minutes
  },
  screenTime: new Map()  // Per-child cache
};

function isCacheValid(cacheEntry) {
  return cacheEntry.data &&
         (Date.now() - cacheEntry.timestamp) < cacheEntry.ttl;
}
```

## Security Considerations

### Token Storage
- Store access tokens encrypted
- Never log tokens in plaintext
- Clear tokens on logout

### HTTPS Only
- All API requests use HTTPS
- Validate SSL certificates
- No HTTP fallback

### Browser Security
- Run in headless mode by default
- Use persistent contexts (minimize re-auth)
- Sandbox browser processes

## Platform Support

### Confirmed Working
- ✅ Windows 10/11 screen time limits
- ✅ Xbox (One, Series X/S) screen time limits
- ✅ Android devices with Family Safety app

### Partial Support
- ⚠️ iOS devices (limited API support)
- ⚠️ Web content filtering (different API)

### Not Supported
- ❌ Driving safety features (deprecated by Microsoft)
- ❌ Location tracking (deprecated by Microsoft)

## Comparison to Official APIs

### Parental Controls API (Windows)
Microsoft provides a Windows-only WMI-based API:
- **Scope**: Local Windows machine only
- **Documentation**: https://learn.microsoft.com/en-us/windows/win32/parcon/parental-controls-api-overview
- **Limitation**: Cannot control Xbox or Android devices

### Microsoft Graph API
Microsoft Graph does not include Family Safety endpoints as of 2025.

### Family Safety App
The mobile app uses the unofficial API documented here, confirming its viability.

## Risks and Limitations

### API Stability
- ⚠️ Unofficial API, may change without notice
- ⚠️ No SLA or support from Microsoft
- ⚠️ Breaking changes possible at any time

### Functionality Gaps
- Cannot read detailed activity reports
- Cannot manage app-specific restrictions
- Cannot control web content filtering

### Workarounds
- Implement robust error handling
- Cache aggressively to minimize API dependency
- Monitor for API changes via community sources

## Future Considerations

### Microsoft Graph Integration
If Microsoft adds Family Safety to Graph API:
- Migrate to official endpoints
- Maintain backward compatibility
- Add feature detection

### API Monitoring
- Watch ha-familysafety project for updates
- Monitor Microsoft Family Safety app updates
- Test regularly for breaking changes

## References

1. **ha-familysafety**: https://github.com/pantherale0/ha-familysafety
2. **Microsoft Parental Controls API**: https://learn.microsoft.com/en-us/windows/win32/parcon/
3. **Microsoft Family Safety**: https://www.microsoft.com/en-us/microsoft-365/family-safety
4. **OAuth 2.0 Spec**: https://datatracker.ietf.org/doc/html/rfc6749

---

**Status**: Functional but unofficial
**Last Verified**: 2025-12-29
**Risk Level**: Medium (API may change)
