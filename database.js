const { Pool } = require('pg');

const config = require('./config');
const emailService = require('./emailService');

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.server.nodeEnv === 'production' ? {
        rejectUnauthorized: false
    } : false
});

// Test database connection
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle PostgreSQL client', err);
});

// Initialize database tables
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        console.log('🔧 Initializing database tables...');
        
        // Create statistics table
        await client.query(`
            CREATE TABLE IF NOT EXISTS statistics (
                id SERIAL PRIMARY KEY,
                total_requests INTEGER DEFAULT 0,
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create users table for Google OAuth
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                google_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT,
                balance NUMERIC(10,2) DEFAULT ${config.user.defaultBalance},
                plan TEXT DEFAULT 'free',
                daily_limit INTEGER DEFAULT ${config.user.freePlanDailyLimit},
                total_requests_sent INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_balance_reset DATE DEFAULT CURRENT_DATE,
                last_ip_address TEXT,
                is_banned BOOLEAN DEFAULT false,
                banned_at TIMESTAMP
            )
        `);
        
        // Add ban and IP columns if they don't exist (for existing databases)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'last_ip_address') THEN
                    ALTER TABLE users ADD COLUMN last_ip_address TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'is_banned') THEN
                    ALTER TABLE users ADD COLUMN is_banned BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'banned_at') THEN
                    ALTER TABLE users ADD COLUMN banned_at TIMESTAMP;
                END IF;
            END $$;
        `);
        
        // Add last_balance_reset column if it doesn't exist (for existing databases)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'last_balance_reset') THEN
                    ALTER TABLE users ADD COLUMN last_balance_reset DATE DEFAULT CURRENT_DATE;
                END IF;
            END $$;
        `);
        
        // Migrate balance column from INTEGER to NUMERIC(10,2) for USD support
        console.log('🔄 Checking if balance migration is needed...');
        const balanceTypeCheck = await client.query(`
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'balance'
        `);
        
        if (balanceTypeCheck.rows[0]?.data_type === 'integer') {
            console.log('🚀 MIGRATION STARTING: Converting coin balances to USD dollars...');
            console.log('   Formula: 1 coin = $0.10 USD');
            
            // Get count of users before migration
            const userCount = await client.query(`SELECT COUNT(*) as count FROM users`);
            console.log(`   Found ${userCount.rows[0].count} users to migrate`);
            
            await client.query(`
                DO $$ 
                BEGIN
                    -- Convert integer coins to USD (1 coin = $0.10)
                    ALTER TABLE users ALTER COLUMN balance TYPE NUMERIC(10,2) USING (balance * 0.10);
                    -- Update default value
                    ALTER TABLE users ALTER COLUMN balance SET DEFAULT ${config.user.defaultBalance};
                END $$;
            `);
            
            console.log('✅ MIGRATION COMPLETE: All user balances converted to USD!');
            console.log('   Example: 50 coins → $5.00 USD');
        } else {
            console.log('✅ Balance column already in USD format (NUMERIC) - skipping migration');
        }
        
        // Add fingerprint_id column if it doesn't exist (for AI ban system)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'fingerprint_id') THEN
                    ALTER TABLE users ADD COLUMN fingerprint_id TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'ban_reason') THEN
                    ALTER TABLE users ADD COLUMN ban_reason TEXT;
                END IF;
            END $$;
        `);
        
        // Add Ultra Premium subscription columns if they don't exist
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'plan_type') THEN
                    ALTER TABLE users ADD COLUMN plan_type TEXT DEFAULT 'free' CHECK (plan_type IN ('free', 'premium', 'ultra'));
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'plan_expires_at') THEN
                    ALTER TABLE users ADD COLUMN plan_expires_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'is_unlimited') THEN
                    ALTER TABLE users ADD COLUMN is_unlimited BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'users' AND column_name = 'offer_ends_at') THEN
                    ALTER TABLE users ADD COLUMN offer_ends_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // Migrate amount column in transactions table from INTEGER to NUMERIC(10,2) for USD
        console.log('🔄 Checking if transactions amount migration is needed...');
        const amountTypeCheck = await client.query(`
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' AND column_name = 'amount'
        `);
        
        if (amountTypeCheck.rows.length > 0 && amountTypeCheck.rows[0]?.data_type === 'integer') {
            console.log('🚀 MIGRATION STARTING: Converting transaction amounts to USD...');
            
            const txCount = await client.query(`SELECT COUNT(*) as count FROM transactions`);
            console.log(`   Found ${txCount.rows[0].count} transactions to migrate`);
            
            await client.query(`
                DO $$ 
                BEGIN
                    ALTER TABLE transactions ALTER COLUMN amount TYPE NUMERIC(10,2) USING (amount * 0.10);
                END $$;
            `);
            
            console.log('✅ MIGRATION COMPLETE: All transaction amounts converted to USD!');
        } else {
            console.log('✅ Transaction amounts already in USD format - skipping migration');
        }

        // Create transactions table for credit history
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                details TEXT,
                amount NUMERIC(10,2) NOT NULL,
                status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'failed')),
                proof_file TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add proof_file column if it doesn't exist (for existing databases)
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'transactions' AND column_name = 'proof_file') THEN
                    ALTER TABLE transactions ADD COLUMN proof_file TEXT;
                END IF;
            END $$;
        `);

        // Create auto_react_channels table for auto react subscriptions
        await client.query(`
            CREATE TABLE IF NOT EXISTS auto_react_channels (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                channel_link TEXT NOT NULL,
                channel_jid TEXT,
                channel_name TEXT,
                channel_followers INTEGER,
                channel_preview TEXT,
                emojis JSONB,
                days INTEGER NOT NULL,
                coins_per_day INTEGER DEFAULT ${config.autoReact.costPerDay},
                total_coins INTEGER NOT NULL,
                status TEXT DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'expired')),
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        // Create requests table
        await client.query(`
            CREATE TABLE IF NOT EXISTS requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                channel_link TEXT NOT NULL,
                channel_jid TEXT,
                channel_name TEXT,
                channel_followers INTEGER,
                channel_preview TEXT,
                emojis JSONB,
                ip_address TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN DEFAULT true
            )
        `);

        // Create rate_limits table for tracking daily limits
        await client.query(`
            CREATE TABLE IF NOT EXISTS rate_limits (
                id SERIAL PRIMARY KEY,
                identifier TEXT NOT NULL,
                identifier_type TEXT NOT NULL,
                request_count INTEGER DEFAULT 1,
                request_date DATE DEFAULT CURRENT_DATE,
                last_request_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(identifier, identifier_type, request_date)
            )
        `);

        // Create indexes for better query performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_requests_created_at 
            ON requests(created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier 
            ON rate_limits(identifier, identifier_type, request_date)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_google_id 
            ON users(google_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_user_id 
            ON transactions(user_id, created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_auto_react_channels_user_id 
            ON auto_react_channels(user_id)
        `);

        // Create ai_chat_history table for storing user AI chat messages
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_chat_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user_id 
            ON ai_chat_history(user_id, created_at DESC)
        `);

        // Add session_id column to ai_chat_history if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_name = 'ai_chat_history' AND column_name = 'session_id') THEN
                    ALTER TABLE ai_chat_history ADD COLUMN session_id TEXT;
                END IF;
            END $$;
        `);

        // Create site_settings table for maintenance mode and other settings
        await client.query(`
            CREATE TABLE IF NOT EXISTS site_settings (
                id SERIAL PRIMARY KEY,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create notifications table for admin to send messages to users
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
            ON notifications(user_id, created_at DESC)
        `);
        
        // Create user_fingerprints table for tracking device fingerprints
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_fingerprints (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                fingerprint_id TEXT NOT NULL,
                ip_address TEXT,
                browser_name TEXT,
                browser_version TEXT,
                os TEXT,
                device_type TEXT,
                user_agent TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                visit_count INTEGER DEFAULT 1,
                UNIQUE(user_id, fingerprint_id)
            )
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_fingerprints_fingerprint_id 
            ON user_fingerprints(fingerprint_id)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_fingerprints_user_id 
            ON user_fingerprints(user_id, last_seen DESC)
        `);
        
        // Create ban_logs table for AI ban decisions with reasoning
        await client.query(`
            CREATE TABLE IF NOT EXISTS ban_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                banned_by TEXT DEFAULT 'AI_SYSTEM',
                ban_reason TEXT NOT NULL,
                ai_analysis TEXT,
                fingerprint_id TEXT,
                related_user_ids INTEGER[],
                risk_score DECIMAL(3,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ban_logs_user_id 
            ON ban_logs(user_id, created_at DESC)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_ban_logs_fingerprint_id 
            ON ban_logs(fingerprint_id)
        `);

        // Create api_keys table for API key management
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                api_key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                request_limit INTEGER NOT NULL DEFAULT 100,
                usage_count INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_used_at TIMESTAMP,
                expires_at TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_keys_api_key 
            ON api_keys(api_key)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_keys_user_id 
            ON api_keys(user_id)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_keys_is_active 
            ON api_keys(is_active)
        `);

        // Create api_requests table for tracking API key usage
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_requests (
                id SERIAL PRIMARY KEY,
                api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                channel_link TEXT NOT NULL,
                emojis JSONB,
                ip_address TEXT,
                user_agent TEXT,
                success BOOLEAN DEFAULT true,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_requests_api_key_id 
            ON api_requests(api_key_id, created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_requests_created_at 
            ON api_requests(created_at DESC)
        `);

        // Create api_key_requests table for users requesting API access
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_key_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                admin_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP,
                reviewed_by TEXT,
                api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_key_requests_user_id 
            ON api_key_requests(user_id, created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_api_key_requests_status 
            ON api_key_requests(status, created_at DESC)
        `);

        // Create coupons table for coupon management
        await client.query(`
            CREATE TABLE IF NOT EXISTS coupons (
                id SERIAL PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                coin_amount INTEGER NOT NULL,
                usage_limit INTEGER NOT NULL,
                usage_count INTEGER DEFAULT 0,
                expiration_date TIMESTAMP NOT NULL,
                whatsapp_group_link TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT DEFAULT 'admin'
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_coupons_code 
            ON coupons(code)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_coupons_is_active 
            ON coupons(is_active)
        `);

        // Create coupon_claims table to track who claimed which coupons
        await client.query(`
            CREATE TABLE IF NOT EXISTS coupon_claims (
                id SERIAL PRIMARY KEY,
                coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(coupon_id, user_id)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_coupon_claims_coupon_id 
            ON coupon_claims(coupon_id, claimed_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_coupon_claims_user_id 
            ON coupon_claims(user_id, claimed_at DESC)
        `);

        // Create oxapay_orders table for OxaPay payments
        await client.query(`
            CREATE TABLE IF NOT EXISTS oxapay_orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                coins_requested INTEGER NOT NULL,
                expected_usdt_amount DECIMAL(10, 2) NOT NULL,
                oxapay_track_id TEXT,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'confirming', 'complete')),
                txid TEXT,
                paid_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_oxapay_orders_user_id 
            ON oxapay_orders(user_id, created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_oxapay_orders_status 
            ON oxapay_orders(status, created_at DESC)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_oxapay_orders_track_id 
            ON oxapay_orders(oxapay_track_id)
        `);

        // Create website_sale_orders table for direct website purchase payments
        await client.query(`
            CREATE TABLE IF NOT EXISTS website_sale_orders (
                id SERIAL PRIMARY KEY,
                buyer_email TEXT NOT NULL,
                buyer_name TEXT,
                amount DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
                oxapay_order_id TEXT UNIQUE,
                oxapay_track_id TEXT,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'confirming', 'complete')),
                txid TEXT,
                paid_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        // Initialize default maintenance mode setting if it doesn't exist
        await client.query(`
            INSERT INTO site_settings (setting_key, setting_value)
            VALUES ('maintenance_mode', 'false')
            ON CONFLICT (setting_key) DO NOTHING
        `);

        // Initialize statistics record if it doesn't exist
        const statsResult = await client.query('SELECT EXISTS(SELECT 1 FROM statistics) as exists');
        if (!statsResult.rows[0].exists) {
            await client.query(`
                INSERT INTO statistics (total_requests, start_time, last_updated)
                VALUES (0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `);
            console.log('✅ Statistics record initialized');
        }

        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Get current statistics from database
async function getStatistics() {
    try {
        const result = await pool.query(`
            SELECT total_requests, start_time, last_updated 
            FROM statistics 
            LIMIT 1
        `);
        
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        
        return {
            total_requests: 0,
            start_time: new Date(),
            last_updated: new Date()
        };
    } catch (error) {
        console.error('Error fetching statistics:', error);
        throw error;
    }
}

// Increment request count in statistics
async function incrementRequestCount() {
    try {
        await pool.query(`
            UPDATE statistics 
            SET total_requests = total_requests + 1,
                last_updated = CURRENT_TIMESTAMP
        `);
    } catch (error) {
        console.error('Error incrementing request count:', error);
        throw error;
    }
}

// Save a request to the database
async function saveRequest(requestData) {
    const { userId, channelLink, channelJid, channelName, channelFollowers, channelPreview, emojis, ipAddress, success } = requestData;
    
    try {
        const result = await pool.query(`
            INSERT INTO requests (
                user_id, channel_link, channel_jid, channel_name, channel_followers, 
                channel_preview, emojis, ip_address, success, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
            RETURNING id, created_at
        `, [userId || null, channelLink, channelJid, channelName, channelFollowers, channelPreview, JSON.stringify(emojis), ipAddress, success]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error saving request:', error);
        throw error;
    }
}

// Get last N channel requests
async function getLatestRequests(limit = 5) {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                channel_link,
                channel_jid,
                channel_name,
                channel_followers,
                channel_preview,
                emojis,
                created_at,
                success
            FROM requests
            WHERE success = true AND channel_name IS NOT NULL
            ORDER BY created_at DESC
            LIMIT $1
        `, [limit]);
        
        return result.rows;
    } catch (error) {
        console.error('Error fetching latest requests:', error);
        // Return empty array instead of throwing
        return [];
    }
}

// Check rate limit for an identifier (IP or channel JID)
async function checkRateLimit(identifier, identifierType) {
    const limit = config.rateLimit.perDay;
    
    try {
        // Get current date in America/Port-au-Prince timezone
        const haitiDate = new Date().toLocaleString('en-US', { 
            timeZone: 'America/Port-au-Prince',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [month, day, year] = haitiDate.split('/');
        const currentDate = `${year}-${month}-${day}`;
        
        // Check if record exists for today (Haiti timezone)
        const result = await pool.query(`
            SELECT request_count, request_date
            FROM rate_limits
            WHERE identifier = $1 
                AND identifier_type = $2 
                AND request_date::text = $3
        `, [identifier, identifierType, currentDate]);

        if (result.rows.length > 0) {
            const currentCount = result.rows[0].request_count;
            if (currentCount >= limit) {
                return {
                    allowed: false,
                    remaining: 0,
                    resetTime: 'tomorrow',
                    message: `Rate limit exceeded! You've used all ${limit} daily requests. Please be patient and try again tomorrow, or upgrade to Premium for unlimited requests.`
                };
            }
            
            return {
                allowed: true,
                remaining: limit - currentCount,
                current: currentCount
            };
        }

        // No record for today, allow the request
        return {
            allowed: true,
            remaining: limit,
            current: 0
        };
    } catch (error) {
        console.error('Error checking rate limit:', error);
        // Allow request on database error (fail open)
        return {
            allowed: true,
            remaining: limit,
            current: 0
        };
    }
}

// Increment rate limit counter for an identifier
async function incrementRateLimit(identifier, identifierType) {
    try {
        // Get current date in America/Port-au-Prince timezone
        const haitiDate = new Date().toLocaleString('en-US', { 
            timeZone: 'America/Port-au-Prince',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [month, day, year] = haitiDate.split('/');
        const currentDate = `${year}-${month}-${day}`;
        
        await pool.query(`
            INSERT INTO rate_limits (identifier, identifier_type, request_count, request_date, last_request_at)
            VALUES ($1, $2, 1, $3::date, CURRENT_TIMESTAMP)
            ON CONFLICT (identifier, identifier_type, request_date)
            DO UPDATE SET 
                request_count = rate_limits.request_count + 1,
                last_request_at = CURRENT_TIMESTAMP
        `, [identifier, identifierType, currentDate]);
    } catch (error) {
        console.error('Error incrementing rate limit:', error);
        throw error;
    }
}

// Clean up old rate limit records (older than 7 days)
async function cleanupOldRateLimits() {
    try {
        await pool.query(`
            DELETE FROM rate_limits
            WHERE request_date < CURRENT_DATE - INTERVAL '7 days'
        `);
    } catch (error) {
        console.error('Error cleaning up old rate limits:', error);
    }
}

// Clean up old notifications (older than configured retention days)
async function cleanupOldNotifications() {
    try {
        const retentionDays = config.dataRetention?.notificationsMaxDays || 3;
        const result = await pool.query(`
            DELETE FROM notifications
            WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
            RETURNING id
        `, [retentionDays]);
        const deletedCount = result.rowCount;
        if (deletedCount > 0) {
            console.log(`🗑️ Cleaned up ${deletedCount} old notification(s) (older than ${retentionDays} days)`);
        }
        return deletedCount;
    } catch (error) {
        console.error('Error cleaning up old notifications:', error);
        return 0;
    }
}

// Clean up old AI chat history (older than configured retention days)
async function cleanupOldChatHistory() {
    try {
        const retentionDays = config.dataRetention?.chatHistoryMaxDays || 3;
        const result = await pool.query(`
            DELETE FROM ai_chat_history
            WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
            RETURNING id
        `, [retentionDays]);
        const deletedCount = result.rowCount;
        if (deletedCount > 0) {
            console.log(`🗑️ Cleaned up ${deletedCount} old AI chat history record(s) (older than ${retentionDays} days)`);
        }
        return deletedCount;
    } catch (error) {
        console.error('Error cleaning up old AI chat history:', error);
        return 0;
    }
}

// Clean up all old data (notifications and chat history) - runs on startup and periodically
async function cleanupOldData() {
    const notificationsDays = config.dataRetention?.notificationsMaxDays || 3;
    const chatHistoryDays = config.dataRetention?.chatHistoryMaxDays || 3;
    console.log(`🧹 Running cleanup for notifications (>${notificationsDays} days) and chat history (>${chatHistoryDays} days)...`);
    const notificationsDeleted = await cleanupOldNotifications();
    const chatHistoryDeleted = await cleanupOldChatHistory();
    console.log(`✅ Cleanup complete: ${notificationsDeleted} notifications, ${chatHistoryDeleted} chat history records deleted`);
    return {
        notificationsDeleted,
        chatHistoryDeleted
    };
}

// ================== USER FUNCTIONS ==================

// Find or create user from Google profile
async function findOrCreateUser(googleProfile) {
    const { id: googleId, emails, displayName, photos } = googleProfile;
    const email = emails && emails[0] ? emails[0].value : null;
    const avatar = photos && photos[0] ? photos[0].value : null;
    
    try {
        // Check if user exists
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE google_id = $1',
            [googleId]
        );
        
        if (existingUser.rows.length > 0) {
            // Update last login
            await pool.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP, avatar = $1, name = $2 WHERE google_id = $3',
                [avatar, displayName, googleId]
            );
            // Return the user - getUserById will handle daily balance reset check
            return existingUser.rows[0];
        }
        
        // Create new user with welcome bonus and set last_balance_reset to today
        const result = await pool.query(`
            INSERT INTO users (google_id, email, name, avatar, balance, plan, created_at, last_login, last_balance_reset)
            VALUES ($1, $2, $3, $4, $5, 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_DATE)
            RETURNING *
        `, [googleId, email, displayName, avatar, config.user.defaultBalance]);
        
        const newUser = result.rows[0];
        
        // Add welcome bonus transaction
        await pool.query(`
            INSERT INTO transactions (user_id, type, category, description, details, amount, status)
            VALUES ($1, 'credit', 'bonus', 'Welcome Bonus', 'New user reward for signing up', $2, 'completed')
        `, [newUser.id, config.user.defaultBalance]);
        
        // Send welcome email to new user (async, don't await to not block login)
        if (email) {
            emailService.sendWelcomeEmail(email, displayName).catch(err => {
                console.error('Failed to send welcome email:', err);
            });
        }
        
        return newUser;
    } catch (error) {
        console.error('Error finding or creating user:', error);
        throw error;
    }
}

// Create or retrieve the read-only demo user account
async function createOrGetDemoUser() {
    const DEMO_GOOGLE_ID = 'demo-readonly-user-2025';
    const DEMO_EMAIL = 'demo@easy-booster.demo';
    const DEMO_NAME = 'Demo User';
    try {
        const existing = await pool.query('SELECT * FROM users WHERE google_id = $1', [DEMO_GOOGLE_ID]);
        if (existing.rows.length > 0) {
            await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE google_id = $1', [DEMO_GOOGLE_ID]);
            return existing.rows[0];
        }
        const result = await pool.query(`
            INSERT INTO users (google_id, email, name, avatar, balance, plan, created_at, last_login, last_balance_reset)
            VALUES ($1, $2, $3, $4, 0, 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_DATE)
            RETURNING *
        `, [DEMO_GOOGLE_ID, DEMO_EMAIL, DEMO_NAME, null]);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating demo user:', error);
        throw error;
    }
}

// Get user by ID - also checks and resets daily balance if needed
async function getUserById(userId) {
    try {
        // Get current date in America/Port-au-Prince timezone for consistency
        const haitiDate = new Date().toLocaleString('en-US', { 
            timeZone: 'America/Port-au-Prince',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [month, day, year] = haitiDate.split('/');
        const currentDate = `${year}-${month}-${day}`;
        
        // Check if user needs daily balance reset
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const user = result.rows[0];
        
        // Check if balance needs to be reset (new day)
        // Only reset for 'free' plan users - premium users might have purchased coins
        if (user.plan === 'free') {
            // Extract the date from last_balance_reset properly
            // PostgreSQL DATE type returns as JavaScript Date at midnight UTC
            // We need to extract just the date part without timezone conversion
            let lastResetDate = null;
            if (user.last_balance_reset) {
                // Convert the Date object to ISO string and extract just the date part (YYYY-MM-DD)
                // This avoids timezone conversion issues when PostgreSQL DATE becomes JS Date
                if (user.last_balance_reset instanceof Date) {
                    // Use UTC methods to get the date as stored in PostgreSQL
                    const yr = user.last_balance_reset.getUTCFullYear();
                    const mo = String(user.last_balance_reset.getUTCMonth() + 1).padStart(2, '0');
                    const dy = String(user.last_balance_reset.getUTCDate()).padStart(2, '0');
                    lastResetDate = `${yr}-${mo}-${dy}`;
                } else {
                    // If it's a string, try to parse it safely
                    const strVal = String(user.last_balance_reset);
                    // Check if it matches YYYY-MM-DD format
                    const dateMatch = strVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (dateMatch) {
                        lastResetDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
                    } else {
                        // Unexpected format - trigger reset by leaving lastResetDate as null
                        console.warn(`Unexpected date format for last_balance_reset: ${strVal}`);
                    }
                }
            }
            
            if (lastResetDate !== currentDate) {
                const oldBalance = user.balance;
                const newBalance = config.user.defaultBalance;
                const creditAmount = newBalance; // For daily reset, we credit the full amount as it's a refresh
                
                // Use a database transaction to ensure atomicity
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    // Reset balance to default for new day
                    const updateResult = await client.query(`
                        UPDATE users 
                        SET balance = $1, last_balance_reset = $2::date
                        WHERE id = $3
                        RETURNING *
                    `, [newBalance, currentDate, userId]);
                    
                    // Log the daily reset transaction (show the credit amount)
                    await client.query(`
                        INSERT INTO transactions (user_id, type, category, description, details, amount, status)
                        VALUES ($1, 'credit', 'daily-reset', 'Daily Balance Reset', $2, $3, 'completed')
                    `, [userId, `Free daily balance restored (was $${oldBalance.toFixed(2)}, now $${newBalance.toFixed(2)})`, creditAmount]);
                    
                    await client.query('COMMIT');
                    
                    console.log(`✅ Daily balance reset for user ${userId}: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)}`);
                    
                    return updateResult.rows[0];
                } catch (txError) {
                    await client.query('ROLLBACK');
                    console.error('Error during daily balance reset transaction:', txError);
                    // Return original user data on error
                    return user;
                } finally {
                    client.release();
                }
            }
        }
        
        return user;
    } catch (error) {
        console.error('Error getting user by ID:', error);
        throw error;
    }
}

// Get user stats (daily limit remaining, etc.)
async function getUserStats(userId) {
    const dailyLimit = config.rateLimit.perDay;
    
    try {
        // Get user info
        const userResult = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return null;
        }
        
        const user = userResult.rows[0];
        
        // Check if user is premium - premium users have unlimited daily requests
        const isPremium = user.plan === 'premium';
        
        // Get today's request count for the user
        const haitiDate = new Date().toLocaleString('en-US', { 
            timeZone: 'America/Port-au-Prince',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const [month, day, year] = haitiDate.split('/');
        const currentDate = `${year}-${month}-${day}`;
        
        const rateLimitResult = await pool.query(`
            SELECT request_count FROM rate_limits 
            WHERE identifier = $1 AND identifier_type = 'user' AND request_date::text = $2
        `, [userId.toString(), currentDate]);
        
        const usedToday = rateLimitResult.rows.length > 0 ? rateLimitResult.rows[0].request_count : 0;
        
        // Premium users have unlimited remaining, free users are limited
        const remainingToday = isPremium ? 'unlimited' : Math.max(0, dailyLimit - usedToday);
        
        // Get active auto react channels count
        const autoReactResult = await pool.query(`
            SELECT COUNT(*) as count FROM auto_react_channels 
            WHERE user_id = $1 AND status = 'active' AND expires_at > CURRENT_TIMESTAMP
        `, [userId]);
        
        const activeAutoReact = parseInt(autoReactResult.rows[0].count);
        
        // Get total orders count for the user
        const ordersResult = await pool.query(`
            SELECT COUNT(*) as count FROM requests 
            WHERE user_id = $1
        `, [userId]);
        
        const totalOrders = parseInt(ordersResult.rows[0].count);
        
        // Calculate next reset time (midnight Haiti timezone)
        // Use proper timezone calculation with Intl.DateTimeFormat
        const now = new Date();
        
        // Get Haiti timezone offset parts
        const haitiFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Port-au-Prince',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const haitiParts = haitiFormatter.formatToParts(now);
        const getPart = (type) => haitiParts.find(p => p.type === type)?.value || '0';
        
        const haitiHour = parseInt(getPart('hour'));
        const haitiMinute = parseInt(getPart('minute'));
        const haitiSecond = parseInt(getPart('second'));
        
        // Calculate time until midnight in Haiti timezone
        // Time remaining = (24 - current hour - 1) hours + (60 - current minute - 1) minutes + (60 - current second) seconds
        const hoursUntilReset = 23 - haitiHour;
        const minutesUntilReset = 59 - haitiMinute;
        const secondsUntilReset = 60 - haitiSecond;
        
        // Convert to total milliseconds
        const timeUntilReset = (hoursUntilReset * 60 * 60 + minutesUntilReset * 60 + secondsUntilReset) * 1000;
        
        return {
            balance: user.balance,
            plan: user.plan,
            dailyLimit: isPremium ? 'unlimited' : dailyLimit,
            usedToday: usedToday,
            remainingToday: remainingToday,
            unlimited: isPremium,
            totalSent: user.total_requests_sent,
            totalOrders: totalOrders,
            activeAutoReact: activeAutoReact,
            memberSince: user.created_at,
            // Reset time information (not applicable for premium users, but included for consistency)
            resetIn: {
                hours: hoursUntilReset,
                minutes: minutesUntilReset,
                seconds: secondsUntilReset,
                totalMs: timeUntilReset,
                formatted: `${hoursUntilReset}h ${minutesUntilReset}m`
            }
        };
    } catch (error) {
        console.error('Error getting user stats:', error);
        throw error;
    }
}

// Update user balance - uses separate queries to avoid SQL injection
async function updateUserBalance(userId, amount, type = 'debit') {
    try {
        let result;
        if (type === 'credit') {
            result = await pool.query(`
                UPDATE users 
                SET balance = balance + $1
                WHERE id = $2
                RETURNING balance, plan
            `, [Math.abs(amount), userId]);
        } else {
            result = await pool.query(`
                UPDATE users 
                SET balance = balance - $1
                WHERE id = $2
                RETURNING balance, plan
            `, [Math.abs(amount), userId]);
        }
        
        const newBalance = result.rows[0]?.balance;
        const currentPlan = result.rows[0]?.plan;
        
        // Automatic plan management based on balance
        // If balance >= 10: Upgrade to premium
        // If balance <= 9: Downgrade to free
        let newPlan = currentPlan;
        
        if (newBalance >= 10 && currentPlan !== 'premium') {
            // Auto-upgrade to premium
            await pool.query(`
                UPDATE users 
                SET plan = 'premium'
                WHERE id = $1
            `, [userId]);
            newPlan = 'premium';
            console.log(`✨ Auto-upgraded user ${userId} to Premium (balance: $${newBalance.toFixed(2)})`);
        } else if (newBalance <= 9 && currentPlan === 'premium') {
            // Auto-downgrade to free
            await pool.query(`
                UPDATE users 
                SET plan = 'free'
                WHERE id = $1
            `, [userId]);
            newPlan = 'free';
            console.log(`⬇️ Auto-downgraded user ${userId} to Free (balance: $${newBalance.toFixed(2)})`);
        }
        
        return newBalance;
    } catch (error) {
        console.error('Error updating user balance:', error);
        throw error;
    }
}

// Increment user's total requests sent
async function incrementUserRequestCount(userId) {
    try {
        await pool.query(`
            UPDATE users 
            SET total_requests_sent = total_requests_sent + 1
            WHERE id = $1
        `, [userId]);
    } catch (error) {
        console.error('Error incrementing user request count:', error);
    }
}

// ================== TRANSACTION FUNCTIONS ==================

// Add a transaction
async function addTransaction(userId, transactionData) {
    const { type, category, description, details, amount, status = 'completed', proofFile = null } = transactionData;
    
    try {
        const result = await pool.query(`
            INSERT INTO transactions (user_id, type, category, description, details, amount, status, proof_file)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [userId, type, category, description, details, amount, status, proofFile]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error adding transaction:', error);
        throw error;
    }
}

// Get user transactions
async function getUserTransactions(userId, limit = 50, filter = 'all') {
    try {
        let query = `
            SELECT * FROM transactions 
            WHERE user_id = $1
        `;
        const params = [userId];
        
        if (filter === 'credit') {
            query += ` AND type = 'credit'`;
        } else if (filter === 'debit') {
            query += ` AND type = 'debit'`;
        } else if (filter !== 'all') {
            query += ` AND category = $2`;
            params.push(filter);
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error getting user transactions:', error);
        return [];
    }
}

// Get user transaction summary
async function getUserTransactionSummary(userId) {
    try {
        const result = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_credited,
                COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_debited,
                COUNT(*) as total_transactions
            FROM transactions 
            WHERE user_id = $1
        `, [userId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error getting transaction summary:', error);
        return { total_credited: 0, total_debited: 0, total_transactions: 0 };
    }
}

// ================== AUTO REACT CHANNEL FUNCTIONS ==================

// Purchase auto react channel with atomic transaction (prevents race conditions)
// Cost: 10 coins per day
async function purchaseAutoReactChannel(userId, channelData) {
    const { 
        channelLink, channelJid, channelName, channelFollowers, channelPreview, 
        emojis, days, coinsPerDay = 10 
    } = channelData;
    
    const totalCoins = days * coinsPerDay;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Lock user row and check balance atomically
        const userResult = await client.query(
            'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const currentBalance = userResult.rows[0].balance;
        if (currentBalance < totalCoins) {
            throw new Error('Insufficient balance');
        }
        
        // Deduct balance
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [totalCoins, userId]
        );
        
        // Register channel
        const channelResult = await client.query(`
            INSERT INTO auto_react_channels (
                user_id, channel_link, channel_jid, channel_name, channel_followers,
                channel_preview, emojis, days, coins_per_day, total_coins, status, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
            RETURNING *
        `, [
            userId, channelLink, channelJid, channelName, channelFollowers,
            channelPreview, JSON.stringify(emojis), days, coinsPerDay, totalCoins, expiresAt
        ]);
        
        // Add transaction record
        await client.query(`
            INSERT INTO transactions (user_id, type, category, description, details, amount, status)
            VALUES ($1, 'debit', 'auto-react', $2, $3, $4, 'completed')
        `, [userId, `Auto React - ${channelName || 'Channel'}`, `${days} days subscription`, totalCoins]);
        
        await client.query('COMMIT');
        
        return { 
            success: true, 
            channel: channelResult.rows[0],
            newBalance: currentBalance - totalCoins
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error purchasing auto react channel:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Register auto react channel (legacy function, use purchaseAutoReactChannel instead)
// Cost: 10 coins per day
async function registerAutoReactChannel(userId, channelData) {
    const { 
        channelLink, channelJid, channelName, channelFollowers, channelPreview, 
        emojis, days, coinsPerDay = 10 
    } = channelData;
    
    const totalCoins = days * coinsPerDay;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    
    try {
        const result = await pool.query(`
            INSERT INTO auto_react_channels (
                user_id, channel_link, channel_jid, channel_name, channel_followers,
                channel_preview, emojis, days, coins_per_day, total_coins, status, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
            RETURNING *
        `, [
            userId, channelLink, channelJid, channelName, channelFollowers,
            channelPreview, JSON.stringify(emojis), days, coinsPerDay, totalCoins, expiresAt
        ]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error registering auto react channel:', error);
        throw error;
    }
}

// Get user's auto react channels
async function getUserAutoReactChannels(userId, filter = 'all') {
    try {
        // First, update expired channels
        await pool.query(`
            UPDATE auto_react_channels 
            SET status = 'expired' 
            WHERE user_id = $1 AND status = 'active' AND expires_at < CURRENT_TIMESTAMP
        `, [userId]);
        
        let query = 'SELECT * FROM auto_react_channels WHERE user_id = $1';
        const params = [userId];
        
        if (filter !== 'all') {
            query += ' AND status = $2';
            params.push(filter);
        }
        
        query += ' ORDER BY registered_at DESC';
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error getting user auto react channels:', error);
        return [];
    }
}

// Get auto react channel stats for user
async function getAutoReactStats(userId) {
    try {
        // Update expired channels first
        await pool.query(`
            UPDATE auto_react_channels 
            SET status = 'expired' 
            WHERE user_id = $1 AND status = 'active' AND expires_at < CURRENT_TIMESTAMP
        `, [userId]);
        
        const result = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'active') as active_count,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'expired') as expired_count,
                COUNT(*) as total_count
            FROM auto_react_channels 
            WHERE user_id = $1
        `, [userId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error getting auto react stats:', error);
        return { active_count: 0, pending_count: 0, expired_count: 0, total_count: 0 };
    }
}

// ================== WHATSAPP CHANNEL FOLLOWERS FUNCTIONS ==================

// Purchase channel followers with atomic transaction
// Uses 5SMM API service ID 12258
async function purchaseChannelFollowers(userId, orderData) {
    const { channelLink, quantity, totalUSD, smmOrderId } = orderData;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Lock user row and check balance atomically
        const userResult = await client.query(
            'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const currentBalance = parseFloat(userResult.rows[0].balance);
        if (currentBalance < totalUSD) {
            throw new Error('Insufficient balance');
        }
        
        // Deduct balance in USD
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [totalUSD, userId]
        );
        
        // Record the follower purchase (store in transactions table)
        const transactionResult = await client.query(`
            INSERT INTO transactions (
                user_id, type, category, description, details, amount, status, metadata
            )
            VALUES ($1, 'debit', 'channel-followers', $2, $3, $4, 'completed', $5)
            RETURNING *
        `, [
            userId, 
            'WhatsApp Channel Followers', 
            `${quantity} followers for ${channelLink}`,
            totalUSD,
            JSON.stringify({ 
                channelLink, 
                quantity, 
                smmOrderId,
                timestamp: new Date().toISOString()
            })
        ]);
        
        await client.query('COMMIT');
        
        return { 
            success: true, 
            transaction: transactionResult.rows[0],
            newBalance: currentBalance - totalUSD
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error purchasing channel followers:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Get user's channel follower orders
async function getUserChannelFollowerOrders(userId, limit = 50) {
    try {
        const result = await pool.query(`
            SELECT *
            FROM transactions
            WHERE user_id = $1 AND category = 'channel-followers'
            ORDER BY created_at DESC
            LIMIT $2
        `, [userId, limit]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting channel follower orders:', error);
        return [];
    }
}

// ================== SMM SERVICES FUNCTIONS ==================

// Purchase SMM service (TikTok Views, Instagram Followers, etc.)
async function purchaseSMMService(userId, orderData) {
    const { serviceType, serviceName, link, quantity, priceUSD, smmOrderId } = orderData;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Lock user row and check balance atomically
        const userResult = await client.query(
            'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const currentBalance = parseFloat(userResult.rows[0].balance);
        if (currentBalance < priceUSD) {
            throw new Error('Insufficient balance');
        }
        
        // Deduct balance
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [priceUSD, userId]
        );
        
        // Record the purchase (store in transactions table)
        const transactionResult = await client.query(`
            INSERT INTO transactions (
                user_id, type, category, description, details, amount, status, metadata
            )
            VALUES ($1, 'debit', $2, $3, $4, $5, 'completed', $6)
            RETURNING *
        `, [
            userId, 
            `smm-${serviceType}`,
            serviceName, 
            `${quantity} ${serviceType} for ${link}`,
            priceUSD,
            JSON.stringify({ 
                serviceType,
                link, 
                quantity, 
                smmOrderId,
                timestamp: new Date().toISOString()
            })
        ]);
        
        await client.query('COMMIT');
        
        return { 
            success: true, 
            transaction: transactionResult.rows[0],
            newBalance: currentBalance - priceUSD
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error purchasing SMM service:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Get user's SMM service orders
async function getUserSMMOrders(userId, serviceType = null, limit = 50) {
    try {
        let query;
        let params;
        
        if (serviceType) {
            query = `
                SELECT *
                FROM transactions
                WHERE user_id = $1 AND category = $2
                ORDER BY created_at DESC
                LIMIT $3
            `;
            params = [userId, `smm-${serviceType}`, limit];
        } else {
            query = `
                SELECT *
                FROM transactions
                WHERE user_id = $1 AND category LIKE 'smm-%'
                ORDER BY created_at DESC
                LIMIT $2
            `;
            params = [userId, limit];
        }
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error getting SMM orders:', error);
        return [];
    }
}

// ================== AI CHAT HISTORY FUNCTIONS ==================

// Save a chat message to history
async function saveAiChatMessage(userId, role, content, sessionId = null) {
    try {
        const result = await pool.query(`
            INSERT INTO ai_chat_history (user_id, role, content, session_id, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING id, created_at
        `, [userId, role, content, sessionId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error saving AI chat message:', error);
        throw error;
    }
}

// Get user's AI chat history
async function getAiChatHistory(userId, limit = 50) {
    try {
        const result = await pool.query(`
            SELECT id, role, content, created_at
            FROM ai_chat_history
            WHERE user_id = $1
            ORDER BY created_at ASC
            LIMIT $2
        `, [userId, limit]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting AI chat history:', error);
        return [];
    }
}

// Clear user's AI chat history
async function clearAiChatHistory(userId) {
    try {
        await pool.query(`
            DELETE FROM ai_chat_history
            WHERE user_id = $1
        `, [userId]);
        return true;
    } catch (error) {
        console.error('Error clearing AI chat history:', error);
        throw error;
    }
}

// ================== ADMIN FUNCTIONS ==================

// Get all users for admin (with pagination and search)
async function getUsersPaginated(page = 1, limit = 25, search = '', sortBy = 'created_at', sortOrder = 'DESC') {
    try {
        const offset = (page - 1) * limit;
        
        // Build search condition
        let searchCondition = '';
        const params = [];
        if (search && search.trim()) {
            searchCondition = `WHERE (name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`;
            params.push(`%${search.trim()}%`);
        }
        
        // Validate sort column to prevent SQL injection
        const validSortColumns = ['id', 'name', 'email', 'balance', 'plan', 'created_at', 'last_login', 'total_requests_sent'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        // Get total count
        const countResult = await pool.query(`
            SELECT COUNT(*) as total FROM users ${searchCondition}
        `, params);
        const total = parseInt(countResult.rows[0].total);
        
        // Get paginated users
        params.push(limit, offset);
        const result = await pool.query(`
            SELECT id, google_id, email, name, avatar, balance, plan, daily_limit, 
                   total_requests_sent, created_at, last_login, last_ip_address, is_banned, banned_at
            FROM users
            ${searchCondition}
            ORDER BY ${sortColumn} ${order}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);
        
        return {
            users: result.rows,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        };
    } catch (error) {
        console.error('Error getting paginated users:', error);
        throw error;
    }
}

// Get all users for admin (legacy - no pagination)
async function getAllUsers() {
    try {
        const result = await pool.query(`
            SELECT id, google_id, email, name, avatar, balance, plan, daily_limit, 
                   total_requests_sent, created_at, last_login, last_ip_address, is_banned, banned_at
            FROM users
            ORDER BY created_at DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting all users:', error);
        return [];
    }
}

// Get all payment requests for admin
async function getAllPaymentRequests(status = null) {
    try {
        let query = `
            SELECT t.*, u.name as user_name, u.email as user_email
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE t.category = 'purchase'
        `;
        const params = [];
        
        if (status) {
            query += ` AND t.status = $1`;
            params.push(status);
        }
        
        query += ` ORDER BY t.created_at DESC`;
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error getting payment requests:', error);
        return [];
    }
}

// Update user plan (free/premium)
async function updateUserPlan(userId, plan) {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET plan = $1
            WHERE id = $2
            RETURNING *
        `, [plan, userId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error updating user plan:', error);
        throw error;
    }
}

// Set user balance (absolute value)
async function setUserBalance(userId, balance) {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET balance = $1
            WHERE id = $2
            RETURNING balance, plan
        `, [balance, userId]);
        
        const newBalance = result.rows[0]?.balance;
        const currentPlan = result.rows[0]?.plan;
        
        // Automatic plan management based on balance
        // If balance >= 10: Upgrade to premium
        // If balance <= 9: Downgrade to free
        if (newBalance >= 10 && currentPlan !== 'premium') {
            // Auto-upgrade to premium
            await pool.query(`
                UPDATE users 
                SET plan = 'premium'
                WHERE id = $1
            `, [userId]);
            console.log(`✨ Auto-upgraded user ${userId} to Premium (balance: $${newBalance.toFixed(2)} USD)`);
        } else if (newBalance <= 9 && currentPlan === 'premium') {
            // Auto-downgrade to free
            await pool.query(`
                UPDATE users 
                SET plan = 'free'
                WHERE id = $1
            `, [userId]);
            console.log(`⬇️ Auto-downgraded user ${userId} to Free (balance: $${newBalance.toFixed(2)})`);
        }
        
        return newBalance;
    } catch (error) {
        console.error('Error setting user balance:', error);
        throw error;
    }
}

// Update user daily limit (sync with coins)
async function updateUserDailyLimit(userId, dailyLimit) {
    try {
        await pool.query(`
            UPDATE users 
            SET daily_limit = $1
            WHERE id = $2
        `, [dailyLimit, userId]);
    } catch (error) {
        console.error('Error updating user daily limit:', error);
        throw error;
    }
}

// Delete user
async function deleteUser(userId) {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        return true;
    } catch (error) {
        console.error('Error deleting user:', error);
        throw error;
    }
}

// Update transaction status
async function updateTransactionStatus(transactionId, status) {
    try {
        const result = await pool.query(`
            UPDATE transactions 
            SET status = $1
            WHERE id = $2
            RETURNING *
        `, [status, transactionId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error updating transaction status:', error);
        throw error;
    }
}

// Get user by ID for admin (no daily reset)
async function getAdminUserById(userId) {
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting user by ID:', error);
        throw error;
    }
}

// Ban user
async function banUser(userId) {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET is_banned = true, banned_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [userId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error banning user:', error);
        throw error;
    }
}

// Unban user
async function unbanUser(userId) {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET is_banned = false, banned_at = NULL
            WHERE id = $1
            RETURNING *
        `, [userId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error unbanning user:', error);
        throw error;
    }
}

// Update user's last IP address
async function updateUserIpAddress(userId, ipAddress) {
    try {
        await pool.query(`
            UPDATE users 
            SET last_ip_address = $1
            WHERE id = $2
        `, [ipAddress, userId]);
    } catch (error) {
        console.error('Error updating user IP address:', error);
        // Don't throw - IP tracking is non-critical for core functionality.
        // Failing to update IP should not block user login or service access.
        // IP tracking is used for analytics and linked account detection only.
    }
}

// Get users with the same IP address (linked accounts detection)
async function getUsersWithSameIp(ipAddress) {
    try {
        const result = await pool.query(`
            SELECT id, name, email, avatar, balance, plan, is_banned, created_at, last_login, last_ip_address
            FROM users
            WHERE last_ip_address = $1
            ORDER BY created_at DESC
        `, [ipAddress]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting users with same IP:', error);
        return [];
    }
}

// Get all unique IP addresses with user count
async function getIpAddressesWithMultipleUsers() {
    try {
        const result = await pool.query(`
            SELECT last_ip_address, COUNT(*) as user_count, 
                   array_agg(json_build_object('id', id, 'name', name, 'email', email, 'is_banned', is_banned)) as users
            FROM users
            WHERE last_ip_address IS NOT NULL AND last_ip_address != 'unknown'
            GROUP BY last_ip_address
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
        `);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting IP addresses with multiple users:', error);
        return [];
    }
}

// Check if user is banned
async function isUserBanned(userId) {
    try {
        const result = await pool.query(
            'SELECT is_banned FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0]?.is_banned || false;
    } catch (error) {
        console.error('Error checking if user is banned:', error);
        return false;
    }
}

// ================== SITE SETTINGS FUNCTIONS ==================

// Get site setting by key
async function getSiteSetting(key) {
    try {
        const result = await pool.query(
            'SELECT setting_value FROM site_settings WHERE setting_key = $1',
            [key]
        );
        return result.rows[0]?.setting_value || null;
    } catch (error) {
        console.error('Error getting site setting:', error);
        return null;
    }
}

// Set site setting
async function setSiteSetting(key, value) {
    try {
        await pool.query(`
            INSERT INTO site_settings (setting_key, setting_value, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
        `, [key, value]);
        return true;
    } catch (error) {
        console.error('Error setting site setting:', error);
        return false;
    }
}

// Get maintenance mode status
async function isMaintenanceMode() {
    const value = await getSiteSetting('maintenance_mode');
    return value === 'true';
}

// Set maintenance mode
async function setMaintenanceMode(enabled) {
    return await setSiteSetting('maintenance_mode', enabled ? 'true' : 'false');
}

// Get sales page mode status
async function isSalesPageMode() {
    const value = await getSiteSetting('sales_page_mode');
    return value === 'true';
}

// Set sales page mode
async function setSalesPageMode(enabled) {
    return await setSiteSetting('sales_page_mode', enabled ? 'true' : 'false');
}

// ================== WHATSAPP API TOKEN FUNCTIONS ==================

// Get WhatsApp API token from database (for admin configuration)
async function getWhatsappApiToken() {
    try {
        const result = await pool.query(
            "SELECT setting_value FROM site_settings WHERE setting_key = 'whatsapp_api_token'"
        );
        return result.rows[0]?.setting_value || null;
    } catch (error) {
        console.error('Error getting WhatsApp API token:', error);
        return null;
    }
}

// Set WhatsApp API token in database (for admin configuration)
// The token is stored encoded (XOR + base64 + reverse) for security
async function setWhatsappApiToken(encodedToken) {
    try {
        await pool.query(`
            INSERT INTO site_settings (setting_key, setting_value, updated_at)
            VALUES ('whatsapp_api_token', $1, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        `, [encodedToken]);
        console.log('✅ WhatsApp API token updated in database');
        return true;
    } catch (error) {
        console.error('Error setting WhatsApp API token:', error);
        return false;
    }
}

// Clear WhatsApp API token from database (reverts to config.js fallback)
async function clearWhatsappApiToken() {
    try {
        await pool.query(
            "DELETE FROM site_settings WHERE setting_key = 'whatsapp_api_token'"
        );
        console.log('✅ WhatsApp API token cleared from database (will use config.js fallback)');
        return true;
    } catch (error) {
        console.error('Error clearing WhatsApp API token:', error);
        return false;
    }
}

// ================== NOTIFICATION FUNCTIONS ==================

// Create a notification for a specific user
async function createNotification(userId, title, message, type = 'info') {
    try {
        const result = await pool.query(`
            INSERT INTO notifications (user_id, title, message, type, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING *
        `, [userId, title, message, type]);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating notification:', error);
        throw error;
    }
}

// Create a notification for all users (broadcast)
async function createBroadcastNotification(title, message, type = 'info') {
    try {
        // Get all active (non-banned) users
        const usersResult = await pool.query(
            'SELECT id FROM users WHERE is_banned = false'
        );
        
        const users = usersResult.rows;
        
        if (users.length === 0) {
            return { success: true, count: 0 };
        }
        
        console.log(`📢 Broadcasting notification to ${users.length} users...`);
        
        // Batch size to avoid PostgreSQL parameter limit (32767)
        // Each user needs 4 parameters (user_id, title, message, type)
        // Using batch size of 5000 users = 20000 parameters (safely under limit)
        const BATCH_SIZE = 5000;
        let totalInserted = 0;
        
        // Process users in batches
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            
            // Build VALUES clause for this batch
            const values = batch.map((user, index) => {
                const offset = index * 4;
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, CURRENT_TIMESTAMP)`;
            }).join(', ');
            
            // Build parameters array for this batch
            const params = [];
            for (const user of batch) {
                params.push(user.id, title, message, type);
            }
            
            // Insert this batch
            await pool.query(`
                INSERT INTO notifications (user_id, title, message, type, created_at)
                VALUES ${values}
            `, params);
            
            totalInserted += batch.length;
            console.log(`   ✓ Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} notifications (Total: ${totalInserted}/${users.length})`);
        }
        
        console.log(`✅ Broadcast complete: ${totalInserted} notifications sent`);
        return { success: true, count: totalInserted };
    } catch (error) {
        console.error('Error creating broadcast notification:', error);
        throw error;
    }
}

// Get user notifications
async function getUserNotifications(userId, limit = 20) {
    try {
        const result = await pool.query(`
            SELECT * FROM notifications 
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [userId, limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting user notifications:', error);
        return [];
    }
}

// Get unread notifications count for a user
async function getUnreadNotificationCount(userId) {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as count FROM notifications 
            WHERE user_id = $1 AND is_read = false
        `, [userId]);
        return parseInt(result.rows[0].count);
    } catch (error) {
        console.error('Error getting unread notification count:', error);
        return 0;
    }
}

// Mark notification as read
async function markNotificationRead(notificationId, userId) {
    try {
        await pool.query(`
            UPDATE notifications 
            SET is_read = true 
            WHERE id = $1 AND user_id = $2
        `, [notificationId, userId]);
        return true;
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return false;
    }
}

// Mark all user notifications as read
async function markAllNotificationsRead(userId) {
    try {
        await pool.query(`
            UPDATE notifications 
            SET is_read = true 
            WHERE user_id = $1
        `, [userId]);
        return true;
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return false;
    }
}

// Delete a notification
async function deleteNotification(notificationId, userId) {
    try {
        await pool.query(`
            DELETE FROM notifications 
            WHERE id = $1 AND user_id = $2
        `, [notificationId, userId]);
        return true;
    } catch (error) {
        console.error('Error deleting notification:', error);
        return false;
    }
}

// ================== AI BAN SYSTEM & FINGERPRINT FUNCTIONS ==================

// Save or update user fingerprint
async function saveUserFingerprint(userId, fingerprintData) {
    try {
        const { visitorId, ip, browserName, browserVersion, os, device, userAgent } = fingerprintData;
        
        const result = await pool.query(`
            INSERT INTO user_fingerprints (
                user_id, fingerprint_id, ip_address, browser_name, browser_version, 
                os, device_type, user_agent, first_seen, last_seen, visit_count
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
            ON CONFLICT (user_id, fingerprint_id) 
            DO UPDATE SET 
                last_seen = CURRENT_TIMESTAMP,
                visit_count = user_fingerprints.visit_count + 1,
                ip_address = $3
            RETURNING *
        `, [userId, visitorId, ip, browserName, browserVersion, os, device, userAgent]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error saving user fingerprint:', error);
        throw error;
    }
}

// Check if fingerprint belongs to banned users
async function checkFingerprintForBans(fingerprintId) {
    try {
        const result = await pool.query(`
            SELECT DISTINCT u.id, u.email, u.name, u.is_banned, u.banned_at, u.ban_reason
            FROM users u
            INNER JOIN user_fingerprints uf ON u.id = uf.user_id
            WHERE uf.fingerprint_id = $1 AND u.is_banned = true
        `, [fingerprintId]);
        
        return result.rows;
    } catch (error) {
        console.error('Error checking fingerprint for bans:', error);
        return [];
    }
}

// Get all users with same fingerprint
async function getUsersByFingerprint(fingerprintId) {
    try {
        const result = await pool.query(`
            SELECT DISTINCT u.*, uf.first_seen, uf.last_seen, uf.visit_count
            FROM users u
            INNER JOIN user_fingerprints uf ON u.id = uf.user_id
            WHERE uf.fingerprint_id = $1
            ORDER BY uf.first_seen ASC
        `, [fingerprintId]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting users by fingerprint:', error);
        return [];
    }
}

// Analyze user for potential abuse using AI
async function analyzeUserForAbuseWithAI(userId, fingerprintId, relatedUsers) {
    try {
        const config = require('./config');
        
        // Build context for AI analysis
        const context = {
            currentUser: await getAdminUserById(userId),
            fingerprintId,
            relatedUsers: relatedUsers.map(u => ({
                id: u.id,
                email: u.email,
                name: u.name,
                created_at: u.created_at,
                is_banned: u.is_banned,
                balance: u.balance,
                plan: u.plan
            })),
            fingerprintCount: relatedUsers.length
        };
        
        // Prepare AI prompt
        const prompt = `Analyze this user account for potential abuse/multi-accounting:

Current User: ID ${context.currentUser.id}, Email: ${context.currentUser.email}, Name: ${context.currentUser.name}
Created: ${context.currentUser.created_at}
Balance: $${context.currentUser.balance.toFixed(2)}, Plan: ${context.currentUser.plan}

Fingerprint ID: ${fingerprintId}
This fingerprint is associated with ${context.fingerprintCount} user accounts total.

Related Accounts with same fingerprint:
${context.relatedUsers.map((u, i) => `${i + 1}. ID ${u.id}: ${u.email} (${u.name}) - Created: ${u.created_at}, Banned: ${u.is_banned}, Balance: ${u.balance}, Plan: ${u.plan}`).join('\n')}

Rules for Analysis:
- Do NOT ban based solely on shared IP (families, offices, cafes share IPs)
- DO flag if same device fingerprint is used for multiple accounts
- DO flag if accounts were created rapidly in succession
- DO flag if one account is already banned and new account uses same fingerprint
- Consider timing patterns and account behavior

Provide analysis in JSON format:
{
  "shouldBan": true/false,
  "riskScore": 0.0-1.0,
  "reason": "concise reason",
  "analysis": "detailed analysis explaining the decision",
  "confidence": 0.0-1.0
}`;

        // Call AI API
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.aiChat.apiKey}`
            },
            body: JSON.stringify({
                model: config.aiChat.model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a security analyst AI that detects account abuse and multi-accounting fraud. Provide objective, data-driven analysis.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: config.aiChat.maxTokens
            })
        });
        
        if (!response.ok) {
            throw new Error(`AI API returned ${response.status}`);
        }
        
        const aiResponse = await response.json();
        const aiContent = aiResponse.choices[0].message.content;
        
        // Parse AI response
        let analysis;
        try {
            // Try to extract JSON from the response
            const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                analysis = JSON.parse(jsonMatch[0]);
            } else {
                // Fallback if AI doesn't return JSON
                analysis = {
                    shouldBan: false,
                    riskScore: 0.5,
                    reason: 'Unable to parse AI response',
                    analysis: aiContent,
                    confidence: 0.3
                };
            }
        } catch (parseError) {
            console.error('Error parsing AI response:', parseError);
            analysis = {
                shouldBan: false,
                riskScore: 0.5,
                reason: 'AI analysis failed',
                analysis: aiContent,
                confidence: 0.2
            };
        }
        
        return analysis;
    } catch (error) {
        console.error('Error in AI abuse analysis:', error);
        return {
            shouldBan: false,
            riskScore: 0,
            reason: 'AI analysis error',
            analysis: error.message,
            confidence: 0
        };
    }
}

// Ban user with AI reasoning
async function banUserWithAI(userId, fingerprintId, relatedUserIds, aiAnalysis) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Ban the user
        await client.query(`
            UPDATE users 
            SET is_banned = true, 
                banned_at = CURRENT_TIMESTAMP,
                ban_reason = $1,
                fingerprint_id = $2
            WHERE id = $3
        `, [aiAnalysis.reason, fingerprintId, userId]);
        
        // Log the ban with AI analysis
        await client.query(`
            INSERT INTO ban_logs (
                user_id, banned_by, ban_reason, ai_analysis, fingerprint_id, 
                related_user_ids, risk_score
            )
            VALUES ($1, 'AI_SYSTEM', $2, $3, $4, $5, $6)
        `, [
            userId,
            aiAnalysis.reason,
            JSON.stringify(aiAnalysis),
            fingerprintId,
            relatedUserIds,
            aiAnalysis.riskScore
        ]);
        
        await client.query('COMMIT');
        
        console.log(`🤖 AI banned user ${userId}: ${aiAnalysis.reason} (confidence: ${aiAnalysis.confidence})`);
        
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error banning user with AI:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Get recent AI ban logs
async function getRecentBanLogs(limit = 50) {
    try {
        const result = await pool.query(`
            SELECT bl.*, u.name as user_name, u.email as user_email
            FROM ban_logs bl
            LEFT JOIN users u ON bl.user_id = u.id
            ORDER BY bl.created_at DESC
            LIMIT $1
        `, [limit]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting ban logs:', error);
        return [];
    }
}

// Get ban statistics
async function getBanStatistics() {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_bans,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as bans_24h,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as bans_7d,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as bans_30d,
                AVG(risk_score) as avg_risk_score
            FROM ban_logs
        `);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error getting ban statistics:', error);
        return {};
    }
}

// ================== BACKUP & RESTORE FUNCTIONS ==================

// Create a complete database backup
async function createDatabaseBackup() {
    try {
        console.log('📦 Starting database backup...');
        
        const backup = {
            metadata: {
                version: '1.0',
                backupDate: new Date().toISOString(),
                appName: 'ANDY RCH - EasyBooster',
                databaseType: 'PostgreSQL'
            },
            tables: {}
        };
        
        // Define tables to backup (excluding session table for security)
        const tablesToBackup = [
            'users',
            'transactions',
            'auto_react_channels',
            'requests',
            'rate_limits',
            'statistics',
            'ai_chat_history',
            'site_settings',
            'notifications',
            'user_fingerprints',  // AI ban system - device fingerprints
            'ban_logs',           // AI ban system - ban decisions and reasoning
            'api_keys',           // API key management
            'api_requests'        // API usage tracking
        ];
        
        // Backup each table
        for (const tableName of tablesToBackup) {
            try {
                const result = await pool.query(`SELECT * FROM ${tableName}`);
                backup.tables[tableName] = {
                    rowCount: result.rows.length,
                    data: result.rows
                };
                console.log(`✅ Backed up ${tableName}: ${result.rows.length} rows`);
            } catch (tableError) {
                console.error(`❌ Error backing up table ${tableName}:`, tableError.message);
                backup.tables[tableName] = {
                    error: tableError.message,
                    rowCount: 0,
                    data: []
                };
            }
        }
        
        console.log('✅ Database backup completed successfully');
        
        return {
            success: true,
            data: backup
        };
    } catch (error) {
        console.error('❌ Error creating database backup:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

// Get backup information (metadata only)
async function getBackupInfo() {
    try {
        const tablesToCheck = [
            'users',
            'transactions',
            'auto_react_channels',
            'requests',
            'rate_limits',
            'statistics',
            'ai_chat_history',
            'site_settings',
            'notifications',
            'user_fingerprints',  // AI ban system - device fingerprints
            'ban_logs',           // AI ban system - ban decisions and reasoning
            'api_keys',           // API key management
            'api_requests'        // API usage tracking
        ];
        
        const tableInfo = {};
        let totalRows = 0;
        
        for (const tableName of tablesToCheck) {
            try {
                const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
                const count = parseInt(result.rows[0].count);
                tableInfo[tableName] = count;
                totalRows += count;
            } catch (error) {
                tableInfo[tableName] = 0;
            }
        }
        
        return {
            totalRows,
            tables: tableInfo,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error getting backup info:', error);
        throw error;
    }
}

// Validate backup file structure
async function validateBackupFile(backupData) {
    try {
        const errors = [];
        const warnings = [];
        
        // Check metadata
        if (!backupData.metadata) {
            errors.push('Missing metadata section');
        } else {
            if (!backupData.metadata.version) {
                warnings.push('Missing version in metadata');
            }
            if (!backupData.metadata.backupDate) {
                warnings.push('Missing backup date in metadata');
            }
        }
        
        // Check tables section
        if (!backupData.tables) {
            errors.push('Missing tables section');
            return {
                valid: false,
                message: 'Invalid backup file: missing tables section',
                data: { errors, warnings }
            };
        }
        
        // Validate each table
        const expectedTables = [
            'users',
            'transactions',
            'auto_react_channels',
            'requests',
            'rate_limits',
            'statistics',
            'ai_chat_history',
            'site_settings',
            'notifications'
        ];
        
        const tableStats = {};
        for (const tableName of expectedTables) {
            if (!backupData.tables[tableName]) {
                warnings.push(`Missing table: ${tableName}`);
                tableStats[tableName] = 0;
            } else {
                const tableData = backupData.tables[tableName];
                if (!Array.isArray(tableData.data)) {
                    errors.push(`Invalid data format for table: ${tableName}`);
                    tableStats[tableName] = 0;
                } else {
                    tableStats[tableName] = tableData.data.length;
                }
            }
        }
        
        const isValid = errors.length === 0;
        
        return {
            valid: isValid,
            message: isValid 
                ? `Backup file is valid. Ready to restore ${Object.values(tableStats).reduce((a, b) => a + b, 0)} records.`
                : `Backup file has ${errors.length} error(s)`,
            data: {
                errors,
                warnings,
                tableStats,
                metadata: backupData.metadata
            }
        };
    } catch (error) {
        return {
            valid: false,
            message: 'Failed to validate backup file: ' + error.message,
            data: { errors: [error.message] }
        };
    }
}

// Restore database from backup
async function restoreDatabaseBackup(backupData) {
    try {
        console.log('📥 Starting database restore...');
        
        // Validate backup first
        const validation = await validateBackupFile(backupData);
        if (!validation.valid) {
            return {
                success: false,
                message: validation.message,
                data: validation.data
            };
        }
        
        const restoredTables = {};
        
        // Define restore order (to handle foreign key constraints)
        const restoreOrder = [
            'statistics',
            'site_settings',
            'users',
            'transactions',
            'auto_react_channels',
            'requests',
            'rate_limits',
            'ai_chat_history',
            'notifications',
            'user_fingerprints',  // AI ban system - must come after users (foreign key)
            'ban_logs',           // AI ban system - must come after users (foreign key)
            'api_keys',           // API key management - must come after users (foreign key)
            'api_requests'        // API usage tracking - must come after api_keys and users (foreign keys)
        ];
        
        for (const tableName of restoreOrder) {
            if (!backupData.tables[tableName] || !backupData.tables[tableName].data) {
                console.log(`⚠️  Skipping ${tableName}: no data in backup`);
                restoredTables[tableName] = 0;
                continue;
            }
            
            const tableData = backupData.tables[tableName].data;
            
            if (tableData.length === 0) {
                console.log(`⚠️  Skipping ${tableName}: empty table`);
                restoredTables[tableName] = 0;
                continue;
            }
            
            // Use separate transaction for each table to prevent rollback cascade
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');
                
                // Clear existing data
                await client.query(`TRUNCATE TABLE ${tableName} CASCADE`);
                
                // Get column names from first row
                const columns = Object.keys(tableData[0]);
                const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
                const columnNames = columns.join(', ');
                
                // Insert data row by row
                let insertedCount = 0;
                for (const row of tableData) {
                    const values = columns.map(col => {
                        const value = row[col];
                        // Convert JSON objects/arrays to strings for JSONB columns
                        if (value !== null && typeof value === 'object') {
                            return JSON.stringify(value);
                        }
                        return value;
                    });
                    
                    try {
                        await client.query(
                            `INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`,
                            values
                        );
                        insertedCount++;
                    } catch (rowError) {
                        console.error(`❌ Error inserting row into ${tableName}:`, rowError.message);
                        // Continue with other rows
                    }
                }
                
                // Reset sequences for tables with serial IDs
                if (columns.includes('id') && insertedCount > 0) {
                    try {
                        await client.query(`
                            SELECT setval(
                                pg_get_serial_sequence('${tableName}', 'id'),
                                COALESCE((SELECT MAX(id) FROM ${tableName}), 1),
                                true
                            )
                        `);
                    } catch (seqError) {
                        console.warn(`⚠️  Could not reset sequence for ${tableName}: ${seqError.message}`);
                    }
                }
                
                await client.query('COMMIT');
                
                restoredTables[tableName] = insertedCount;
                console.log(`✅ Restored ${tableName}: ${insertedCount} rows`);
                
            } catch (tableError) {
                await client.query('ROLLBACK');
                console.error(`❌ Error restoring table ${tableName}:`, tableError);
                restoredTables[tableName] = 0;
                // Continue with other tables
            } finally {
                client.release();
            }
        }
        
        const totalRestored = Object.values(restoredTables).reduce((a, b) => a + b, 0);
        console.log(`✅ Database restore completed: ${totalRestored} total rows restored`);
        
        return {
            success: true,
            message: `Successfully restored ${totalRestored} records from backup`,
            data: {
                restoredTables,
                totalRestored,
                backupDate: backupData.metadata.backupDate
            }
        };
    } catch (error) {
        console.error('❌ Error restoring database backup:', error);
        return {
            success: false,
            message: 'Failed to restore backup: ' + error.message
        };
    }
}

// ================== API KEY MANAGEMENT FUNCTIONS ==================

// Generate a random API key using cryptographically secure random bytes
function generateApiKey() {
    const crypto = require('crypto');
    const prefix = 'ak_';
    // Generate 24 random bytes (192 bits) and convert to base64url
    // This gives us exactly 32 characters of base64url (URL-safe base64)
    const randomBytes = crypto.randomBytes(24);
    const key = prefix + randomBytes.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    return key;
}

// Create a new API key
async function createApiKey(userId, name, requestLimit, expiresInDays = null) {
    try {
        const apiKey = generateApiKey();
        const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
        
        const result = await pool.query(`
            INSERT INTO api_keys (user_id, api_key, name, request_limit, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            RETURNING *
        `, [userId, apiKey, name, requestLimit, expiresAt]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error creating API key:', error);
        throw error;
    }
}

// Get all API keys (admin)
async function getAllApiKeys() {
    try {
        const result = await pool.query(`
            SELECT ak.*, u.name as user_name, u.email as user_email
            FROM api_keys ak
            LEFT JOIN users u ON ak.user_id = u.id
            ORDER BY ak.created_at DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting all API keys:', error);
        return [];
    }
}

// Get API key by key string
async function getApiKeyByKey(apiKey) {
    try {
        const result = await pool.query(`
            SELECT * FROM api_keys 
            WHERE api_key = $1
        `, [apiKey]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting API key:', error);
        return null;
    }
}

// Get API key by ID
async function getApiKeyById(id) {
    try {
        const result = await pool.query(`
            SELECT ak.*, u.name as user_name, u.email as user_email
            FROM api_keys ak
            LEFT JOIN users u ON ak.user_id = u.id
            WHERE ak.id = $1
        `, [id]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting API key by ID:', error);
        return null;
    }
}

// Get user's API keys
async function getUserApiKeys(userId) {
    try {
        const result = await pool.query(`
            SELECT * FROM api_keys 
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [userId]);
        return result.rows;
    } catch (error) {
        console.error('Error getting user API keys:', error);
        return [];
    }
}

// Update API key limit
async function updateApiKeyLimit(apiKeyId, newLimit) {
    try {
        const result = await pool.query(`
            UPDATE api_keys 
            SET request_limit = $1
            WHERE id = $2
            RETURNING *
        `, [newLimit, apiKeyId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating API key limit:', error);
        throw error;
    }
}

// Toggle API key active status
async function toggleApiKeyStatus(apiKeyId) {
    try {
        const result = await pool.query(`
            UPDATE api_keys 
            SET is_active = NOT is_active
            WHERE id = $1
            RETURNING *
        `, [apiKeyId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error toggling API key status:', error);
        throw error;
    }
}

// Delete API key
async function deleteApiKey(apiKeyId) {
    try {
        await pool.query(`
            DELETE FROM api_keys 
            WHERE id = $1
        `, [apiKeyId]);
        return true;
    } catch (error) {
        console.error('Error deleting API key:', error);
        throw error;
    }
}

// Validate and use API key
async function validateAndUseApiKey(apiKey) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get and lock the API key row
        const keyResult = await client.query(`
            SELECT * FROM api_keys 
            WHERE api_key = $1
            FOR UPDATE
        `, [apiKey]);
        
        if (keyResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { valid: false, message: 'Invalid API key' };
        }
        
        const key = keyResult.rows[0];
        
        // Check if key is active
        if (!key.is_active) {
            await client.query('ROLLBACK');
            return { valid: false, message: 'API key is inactive' };
        }
        
        // Check if key is expired
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            return { valid: false, message: 'API key has expired' };
        }
        
        // Check if limit is reached
        if (key.usage_count >= key.request_limit) {
            await client.query('ROLLBACK');
            return { valid: false, message: 'API key limit reached', remaining: 0 };
        }
        
        // Increment usage count and update last_used_at
        await client.query(`
            UPDATE api_keys 
            SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [key.id]);
        
        await client.query('COMMIT');
        
        return {
            valid: true,
            apiKey: key,
            remaining: key.request_limit - key.usage_count - 1
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error validating API key:', error);
        return { valid: false, message: 'Internal error validating API key' };
    } finally {
        client.release();
    }
}

// Log API request
async function logApiRequest(apiKeyId, userId, channelLink, emojis, ipAddress, userAgent, success, errorMessage = null) {
    try {
        await pool.query(`
            INSERT INTO api_requests (api_key_id, user_id, channel_link, emojis, ip_address, user_agent, success, error_message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [apiKeyId, userId, channelLink, JSON.stringify(emojis), ipAddress, userAgent, success, errorMessage]);
    } catch (error) {
        console.error('Error logging API request:', error);
        // Don't throw - logging failure shouldn't break the API call
    }
}

// Get API key statistics
async function getApiKeyStats(apiKeyId) {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE success = true) as successful_requests,
                COUNT(*) FILTER (WHERE success = false) as failed_requests,
                COUNT(DISTINCT DATE(created_at)) as active_days,
                MIN(created_at) as first_request,
                MAX(created_at) as last_request
            FROM api_requests 
            WHERE api_key_id = $1
        `, [apiKeyId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting API key stats:', error);
        return null;
    }
}

// Get recent API requests for a key
async function getApiKeyRequests(apiKeyId, limit = 50) {
    try {
        const result = await pool.query(`
            SELECT * FROM api_requests 
            WHERE api_key_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `, [apiKeyId, limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting API key requests:', error);
        return [];
    }
}

// ==================== API KEY REQUEST FUNCTIONS ====================

// Constants for API key requests
const API_KEY_REQUEST_COOLDOWN_DAYS = 3;

// Create API key request
async function createApiKeyRequest(userId, purpose) {
    try {
        const result = await pool.query(`
            INSERT INTO api_key_requests (user_id, purpose, status, created_at)
            VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP)
            RETURNING *
        `, [userId, purpose]);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating API key request:', error);
        throw error;
    }
}

// Get user's API key requests
async function getUserApiKeyRequests(userId) {
    try {
        const result = await pool.query(`
            SELECT akr.*, ak.api_key, ak.request_limit, ak.is_active as key_active
            FROM api_key_requests akr
            LEFT JOIN api_keys ak ON akr.api_key_id = ak.id
            WHERE akr.user_id = $1
            ORDER BY akr.created_at DESC
        `, [userId]);
        return result.rows;
    } catch (error) {
        console.error('Error getting user API key requests:', error);
        return [];
    }
}

// Get last rejected request date for a user
async function getLastRejectedRequestDate(userId) {
    try {
        const result = await pool.query(`
            SELECT reviewed_at
            FROM api_key_requests
            WHERE user_id = $1 AND status = 'rejected'
            ORDER BY reviewed_at DESC
            LIMIT 1
        `, [userId]);
        return result.rows.length > 0 ? result.rows[0].reviewed_at : null;
    } catch (error) {
        console.error('Error getting last rejected request date:', error);
        return null;
    }
}

// Check if user can submit API key request (cooldown check)
async function canUserSubmitApiKeyRequest(userId) {
    try {
        const lastRejectedDate = await getLastRejectedRequestDate(userId);
        if (!lastRejectedDate) {
            return { canSubmit: true };
        }
        
        const cooldownMs = API_KEY_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        const cooldownEndDate = new Date(Date.now() - cooldownMs);
        const lastRejected = new Date(lastRejectedDate);
        
        if (lastRejected > cooldownEndDate) {
            const timeRemaining = lastRejected.getTime() + cooldownMs - Date.now();
            const hoursRemaining = Math.ceil(timeRemaining / (60 * 60 * 1000));
            return { 
                canSubmit: false, 
                message: `You must wait ${hoursRemaining} hours before submitting another request`,
                hoursRemaining
            };
        }
        
        return { canSubmit: true };
    } catch (error) {
        console.error('Error checking API key request cooldown:', error);
        return { canSubmit: true }; // Allow on error to prevent blocking users
    }
}

// Get all pending API key requests (admin)
async function getAllPendingApiKeyRequests() {
    try {
        const result = await pool.query(`
            SELECT akr.*, 
                   u.name, u.email, u.plan, u.balance, u.avatar,
                   u.total_requests_sent, u.created_at as user_joined_at
            FROM api_key_requests akr
            JOIN users u ON akr.user_id = u.id
            WHERE akr.status = 'pending'
            ORDER BY akr.created_at ASC
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting pending API key requests:', error);
        return [];
    }
}

// Get all API key requests (admin - with filters)
async function getAllApiKeyRequests(status = null) {
    try {
        let query = `
            SELECT akr.*, 
                   u.name, u.email, u.plan, u.balance, u.avatar,
                   ak.api_key, ak.request_limit
            FROM api_key_requests akr
            JOIN users u ON akr.user_id = u.id
            LEFT JOIN api_keys ak ON akr.api_key_id = ak.id
        `;
        
        const params = [];
        if (status) {
            query += ` WHERE akr.status = $1`;
            params.push(status);
        }
        
        query += ` ORDER BY akr.created_at DESC`;
        
        const result = await pool.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error getting all API key requests:', error);
        return [];
    }
}

// Approve API key request
async function approveApiKeyRequest(requestId, adminUsername, adminReason = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get the request
        const requestResult = await client.query(`
            SELECT akr.*, u.balance, u.plan
            FROM api_key_requests akr
            JOIN users u ON akr.user_id = u.id
            WHERE akr.id = $1 AND akr.status = 'pending'
        `, [requestId]);
        
        if (requestResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Request not found or already processed' };
        }
        
        const request = requestResult.rows[0];
        
        // Calculate request limit based on user's coins
        // Minimum 100 requests guaranteed, then 1:1 ratio with coin balance for additional requests
        // Example: 50 coins = 100 requests, 100 coins = 100 requests, 200 coins = 200 requests
        const requestLimit = Math.max(100, request.balance);
        
        // Generate API key name
        const keyName = `User API Key - ${new Date().toISOString().split('T')[0]}`;
        
        // Create the API key
        const apiKey = generateApiKey();
        const apiKeyResult = await client.query(`
            INSERT INTO api_keys (user_id, api_key, name, request_limit, is_active, created_at)
            VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
            RETURNING *
        `, [request.user_id, apiKey, keyName, requestLimit]);
        
        const createdApiKey = apiKeyResult.rows[0];
        
        // Update the request status
        await client.query(`
            UPDATE api_key_requests
            SET status = 'approved',
                reviewed_at = CURRENT_TIMESTAMP,
                reviewed_by = $1,
                admin_reason = $2,
                api_key_id = $3
            WHERE id = $4
        `, [adminUsername, adminReason, createdApiKey.id, requestId]);
        
        // Send notification to user about approval
        await client.query(`
            INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
            VALUES ($1, $2, $3, $4, false, CURRENT_TIMESTAMP)
        `, [
            request.user_id,
            '🎉 API Key Request Approved!',
            `Congratulations! Your API key request has been approved. Visit the API Documentation page to view your API key and start integrating. ${adminReason ? 'Admin note: ' + adminReason : ''}`,
            'success'
        ]);
        
        // Get user details for email
        const userResult = await client.query('SELECT email, name FROM users WHERE id = $1', [request.user_id]);
        const user = userResult.rows[0];
        
        await client.query('COMMIT');
        
        // Send approval email (after commit to ensure transaction success)
        if (user && user.email) {
            try {
                await emailService.sendApiKeyApprovalEmail(
                    user.email,
                    user.name,
                    createdApiKey.api_key,
                    createdApiKey.request_limit,
                    adminReason
                );
            } catch (emailError) {
                console.error('Error sending approval email:', emailError);
                // Don't fail the approval if email fails
            }
        }
        
        return { 
            success: true, 
            message: 'API key request approved and key generated',
            apiKey: createdApiKey,
            userId: request.user_id
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving API key request:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Reject API key request
async function rejectApiKeyRequest(requestId, adminUsername, adminReason) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const result = await client.query(`
            UPDATE api_key_requests
            SET status = 'rejected',
                reviewed_at = CURRENT_TIMESTAMP,
                reviewed_by = $1,
                admin_reason = $2
            WHERE id = $3 AND status = 'pending'
            RETURNING *
        `, [adminUsername, adminReason, requestId]);
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, message: 'Request not found or already processed' };
        }
        
        const request = result.rows[0];
        
        // Send notification to user about rejection
        await client.query(`
            INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
            VALUES ($1, $2, $3, $4, false, CURRENT_TIMESTAMP)
        `, [
            request.user_id,
            '❌ API Key Request Rejected',
            `Your API key request has been reviewed and rejected. Reason: ${adminReason}. You can submit a new request after 3 days.`,
            'error'
        ]);
        
        // Get user details for email
        const userResult = await client.query('SELECT email, name FROM users WHERE id = $1', [request.user_id]);
        const user = userResult.rows[0];
        
        await client.query('COMMIT');
        
        // Send rejection email (after commit to ensure transaction success)
        if (user && user.email) {
            try {
                await emailService.sendApiKeyRejectionEmail(
                    user.email,
                    user.name,
                    adminReason
                );
            } catch (emailError) {
                console.error('Error sending rejection email:', emailError);
                // Don't fail the rejection if email fails
            }
        }
        
        return { 
            success: true, 
            message: 'API key request rejected',
            request
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rejecting API key request:', error);
        throw error;
    } finally {
        client.release();
    }
}

// ==================== COUPON FUNCTIONS ====================

// Create a new coupon
async function createCoupon(couponData) {
    const { code, coinAmount, usageLimit, expirationDate, whatsappGroupLink, createdBy } = couponData;
    
    try {
        const result = await pool.query(`
            INSERT INTO coupons (code, coin_amount, usage_limit, expiration_date, whatsapp_group_link, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [code.toUpperCase(), coinAmount, usageLimit, expirationDate, whatsappGroupLink || null, createdBy || 'admin']);
        
        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            throw new Error('Coupon code already exists');
        }
        console.error('Error creating coupon:', error);
        throw error;
    }
}

// Get all coupons with claim statistics
async function getAllCoupons() {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                COUNT(cc.id) as total_claims,
                CASE 
                    WHEN c.expiration_date < CURRENT_TIMESTAMP THEN 'expired'
                    WHEN c.usage_count >= c.usage_limit THEN 'limit_reached'
                    WHEN c.is_active = false THEN 'inactive'
                    ELSE 'active'
                END as status
            FROM coupons c
            LEFT JOIN coupon_claims cc ON c.id = cc.coupon_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting all coupons:', error);
        throw error;
    }
}

// Get a single coupon by ID with claimers
async function getCouponById(couponId) {
    try {
        const couponResult = await pool.query(`
            SELECT 
                c.*,
                COUNT(cc.id) as total_claims,
                CASE 
                    WHEN c.expiration_date < CURRENT_TIMESTAMP THEN 'expired'
                    WHEN c.usage_count >= c.usage_limit THEN 'limit_reached'
                    WHEN c.is_active = false THEN 'inactive'
                    ELSE 'active'
                END as status
            FROM coupons c
            LEFT JOIN coupon_claims cc ON c.id = cc.coupon_id
            WHERE c.id = $1
            GROUP BY c.id
        `, [couponId]);
        
        if (couponResult.rows.length === 0) {
            return null;
        }
        
        const coupon = couponResult.rows[0];
        
        // Get list of users who claimed this coupon
        const claimersResult = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                u.avatar,
                cc.claimed_at
            FROM coupon_claims cc
            JOIN users u ON cc.user_id = u.id
            WHERE cc.coupon_id = $1
            ORDER BY cc.claimed_at DESC
        `, [couponId]);
        
        coupon.claimers = claimersResult.rows;
        
        return coupon;
    } catch (error) {
        console.error('Error getting coupon by ID:', error);
        throw error;
    }
}

// Get a coupon by code
async function getCouponByCode(code) {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                CASE 
                    WHEN c.expiration_date < CURRENT_TIMESTAMP THEN 'expired'
                    WHEN c.usage_count >= c.usage_limit THEN 'limit_reached'
                    WHEN c.is_active = false THEN 'inactive'
                    ELSE 'active'
                END as status
            FROM coupons c
            WHERE UPPER(c.code) = UPPER($1)
        `, [code]);
        
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting coupon by code:', error);
        throw error;
    }
}

// Check if a user has already claimed a coupon
async function hasUserClaimedCoupon(userId, couponId) {
    try {
        const result = await pool.query(`
            SELECT EXISTS(
                SELECT 1 FROM coupon_claims 
                WHERE user_id = $1 AND coupon_id = $2
            ) as has_claimed
        `, [userId, couponId]);
        
        return result.rows[0].has_claimed;
    } catch (error) {
        console.error('Error checking coupon claim:', error);
        throw error;
    }
}

// Claim a coupon for a user
async function claimCoupon(userId, couponCode) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Get coupon details
        const couponResult = await client.query(`
            SELECT * FROM coupons 
            WHERE UPPER(code) = UPPER($1)
            FOR UPDATE
        `, [couponCode]);
        
        if (couponResult.rows.length === 0) {
            throw new Error('Coupon code not found');
        }
        
        const coupon = couponResult.rows[0];
        
        // Check if coupon is active
        if (!coupon.is_active) {
            throw new Error('This coupon is no longer active');
        }
        
        // Check if coupon has expired
        if (new Date(coupon.expiration_date) < new Date()) {
            throw new Error('This coupon has expired');
        }
        
        // Check if usage limit has been reached
        if (coupon.usage_count >= coupon.usage_limit) {
            throw new Error('This coupon has reached its usage limit');
        }
        
        // Check if user has already claimed this coupon
        const alreadyClaimed = await hasUserClaimedCoupon(userId, coupon.id);
        if (alreadyClaimed) {
            throw new Error('You have already claimed this coupon');
        }
        
        // Record the claim
        await client.query(`
            INSERT INTO coupon_claims (coupon_id, user_id)
            VALUES ($1, $2)
        `, [coupon.id, userId]);
        
        // Update coupon usage count
        await client.query(`
            UPDATE coupons 
            SET usage_count = usage_count + 1
            WHERE id = $1
        `, [coupon.id]);
        
        // Add credits to user balance and update daily_limit
        const result = await client.query(`
            UPDATE users 
            SET balance = balance + $1,
                daily_limit = daily_limit + $1
            WHERE id = $2
            RETURNING balance, plan
        `, [coupon.coin_amount, userId]);
        
        const newBalance = result.rows[0]?.balance;
        const currentPlan = result.rows[0]?.plan;
        
        // Automatic plan management based on balance
        // If balance >= 10: Upgrade to premium
        // If balance <= 9: Downgrade to free
        if (newBalance >= 10 && currentPlan !== 'premium') {
            // Auto-upgrade to premium
            await client.query(`
                UPDATE users 
                SET plan = 'premium'
                WHERE id = $1
            `, [userId]);
            console.log(`✨ Auto-upgraded user ${userId} to Premium (balance: $${newBalance.toFixed(2)})`);
        } else if (newBalance <= 9 && currentPlan === 'premium') {
            // Auto-downgrade to free
            await client.query(`
                UPDATE users 
                SET plan = 'free'
                WHERE id = $1
            `, [userId]);
            console.log(`📉 Auto-downgraded user ${userId} to Free (balance: $${newBalance.toFixed(2)})`);
        }
        
        // Record transaction
        await client.query(`
            INSERT INTO transactions (user_id, type, category, description, details, amount, status)
            VALUES ($1, 'credit', 'coupon', 'Coupon Claimed', $2, $3, 'completed')
        `, [userId, `Claimed coupon: ${coupon.code}`, coupon.coin_amount]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            coinAmount: coupon.coin_amount,
            whatsappGroupLink: coupon.whatsapp_group_link
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error claiming coupon:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Delete/deactivate a coupon
async function deactivateCoupon(couponId) {
    try {
        const result = await pool.query(`
            UPDATE coupons 
            SET is_active = false
            WHERE id = $1
            RETURNING *
        `, [couponId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error deactivating coupon:', error);
        throw error;
    }
}

// Get user's claimed coupons
async function getUserClaimedCoupons(userId) {
    try {
        const result = await pool.query(`
            SELECT 
                c.code,
                c.coin_amount,
                cc.claimed_at
            FROM coupon_claims cc
            JOIN coupons c ON cc.coupon_id = c.id
            WHERE cc.user_id = $1
            ORDER BY cc.claimed_at DESC
        `, [userId]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting user claimed coupons:', error);
        return [];
    }
}

// ================== ULTRA PREMIUM SUBSCRIPTION FUNCTIONS ==================

/**
 * Helper function to check if a user has an active Ultra plan
 * @param {Object} user - User object with plan_type and plan_expires_at fields
 * @returns {boolean} True if user has active Ultra subscription
 */
function hasActiveUltraPlan(user) {
    if (!user) return false;
    if (user.plan_type !== 'ultra') return false;
    if (!user.plan_expires_at) return false;
    return new Date(user.plan_expires_at) > new Date();
}

/**
 * Upgrade user to Ultra Premium plan
 * Sets plan_type to 'ultra', is_unlimited to true, and plan_expires_at to NOW + 14 days
 */
async function upgradeToUltraPlan(userId) {
    try {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14); // 14 days from now
        
        const result = await pool.query(`
            UPDATE users 
            SET plan_type = 'ultra',
                plan = 'ultra',
                is_unlimited = true,
                plan_expires_at = $2
            WHERE id = $1
            RETURNING *
        `, [userId, expiresAt]);
        
        if (result.rows.length > 0) {
            console.log(`✨ User ${userId} upgraded to Ultra Premium plan (expires: ${expiresAt.toISOString()})`);
        }
        
        return result.rows[0];
    } catch (error) {
        console.error('Error upgrading to Ultra plan:', error);
        throw error;
    }
}

/**
 * Check and downgrade expired Ultra subscriptions
 * Runs on user requests to check if their subscription has expired
 */
async function checkAndDowngradeExpiredSubscription(userId) {
    try {
        const result = await pool.query(`
            UPDATE users 
            SET plan_type = 'free',
                plan = 'free',
                is_unlimited = false,
                plan_expires_at = NULL
            WHERE id = $1
                AND plan_type = 'ultra'
                AND plan_expires_at IS NOT NULL
                AND plan_expires_at < CURRENT_TIMESTAMP
            RETURNING *
        `, [userId]);
        
        if (result.rows.length > 0) {
            console.log(`⬇️ User ${userId} Ultra subscription expired - downgraded to free plan`);
            return { downgraded: true, user: result.rows[0] };
        }
        
        return { downgraded: false };
    } catch (error) {
        console.error('Error checking/downgrading subscription:', error);
        throw error;
    }
}

/**
 * Get Ultra Premium offer status (for checking if the 7-day promo is active)
 */
async function getUltraOfferStatus() {
    try {
        const result = await pool.query(`
            SELECT setting_value FROM site_settings WHERE setting_key = 'ultra_offer_ends_at'
        `);
        
        if (result.rows.length > 0) {
            const offerEndsAt = new Date(result.rows[0].setting_value);
            const now = new Date();
            return {
                active: offerEndsAt > now,
                endsAt: offerEndsAt.toISOString()
            };
        }
        
        return { active: false, endsAt: null };
    } catch (error) {
        console.error('Error getting Ultra offer status:', error);
        return { active: false, endsAt: null };
    }
}

/**
 * Set/Start the Ultra Premium offer (7-day countdown)
 */
async function startUltraOffer() {
    try {
        const offerEndsAt = new Date();
        offerEndsAt.setDate(offerEndsAt.getDate() + 7); // 7 days from now
        
        await pool.query(`
            INSERT INTO site_settings (setting_key, setting_value, updated_at)
            VALUES ('ultra_offer_ends_at', $1, CURRENT_TIMESTAMP)
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
        `, [offerEndsAt.toISOString()]);
        
        console.log(`🎉 Ultra Premium offer started (ends: ${offerEndsAt.toISOString()})`);
        
        return {
            active: true,
            endsAt: offerEndsAt.toISOString()
        };
    } catch (error) {
        console.error('Error starting Ultra offer:', error);
        throw error;
    }
}

// ================== WEBSITE SALE PAYMENT FUNCTIONS ==================

/**
 * Create a new website sale order
 */
async function createWebsiteSaleOrder({ buyerEmail, buyerName, amount, oxapayOrderId, expiresAt }) {
    try {
        const result = await pool.query(`
            INSERT INTO website_sale_orders (buyer_email, buyer_name, amount, oxapay_order_id, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [buyerEmail, buyerName || null, amount, oxapayOrderId, expiresAt]);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating website sale order:', error);
        throw error;
    }
}

/**
 * Get a website sale order by its OxaPay order ID
 */
async function getWebsiteSaleOrderByOxapayId(oxapayOrderId) {
    try {
        const result = await pool.query(
            'SELECT * FROM website_sale_orders WHERE oxapay_order_id = $1',
            [oxapayOrderId]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error getting website sale order:', error);
        throw error;
    }
}

/**
 * Update website sale order status
 */
async function updateWebsiteSaleOrderStatus(oxapayOrderId, status, trackId, txid) {
    try {
        const result = await pool.query(`
            UPDATE website_sale_orders
            SET status = $2,
                oxapay_track_id = COALESCE($3, oxapay_track_id),
                txid = COALESCE($4, txid),
                paid_at = CASE WHEN $2 IN ('paid', 'complete') THEN CURRENT_TIMESTAMP ELSE paid_at END
            WHERE oxapay_order_id = $1
            RETURNING *
        `, [oxapayOrderId, status, trackId || null, txid || null]);
        return result.rows[0];
    } catch (error) {
        console.error('Error updating website sale order status:', error);
        throw error;
    }
}

module.exports = {
    pool,
    initializeDatabase,
    getStatistics,
    incrementRequestCount,
    saveRequest,
    getLatestRequests,
    checkRateLimit,
    incrementRateLimit,
    cleanupOldRateLimits,
    cleanupOldNotifications,
    cleanupOldChatHistory,
    cleanupOldData,
    // User functions
    findOrCreateUser,
    createOrGetDemoUser,
    getUserById,
    getUserStats,
    updateUserBalance,
    incrementUserRequestCount,
    // Transaction functions
    addTransaction,
    getUserTransactions,
    getUserTransactionSummary,
    // Auto react channel functions
    purchaseAutoReactChannel,
    registerAutoReactChannel,
    getUserAutoReactChannels,
    getAutoReactStats,
    // Channel followers functions
    purchaseChannelFollowers,
    getUserChannelFollowerOrders,
    purchaseSMMService,
    getUserSMMOrders,
    // AI chat history functions
    saveAiChatMessage,
    getAiChatHistory,
    clearAiChatHistory,
    // Admin functions
    getAllUsers,
    getUsersPaginated,
    getAllPaymentRequests,
    updateUserPlan,
    setUserBalance,
    updateUserDailyLimit,
    deleteUser,
    updateTransactionStatus,
    getAdminUserById,
    // Ban and IP tracking functions
    banUser,
    unbanUser,
    updateUserIpAddress,
    getUsersWithSameIp,
    getIpAddressesWithMultipleUsers,
    isUserBanned,
    // Site settings functions
    getSiteSetting,
    setSiteSetting,
    isMaintenanceMode,
    setMaintenanceMode,
    isSalesPageMode,
    setSalesPageMode,
    // WhatsApp API token functions
    getWhatsappApiToken,
    setWhatsappApiToken,
    clearWhatsappApiToken,
    // Notification functions
    createNotification,
    createBroadcastNotification,
    getUserNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    // AI Ban System & Fingerprint functions
    saveUserFingerprint,
    checkFingerprintForBans,
    getUsersByFingerprint,
    analyzeUserForAbuseWithAI,
    banUserWithAI,
    getRecentBanLogs,
    getBanStatistics,
    // Backup & Restore functions
    createDatabaseBackup,
    getBackupInfo,
    validateBackupFile,
    restoreDatabaseBackup,
    // API Key Management functions
    createApiKey,
    getAllApiKeys,
    getApiKeyByKey,
    getApiKeyById,
    getUserApiKeys,
    updateApiKeyLimit,
    toggleApiKeyStatus,
    deleteApiKey,
    validateAndUseApiKey,
    logApiRequest,
    getApiKeyStats,
    getApiKeyRequests,
    // API Key Request functions
    createApiKeyRequest,
    getUserApiKeyRequests,
    canUserSubmitApiKeyRequest,
    getAllPendingApiKeyRequests,
    getAllApiKeyRequests,
    approveApiKeyRequest,
    rejectApiKeyRequest,
    // Coupon functions
    createCoupon,
    getAllCoupons,
    getCouponById,
    getCouponByCode,
    hasUserClaimedCoupon,
    claimCoupon,
    deactivateCoupon,
    getUserClaimedCoupons,
    // OxaPay payment functions
    createOxaPayOrder,
    getOxaPayOrderById,
    getUserOxaPayOrders,
    updateOxaPayOrderStatus,
    updateOxaPayOrderTrackId,
    expireOldOxaPayOrders,
    // Ultra Premium subscription functions
    hasActiveUltraPlan,
    upgradeToUltraPlan,
    checkAndDowngradeExpiredSubscription,
    getUltraOfferStatus,
    startUltraOffer,
    // Website sale payment functions
    createWebsiteSaleOrder,
    getWebsiteSaleOrderByOxapayId,
    updateWebsiteSaleOrderStatus
};

// ================== OXAPAY PAYMENT FUNCTIONS ==================

/**
 * Create a new OxaPay order
 */
async function createOxaPayOrder(orderData) {
    const { userId, usdAmount, coinsRequested, expectedUsdtAmount, expiresAt } = orderData;
    // For regular orders: convert USD to legacy coins_requested column (USD * 10)
    // For Ultra Premium: coinsRequested is passed as -1 directly
    const coinsValue = coinsRequested !== undefined ? coinsRequested : (usdAmount !== undefined ? Math.round(usdAmount * 10) : 0);
    
    try {
        const result = await pool.query(`
            INSERT INTO oxapay_orders (
                user_id, coins_requested, expected_usdt_amount, 
                expires_at, created_at
            )
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING *
        `, [userId, coinsValue, expectedUsdtAmount, expiresAt]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error creating OxaPay order:', error);
        throw error;
    }
}

/**
 * Get an OxaPay order by ID
 */
async function getOxaPayOrderById(orderId) {
    try {
        const result = await pool.query(
            'SELECT * FROM oxapay_orders WHERE id = $1',
            [orderId]
        );
        return result.rows[0];
    } catch (error) {
        console.error('Error getting OxaPay order:', error);
        throw error;
    }
}

/**
 * Get user's OxaPay orders
 */
async function getUserOxaPayOrders(userId, limit = 50) {
    try {
        const result = await pool.query(`
            SELECT * FROM oxapay_orders 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2
        `, [userId, limit]);
        
        return result.rows;
    } catch (error) {
        console.error('Error getting user OxaPay orders:', error);
        throw error;
    }
}

/**
 * Update OxaPay order status
 */
async function updateOxaPayOrderStatus(orderId, status, trackId = null, txid = null) {
    try {
        const updateFields = ['status = $2'];
        const params = [orderId, status];
        let paramIndex = 3;
        
        if (trackId) {
            updateFields.push(`oxapay_track_id = $${paramIndex++}`);
            params.push(trackId);
        }
        
        if (txid) {
            updateFields.push(`txid = $${paramIndex++}`);
            params.push(txid);
        }
        
        if (status === 'paid' || status === 'complete') {
            updateFields.push(`paid_at = CURRENT_TIMESTAMP`);
        }
        
        const result = await pool.query(`
            UPDATE oxapay_orders 
            SET ${updateFields.join(', ')}
            WHERE id = $1
            RETURNING *
        `, params);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error updating OxaPay order status:', error);
        throw error;
    }
}

/**
 * Update OxaPay order with trackId
 */
async function updateOxaPayOrderTrackId(orderId, trackId) {
    try {
        const result = await pool.query(`
            UPDATE oxapay_orders 
            SET oxapay_track_id = $2
            WHERE id = $1
            RETURNING *
        `, [orderId, trackId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('Error updating OxaPay order trackId:', error);
        throw error;
    }
}

/**
 * Expire old OxaPay orders
 */
async function expireOldOxaPayOrders() {
    try {
        const result = await pool.query(`
            UPDATE oxapay_orders 
            SET status = 'expired' 
            WHERE status = 'pending' 
            AND expires_at < CURRENT_TIMESTAMP
            RETURNING id
        `);
        
        if (result.rows.length > 0) {
            console.log(`✅ Expired ${result.rows.length} old OxaPay orders`);
        }
        
        return result.rows.length;
    } catch (error) {
        console.error('Error expiring old OxaPay orders:', error);
        throw error;
    }
}
