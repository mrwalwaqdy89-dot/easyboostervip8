# API Key System - Usage Guide

## Overview
The API Key system allows external applications to integrate with ANDY RCH's single react functionality through a secure REST API.

## Features
- 🔐 Secure API key generation and management
- 📊 Real-time usage tracking and monitoring
- ⚙️ Customizable rate limits (10-10,000 requests per key)
- 🔄 Enable/disable keys without deletion
- 📅 Optional expiration dates
- 📖 Comprehensive API documentation for users
- 🎯 Access control (only API key holders can view docs)

## For Administrators

### Generating API Keys

1. Log into the admin dashboard
2. Navigate to the **API Keys** tab in the sidebar
3. Fill in the generation form:
   - **Key Name** (required): Descriptive name (e.g., "Production API", "Mobile App")
   - **Request Limit** (required): Number of requests allowed (10-10,000)
   - **User ID** (optional): Associate with a specific user
   - **Expires In Days** (optional): Set expiration (leave empty for no expiration)
4. Click "Generate API Key"
5. **IMPORTANT**: Copy the generated key immediately - it won't be shown again!

### Managing API Keys

**View Usage Statistics:**
- Click the 📊 icon to see detailed stats
- Shows total/successful/failed requests, active days, etc.

**Edit Request Limit:**
- Click the ✏️ icon
- Enter new limit (10-10,000)
- Changes take effect immediately

**Enable/Disable:**
- Click the 🔌 icon to toggle status
- Disabled keys cannot be used but aren't deleted

**Delete:**
- Click the 🗑️ icon
- Confirm deletion (cannot be undone)
- All associated request logs are also deleted

### Monitoring Usage

The API Keys table shows:
- Key name and truncated key string
- Usage count with progress bar
- Remaining requests
- Active/Inactive status
- Associated user (if any)
- Quick action buttons

## For API Users

### Getting Started

1. **Obtain an API Key**: Contact the administrator to request an API key
2. **Access Documentation**: Visit https://easybooster.shop/documentation (requires active API key)
3. **Read the API Guide**: Complete documentation with code examples in cURL, JavaScript, and Python

### Making API Requests

**Endpoint:** `POST /api/v1/react`

**Authentication:** Bearer token in Authorization header

**Example (cURL):**
```bash
curl -X POST https://easybooster.shop/api/v1/react \
  -H "Authorization: Bearer ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "channelLink": "https://whatsapp.com/channel/0029VaCCYBXGehGLiMpKO03B/123",
    "emojis": ["❤️", "👍", "🔥"]
  }'
```

**Example (JavaScript):**
```javascript
const response = await fetch('https://easybooster.shop/api/v1/react', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    channelLink: 'https://whatsapp.com/channel/0029VaCCYBXGehGLiMpKO03B/123',
    emojis: ['❤️', '👍', '🔥']
  })
});

const data = await response.json();
console.log(data);
```

**Example (Python):**
```python
import requests

url = 'https://easybooster.shop/api/v1/react'
headers = {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
}
data = {
    'channelLink': 'https://whatsapp.com/channel/0029VaCCYBXGehGLiMpKO03B/123',
    'emojis': ['❤️', '👍', '🔥']
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

### Response Format

**Success (200 OK):**
```json
{
  "success": true,
  "message": "Reactions sent successfully to WhatsApp channel!",
  "data": {
    "channelLink": "...",
    "emojis": ["❤️", "👍", "🔥"],
    "reactionsCount": 3,
    "timestamp": "2024-01-15T10:30:00.000Z",
    "rateLimit": {
      "remaining": 47,
      "limit": 50
    }
  }
}
```

**Error (401 Unauthorized):**
```json
{
  "success": false,
  "message": "API key limit reached",
  "remaining": 0
}
```

**Error (400 Bad Request):**
```json
{
  "success": false,
  "message": "Invalid request. channelLink and emojis array are required."
}
```

### Rate Limits

- Each API key has a request limit set by the administrator
- The response includes `rateLimit.remaining` showing requests left
- When limit is reached, requests return 401 Unauthorized
- Contact administrator to increase your limit

### Best Practices

1. **Secure Your Key**: Never expose API keys in client-side code or public repositories
2. **Monitor Usage**: Check `rateLimit.remaining` in responses to avoid hitting limits
3. **Handle Errors**: Implement proper error handling for all status codes
4. **Validate Input**: Ensure channel links are valid before making requests
5. **Retry Logic**: Implement exponential backoff for failed requests

## Database Schema

### api_keys Table
- `id`: Primary key
- `user_id`: Optional foreign key to users table
- `api_key`: Unique key string (format: ak_xxxxx...)
- `name`: Descriptive name
- `request_limit`: Maximum allowed requests
- `usage_count`: Current usage count
- `is_active`: Enable/disable flag
- `created_at`: Creation timestamp
- `last_used_at`: Last usage timestamp
- `expires_at`: Optional expiration date

### api_requests Table
- `id`: Primary key
- `api_key_id`: Foreign key to api_keys
- `user_id`: Optional foreign key to users
- `channel_link`: WhatsApp channel URL
- `emojis`: JSON array of emojis sent
- `ip_address`: Client IP
- `user_agent`: Client user agent
- `success`: Boolean success flag
- `error_message`: Error details (if failed)
- `created_at`: Request timestamp

## Testing

Run the test script to verify functionality:

```bash
node test-api-key-system.js
```

This tests:
- Database table creation
- API key generation
- Key validation and usage
- Request logging
- Statistics retrieval
- CRUD operations

## Troubleshooting

**"Invalid API key" error:**
- Verify the key is correct (no extra spaces)
- Check if key is active in admin dashboard
- Ensure key hasn't expired

**"API key limit reached":**
- Contact administrator to increase limit
- Check current usage in admin dashboard

**"Missing or invalid authorization header":**
- Ensure header format is: `Authorization: Bearer YOUR_KEY`
- Check for typos in "Bearer" (capital B)

**Cannot access /documentation:**
- Verify you have an active API key
- Try logging in again
- Contact administrator for API key access

## Security Notes

- API keys are generated using cryptographically secure random characters
- Keys are stored in plain text in database (for validation) - keep database secure
- All API requests are logged for audit purposes
- Administrators can disable keys immediately if compromised
- Rate limiting prevents abuse

## Support

For issues, questions, or API key requests:
- Contact the administrator via the dashboard
- Check the /documentation page for detailed API reference
- Review this guide for common solutions

---

**Last Updated**: December 2024
**Version**: 1.0.0
