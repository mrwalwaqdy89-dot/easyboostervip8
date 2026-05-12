# 5SMM API Integration Documentation

## Overview

This document describes the integration of the 5SMM.com API into the ARCH platform. The 5SMM API provides social media marketing (SMM) services for various platforms including Instagram, TikTok, Facebook, YouTube, and more.

## API Information

- **API Endpoint:** `https://5smm.com/api/v2`
- **API Key:** Configured via `SMM_API_KEY` environment variable
- **Current Balance:** $0.0465 USD
- **Total Available Services:** 4,474+

## Configuration

The 5SMM API configuration is managed in `config.js`:

```javascript
smm: {
    apiKey: process.env.SMM_API_KEY || 'c6a1bbf03f29554c25dcdf240ac2b33a',
    apiUrl: process.env.SMM_API_URL || 'https://5smm.com/api/v2',
    enabled: getBool('SMM_ENABLED', true)
}
```

### Environment Variables

- `SMM_API_KEY`: Your 5SMM API key (required)
- `SMM_API_URL`: API endpoint URL (default: https://5smm.com/api/v2)
- `SMM_ENABLED`: Enable/disable the SMM service (default: true)

## Architecture

### Service Module (`smmService.js`)

The `smmService.js` module encapsulates all interactions with the 5SMM API. It provides a clean interface for:

- Service listing and filtering
- Order creation and management
- Order status tracking
- Balance inquiries
- Refill requests
- Order cancellation

### Key Features

1. **Singleton Pattern**: The service is exported as a singleton instance
2. **Error Handling**: Comprehensive error handling with descriptive messages
3. **Validation**: Input validation for all methods
4. **Type Safety**: JSDoc comments for better IDE support

## API Endpoints

All endpoints require authentication (`requireAuth` middleware) and check for maintenance mode.

### 1. Get All Services

**GET** `/api/smm/services`

Returns all available SMM services (4,474+ services).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "service": 14304,
      "name": "Instagram Video Views [Max Unlimited]",
      "type": "Default",
      "rate": "0.012",
      "min": 100,
      "max": 100000000,
      "dripfeed": false,
      "refill": false,
      "cancel": true,
      "category": "5SMM Promo [Cheapest & Recommended]"
    }
  ]
}
```

### 2. Get Services by Category

**GET** `/api/smm/services/category/:category`

Filter services by category name.

**Parameters:**
- `category` (path): Category name to filter by

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 38
}
```

### 3. Get Instagram Services

**GET** `/api/smm/services/instagram`

Returns all Instagram-related services (808+ services).

### 4. Get TikTok Services

**GET** `/api/smm/services/tiktok`

Returns all TikTok-related services (328+ services).

### 5. Get Promo Services

**GET** `/api/smm/services/promo`

Returns recommended/promotional services (38 services).

### 6. Create Order

**POST** `/api/smm/order`

Create a new SMM service order.

**Request Body:**
```json
{
  "service": 14304,
  "link": "https://instagram.com/p/xxxxx",
  "quantity": 1000
}
```

**Optional Fields:**
- `comments`: Custom comments (for comment services)
- `usernames`: Usernames list (for mention services)
- `runs`: Number of runs (for drip-feed)
- `interval`: Interval in minutes (for drip-feed)

**Response:**
```json
{
  "success": true,
  "data": {
    "order": 23501
  },
  "message": "Order created successfully"
}
```

### 7. Get Order Status

**GET** `/api/smm/order/:orderId`

Get the status of a specific order.

**Response:**
```json
{
  "success": true,
  "data": {
    "charge": "0.27819",
    "start_count": "3572",
    "status": "Completed",
    "remains": "0",
    "currency": "USD"
  }
}
```

**Order Statuses:**
- `Pending`: Order is waiting to be processed
- `In progress`: Order is being processed
- `Partial`: Order is partially completed
- `Completed`: Order is fully completed
- `Canceled`: Order has been canceled
- `Processing`: Order is being processed

### 8. Get Multiple Order Statuses

**POST** `/api/smm/orders/status`

Get statuses for multiple orders at once (max 100).

**Request Body:**
```json
{
  "orderIds": [23501, 23502, 23503]
}
```

### 9. Get Balance

**GET** `/api/smm/balance`

Get the current account balance.

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": "0.0465000",
    "currency": "USD"
  }
}
```

### 10. Create Refill

**POST** `/api/smm/refill`

Request a refill for an order (for services with refill support).

**Request Body (Single):**
```json
{
  "orderId": 23501
}
```

**Request Body (Multiple, max 100):**
```json
{
  "orderIds": [23501, 23502, 23503]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "refill": 1
  },
  "message": "Refill request created successfully"
}
```

### 11. Get Refill Status

**GET** `/api/smm/refill/:refillId`

Get the status of a refill request.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "Completed"
  }
}
```

**Refill Statuses:**
- `Pending`: Refill is waiting to be processed
- `Completed`: Refill has been completed
- `Rejected`: Refill request was rejected

### 12. Cancel Orders

**POST** `/api/smm/cancel`

Cancel one or more orders (max 100).

**Request Body:**
```json
{
  "orderIds": [23501, 23502]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "order": 23501,
      "cancel": 1
    }
  ],
  "message": "Cancel request processed"
}
```

## Service Categories

The API provides services across multiple categories:

### Popular Categories:
- **5SMM Promo** (38 services) - Recommended and cheapest services
- **Instagram** (808+ services) - Followers, likes, views, comments, saves, etc.
- **TikTok** (328+ services) - Followers, likes, views, live stream views
- **Facebook** - Pages, profiles, groups
- **YouTube** - Views, subscribers, likes
- **Twitter/X** - Followers, likes, retweets
- **Telegram** - Members, views, reactions
- **Spotify** - Plays, followers, playlist followers

## Service Types

1. **Default**: Standard services with quantity parameter
2. **Custom Comments**: Services requiring custom comment text
3. **Mentions Custom List**: Services requiring usernames list
4. **Mentions User Followers**: Services targeting user followers
5. **Package**: Pre-defined packages
6. **Drip-feed**: Services with scheduled delivery

## Example Usage

### JavaScript/Node.js

```javascript
// Get all Instagram services
const response = await fetch('/api/smm/services/instagram', {
  headers: {
    'Authorization': 'Bearer YOUR_AUTH_TOKEN'
  }
});
const data = await response.json();
console.log(data.data); // Array of Instagram services
```

```javascript
// Create an order for Instagram followers
const response = await fetch('/api/smm/order', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_AUTH_TOKEN'
  },
  body: JSON.stringify({
    service: 17850,
    link: 'https://instagram.com/username',
    quantity: 1000
  })
});
const data = await response.json();
console.log(data.data.order); // Order ID
```

```javascript
// Check order status
const orderId = 23501;
const response = await fetch(`/api/smm/order/${orderId}`, {
  headers: {
    'Authorization': 'Bearer YOUR_AUTH_TOKEN'
  }
});
const data = await response.json();
console.log(data.data.status); // Order status
```

## Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `400 Bad Request`: Invalid input parameters
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Access denied
- `500 Internal Server Error`: Server or API error
- `503 Service Unavailable`: SMM service is disabled

## Rate Limiting

The 5SMM API has rate limits. Ensure your application:
- Implements appropriate delays between requests
- Handles rate limit errors gracefully
- Caches service listings when possible

## Best Practices

1. **Cache Service Listings**: Services don't change frequently, cache them for better performance
2. **Batch Operations**: Use multiple order status endpoint instead of individual requests
3. **Error Handling**: Always handle errors and display user-friendly messages
4. **Balance Monitoring**: Check balance before creating large orders
5. **Service Selection**: Use promo services for best prices
6. **Refill Support**: Check if service supports refills before relying on it

## Testing

A test script is available at `/tmp/test-smm-api.js` for testing the integration:

```bash
node /tmp/test-smm-api.js
```

This will test:
- Balance retrieval
- Service listing
- Category filtering
- Instagram services
- TikTok services
- Promo services

## Security Considerations

1. **API Key Protection**: Never expose the API key in client-side code
2. **Authentication Required**: All endpoints require user authentication
3. **Input Validation**: All inputs are validated before API calls
4. **Error Messages**: Sensitive information is not exposed in error messages

## Support

For issues with:
- **API Integration**: Check this documentation or contact the development team
- **5SMM Service**: Visit https://5smm.com or contact their support
- **Balance/Orders**: Contact 5SMM support with order IDs

## Version History

- **v1.0.0** (2026-02-15): Initial integration with 5SMM API
  - Added service listing endpoints
  - Added order management endpoints
  - Added balance and refill endpoints
  - Comprehensive error handling and validation

## Future Enhancements

Potential improvements for future versions:

1. **Order History Storage**: Store orders in database for tracking
2. **Webhook Integration**: Receive order status updates via webhooks
3. **UI Dashboard**: Create frontend interface for managing orders
4. **Analytics**: Track usage and spending statistics
5. **Favorites**: Allow users to save favorite services
6. **Templates**: Pre-configured order templates
7. **Budget Limits**: Set spending limits per user
8. **Notifications**: Email/push notifications for order completion
