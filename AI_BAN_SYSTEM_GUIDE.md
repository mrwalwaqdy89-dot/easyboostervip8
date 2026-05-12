# AI Auto-Ban System - Complete Implementation Guide

## Overview
Intelligent AI-powered fraud detection system using Fingerprint Pro device fingerprinting and DeepSeek AI analysis.

## Key Features

### 1. Smart Ban Policy
**Rule:** One account per device. Keep FIRST account, ban all others.

**Examples:**
- 2 accounts → Ban 2nd, warn 1st
- 5 accounts → Ban 2nd-5th, severely warn 1st
- New account on banned device → Instant ban

### 2. Works for ALL Accounts
✅ New accounts (checked on registration)
✅ Old/existing accounts (checked every login)
✅ Account switching detection (A→B on same device)

### 3. Fingerprint Tracking
- Device fingerprint ID (unique per device)
- IP address (NOT used for bans alone)
- Browser, OS, device type
- First seen / last seen timestamps
- Visit count

### 4. AI Analysis
Uses DeepSeek AI to analyze:
- Device fingerprint matches
- Account creation patterns
- Timing analysis
- Behavioral signals
- Ignores shared IPs (families, cafes, offices)

## User Experience

### For Additional Accounts (2nd, 3rd, etc.)
**Ban Modal:**
```
🤖 AI Security Alert
Account Suspended

Multiple accounts detected on this device.
Only your first account (user@email.com) is allowed.

Reason: Multi-account abuse detected (3 accounts). 
This is account #2, keeping only the first account.

[Homepage] [Support]
```

### For First Account
**Warning Modal (1 additional account):**
```
⚠️ Security Warning
Multi-Account Detection

We detected another account using your device.
That account has been banned.

Policy Reminder:
✓ One account per person is allowed
✓ Your original account remains active
✗ Additional accounts have been banned

[I Understand]
```

**Severe Warning (2+ additional accounts):**
```
🚨 Security Warning
Severe Multi-Account Detection

We detected 4 additional accounts using your device.
All additional accounts have been banned.

⚠ Repeated violations may result in permanent ban

[I Understand]
```

## Admin Dashboard

### AI Ban System Tab
**Statistics Cards:**
- Total Bans
- Bans Last 24 Hours
- Average Risk Score
- AI Status (Active)

**Recent Bans Table:**
- User info (name, email)
- Ban reason (AI-generated)
- Risk score (0-100% with color bar)
- Fingerprint ID (truncated)
- Related accounts count
- Ban date/time
- View Analysis button

**View Analysis Modal:**
Shows:
- Banned user details
- Full AI reasoning
- Risk score & confidence
- Related accounts count
- Device fingerprint ID
- Ban timestamp

## API Endpoints

### POST /api/fingerprint/save
Captures and analyzes device fingerprint on login.

**Request:**
```json
{
  "userId": 123,
  "visitorId": "fingerprint_id_here",
  "ip": "192.168.1.1",
  "browserName": "Chrome",
  "browserVersion": "120.0",
  "os": "Windows",
  "device": "Desktop",
  "userAgent": "Mozilla/5.0..."
}
```

**Response (Ban):**
```json
{
  "success": false,
  "banned": true,
  "message": "Account banned: Multiple accounts detected...",
  "reason": "Multi-account abuse detected",
  "firstAccountEmail": "first@email.com"
}
```

**Response (Warning):**
```json
{
  "success": true,
  "warning": true,
  "message": "Security warning: Another account was detected...",
  "additionalAccountsDetected": 1
}
```

**Response (Severe Warning):**
```json
{
  "success": true,
  "severeWarning": true,
  "message": "Security alert: 4 additional accounts detected...",
  "additionalAccountsDetected": 4
}
```

### GET /api/admin/ai-bans
Returns ban logs and statistics for admin dashboard.

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 1,
        "user_id": 123,
        "user_name": "John Doe",
        "user_email": "john@example.com",
        "ban_reason": "Multi-account abuse detected",
        "ai_analysis": "{\"shouldBan\":true,\"riskScore\":0.95,...}",
        "fingerprint_id": "abc123...",
        "related_user_ids": [123, 124, 125],
        "risk_score": 0.95,
        "created_at": "2025-12-17T16:00:00Z"
      }
    ],
    "statistics": {
      "total_bans": 42,
      "bans_24h": 5,
      "bans_7d": 18,
      "bans_30d": 42,
      "avg_risk_score": 0.87
    }
  }
}
```

## Database Schema

### users table (new columns)
```sql
fingerprint_id TEXT          -- Fingerprint Pro visitor ID
ban_reason TEXT              -- AI-generated ban reason
```

### user_fingerprints table
```sql
id SERIAL PRIMARY KEY
user_id INTEGER              -- FK to users
fingerprint_id TEXT          -- Device fingerprint
ip_address TEXT
browser_name TEXT
browser_version TEXT
os TEXT
device_type TEXT
user_agent TEXT
first_seen TIMESTAMP
last_seen TIMESTAMP
visit_count INTEGER
UNIQUE(user_id, fingerprint_id)
```

### ban_logs table
```sql
id SERIAL PRIMARY KEY
user_id INTEGER              -- FK to users (banned user)
banned_by TEXT               -- 'AI_SYSTEM' or admin name
ban_reason TEXT              -- Short reason
ai_analysis TEXT             -- Full AI JSON response
fingerprint_id TEXT          -- Related fingerprint
related_user_ids INTEGER[]   -- Other accounts with same FP
risk_score DECIMAL(3,2)      -- 0.00 to 1.00
created_at TIMESTAMP
```

## Configuration

### Fingerprint Pro
- API Key (Web): `6iNAznB5zIoduJllERCE`
- CDN: `https://fpjscdn.net/v3/{apiKey}`

### AI Configuration (config.js)
```javascript
aiChat: {
    apiKey: 'sk-or-v1-...',
    model: 'deepseek/deepseek-chat',
    maxTokens: 500
}
```

## Testing Checklist

### Test Scenarios:
- [ ] New user registration
- [ ] Existing user login
- [ ] User creates 2nd account on same device
- [ ] User switches between accounts A and B
- [ ] User creates 5 accounts
- [ ] First account receives warning notification
- [ ] Additional accounts get banned
- [ ] Ban modal shows correct first account email
- [ ] Admin dashboard shows ban logs
- [ ] Admin can view AI analysis details

### Edge Cases:
- [ ] Shared IP (family/office) - should not trigger ban
- [ ] VPN usage - fingerprint should still work
- [ ] Incognito mode - different fingerprint per session
- [ ] Multiple browsers - different fingerprints
- [ ] Same user, same device, different browsers - allowed

## Security Considerations

### What's Tracked:
✅ Device fingerprint (primary signal)
✅ Browser, OS, device type
✅ Account creation timing
✅ Login patterns
✅ IP address (context only)

### What's NOT Used for Bans:
❌ IP address alone (too many false positives)
❌ Browser alone
❌ OS alone

### Privacy:
- Fingerprint data stored securely
- Only accessible by admins
- Used solely for fraud detection
- Can be deleted on request

## Support & Appeals

### For Users:
- Ban messages include support WhatsApp link
- Can appeal if false positive
- Clear explanation of policy
- First account email shown to help identify

### For Admins:
- View full AI analysis
- See all related accounts
- Manual override capability (to be added)
- Complete audit trail in ban_logs

## Future Enhancements

### Planned Features:
- [ ] Admin unban button with reasoning field
- [ ] Manual override for false positives
- [ ] Email notifications for bans
- [ ] User appeal system
- [ ] Temporary restrictions instead of ban
- [ ] Grace period for first offense
- [ ] Whitelist for known shared devices

### Analytics:
- [ ] Ban rate tracking
- [ ] False positive rate
- [ ] Appeal success rate
- [ ] Most common ban reasons

## Troubleshooting

### Fingerprint Not Capturing:
1. Check browser console for errors
2. Verify Fingerprint Pro API key
3. Check ad blocker not blocking SDK
4. Verify network connection

### AI Analysis Failing:
1. Check AI API key in config.js
2. Verify OpenRouter API status
3. Check API quota/limits
4. Review server logs for errors

### False Positives:
1. Check if shared device (family/office)
2. Review AI analysis reasoning
3. Check account creation dates
4. Verify fingerprint matches are legitimate

### Users Not Getting Banned:
1. Verify fingerprint is being saved
2. Check user_fingerprints table
3. Verify accounts share same fingerprint_id
4. Check ban_logs for any errors
5. Review console logs for AI decisions

---

**System Status:** ✅ Fully Operational
**Last Updated:** December 2025
**Version:** 1.0
