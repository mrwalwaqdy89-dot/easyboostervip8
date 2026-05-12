# Database Setup Guide

## PostgreSQL Setup

This application requires a PostgreSQL database to store channel requests, user data, transactions, and rate limiting data.

### Local Development Setup

1. **Install PostgreSQL**
   - Download and install PostgreSQL from https://www.postgresql.org/download/
   - Or use Docker: `docker run --name reactch-postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres`

2. **Create Database**
   ```sql
   CREATE DATABASE reactch_db;
   ```

3. **Configure Application Settings**
   - All configuration is now in `config.js`
   - Update `database.url` with your PostgreSQL connection string:
     ```javascript
     database: {
         url: 'postgresql://username:password@localhost:5432/reactch_db'
     }
     ```

4. **Configure Google OAuth**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Google+ API
   - Go to Credentials → Create Credentials → OAuth 2.0 Client ID
   - Set Authorized redirect URIs to `http://localhost:3000/api/auth/google/callback`
   - Update the values in `config.js`:
     ```javascript
     oauth: {
         google: {
             clientId: 'your-client-id',
             clientSecret: 'your-client-secret',
             callbackUrl: '/api/auth/google/callback'
         }
     }
     ```
     ```

5. **Start the Application**
   ```bash
   npm start
   ```
   
   The application will automatically create all required tables on startup.

### Production Setup

For production deployment (e.g., Heroku, Railway, Render):

1. **Create PostgreSQL Database**
   - Use your hosting provider's PostgreSQL addon or service
   - Copy the connection string/URL

2. **Set Environment Variables**
   ```
   DATABASE_URL=your-production-database-url
   NODE_ENV=production
   SESSION_SECRET=your-secure-random-secret
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_CALLBACK_URL=https://your-domain.com/api/auth/google/callback
   RATE_LIMIT_PER_DAY=12
   ```

3. **Deploy Application**
   - The database tables will be created automatically on first startup

### Database Schema

The application creates the following tables:

#### `users`
Stores user accounts (Google OAuth)
- `id`: Primary key
- `google_id`: Google account ID (unique)
- `email`: User email (unique)
- `name`: Display name
- `avatar`: Profile picture URL
- `balance`: Coin balance (default: 100)
- `plan`: Subscription plan (free/premium)
- `daily_limit`: Daily request limit
- `total_requests_sent`: Total reactions sent
- `created_at`: Account creation date
- `last_login`: Last login timestamp

#### `transactions`
Stores coin transaction history
- `id`: Primary key
- `user_id`: Foreign key to users
- `type`: Transaction type (credit/debit)
- `category`: Category (auto-react, purchase, bonus, etc.)
- `description`: Transaction description
- `details`: Additional details
- `amount`: Coin amount
- `status`: Transaction status (completed/pending/failed)
- `created_at`: Transaction timestamp

#### `auto_react_channels`
Stores auto-react channel subscriptions
- `id`: Primary key
- `user_id`: Foreign key to users
- `channel_link`: WhatsApp channel URL
- `channel_jid`: Channel newsletter ID
- `channel_name`: Channel display name
- `channel_followers`: Number of followers
- `channel_preview`: Channel preview image URL
- `emojis`: Reaction emojis (JSONB)
- `days`: Subscription duration
- `coins_per_day`: Cost per day
- `total_coins`: Total cost
- `status`: Subscription status (active/pending/expired)
- `registered_at`: Registration date
- `expires_at`: Expiration date

#### `statistics`
Stores overall system statistics
- `id`: Primary key
- `total_requests`: Total number of successful requests
- `start_time`: When tracking started
- `last_updated`: Last update timestamp

#### `requests`
Stores all channel reaction requests
- `id`: Primary key
- `user_id`: Foreign key to users (optional)
- `channel_link`: Full channel/post URL
- `channel_jid`: Channel newsletter ID (JID)
- `channel_name`: Channel display name
- `channel_followers`: Number of followers
- `channel_preview`: Channel preview image URL
- `emojis`: Array of emojis used (stored as JSONB)
- `ip_address`: Client IP address
- `created_at`: Request timestamp
- `success`: Whether request was successful

#### `rate_limits`
Tracks daily rate limits per IP, user, and channel
- `id`: Primary key
- `identifier`: IP address, user ID, or channel JID
- `identifier_type`: Type of identifier ('ip', 'user', or 'channel')
- `request_count`: Number of requests today
- `request_date`: Date of requests
- `last_request_at`: Last request timestamp

### Rate Limiting

The application implements three types of rate limiting:

1. **IP-based**: Limits requests per IP address (default: 12 per day) for unauthenticated users
2. **User-based**: Limits requests per authenticated user (default: 12 per day)
3. **Channel-based**: Limits requests per channel JID (default: 12 per day)

Even if a user changes their IP (VPN), the channel limit prevents abuse.

**Timezone**: Rate limits reset daily at midnight in the **America/Port-au-Prince** timezone.

### Maintenance

Old rate limit records (older than 7 days) are automatically cleaned up every 24 hours.

### Troubleshooting

**Connection Issues:**
- Verify PostgreSQL is running
- Check DATABASE_URL is correct
- Ensure firewall allows connections
- For cloud databases, check SSL/TLS settings

**Table Creation Fails:**
- Check database user has CREATE TABLE permissions
- Verify database exists
- Check PostgreSQL logs for errors

**Rate Limiting Not Working:**
- Ensure requests are being saved to database
- Check rate_limits table is being populated
- Verify RATE_LIMIT_PER_DAY is set correctly

**Google OAuth Not Working:**
- Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set
- Check callback URL matches exactly in Google Console
- Ensure Google+ API is enabled
- Check browser console for errors
