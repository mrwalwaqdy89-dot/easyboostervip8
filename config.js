// Config Helper
// Loads environment variables and provides helper functions
// All configuration now comes from .env file

require('dotenv').config();

// Helper function to parse integer with default
function getInt(envVar, defaultValue) {
    const value = process.env[envVar];
    return value ? parseInt(value) : defaultValue;
}

// Helper function to parse float with default
function getFloat(envVar, defaultValue) {
    const value = process.env[envVar];
    return value ? parseFloat(value) : defaultValue;
}

// Helper function to parse boolean
function getBool(envVar, defaultValue) {
    const value = process.env[envVar];
    if (value === undefined) return defaultValue;
    return value === 'true';
}

// Helper to convert legacy coin env values to USD (1 coin = $0.10)
// If value >= threshold, it's likely a coin amount from old config
function getUSD(envVar, defaultUSD, coinThreshold = 1) {
    const value = process.env[envVar];
    if (value === undefined) return defaultUSD;
    const num = parseFloat(value);
    // If value is a whole number >= coinThreshold, treat as coins and convert
    if (num >= coinThreshold && Number.isInteger(num)) {
        return parseFloat((num * 0.10).toFixed(2));
    }
    return num;
}

module.exports = {
    // Server Configuration
    server: {
        port: getInt('PORT', 3000),
        nodeEnv: process.env.NODE_ENV || 'production'
    },

    // Database Configuration
    database: {
        url: process.env.DATABASE_URL
    },

    // Google OAuth Configuration
    oauth: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'https://easyboostervip8.vercel.app/api/auth/google/callback'
        }
    },

    // Session Configuration
    session: {
        secret: process.env.SESSION_SECRET,
        maxAge: getInt('SESSION_MAX_AGE', 7 * 24 * 60 * 60 * 1000)
    },

    // Admin Configuration
    admin: {
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD
    },

    // AI Chat Configuration
    aiChat: {
        apiKey: process.env.AI_CHAT_API_KEY,
        model: process.env.AI_CHAT_MODEL || 'deepseek/deepseek-chat',
        maxTokens: getInt('AI_CHAT_MAX_TOKENS', 500),
        sessionApiKey: process.env.AI_SESSION_API_KEY,
        useSessionAPI: getBool('AI_USE_SESSION_API', true)
    },

    // User Configuration (USD dollar amounts)
    user: {
        defaultBalance: getUSD('USER_DEFAULT_BALANCE', 0.50), // $0.50 USD default (5 free reactions)
        freePlanDailyLimit: getInt('USER_FREE_PLAN_DAILY_LIMIT', 5),
        premiumPlanDailyLimit: getInt('USER_PREMIUM_PLAN_DAILY_LIMIT', -1)
    },

    // Rate Limiting Configuration
    rateLimit: {
        perDay: getInt('RATE_LIMIT_PER_DAY', 1),
        cleanupIntervalDays: getInt('RATE_LIMIT_CLEANUP_INTERVAL_DAYS', 7)
    },

    // Data Retention Configuration
    dataRetention: {
        notificationsMaxDays: getInt('DATA_RETENTION_NOTIFICATIONS_MAX_DAYS', 3),
        chatHistoryMaxDays: getInt('DATA_RETENTION_CHAT_HISTORY_MAX_DAYS', 3)
    },

    // Auto React Configuration (USD dollar amounts)
    autoReact: {
        costPerDay: getUSD('AUTO_REACT_COST_PER_DAY', 1.00, 10), // $1.00 USD per day default
        maxEmojis: getInt('AUTO_REACT_MAX_EMOJIS', 16),
        defaultDuration: getInt('AUTO_REACT_DEFAULT_DURATION', 30)
    },

    // WhatsApp Channel Followers Configuration
    channelFollowers: {
        serviceId: 12258, // 5SMM service ID for WhatsApp Channel Members
        minFollowers: getInt('CHANNEL_FOLLOWERS_MIN', 500),
        maxFollowers: getInt('CHANNEL_FOLLOWERS_MAX', 50000),
        pricePerThousand: getFloat('CHANNEL_FOLLOWERS_PRICE_PER_1K', 8.00), // $12.00 per 1000 followers
        description: 'Real WhatsApp channel Followers never drop',
        enabled: getBool('CHANNEL_FOLLOWERS_ENABLED', true),
        requirePremium: true // WhatsApp services don't require premium
    },

    // New SMM Services Configuration (Premium Required)
    smmServices: {
        tiktokViews: {
            serviceId: 17832, // 5SMM service ID
            name: 'TikTok Views',
            pricePerThousand: 0.30, // Price per 1000 views in USD
            minQuantity: 100,
            maxQuantity: 100000,
            description: 'Fast TikTok video views with 30-day refill',
            enabled: true,
            requirePremium: true
        },
        instagramViews: {
            serviceId: 14304, // 5SMM service ID
            name: 'Instagram Views',
            pricePerThousand: 0.25, // Price per 1000 views in USD
            minQuantity: 100,
            maxQuantity: 100000,
            description: 'Instant Instagram video views with refill',
            enabled: true,
            requirePremium: true
        },
        instagramFollowers: {
            serviceId: 17845, // 5SMM service ID
            name: 'Instagram Followers',
            pricePerThousand: 2.10, // Price per 1000 followers in USD
            minQuantity: 100,
            maxQuantity: 10000,
            description: 'Real Instagram followers with 30-day refill',
            enabled: true,
            requirePremium: true
        },
        tiktokFollowers: {
            serviceId: 16927, // 5SMM service ID
            name: 'TikTok Followers',
            pricePerThousand: 2.99, // Price per 1000 followers in USD
            minQuantity: 100,
            maxQuantity: 10000,
            description: 'HQ TikTok followers with refill guarantee',
            enabled: true,
            requirePremium: true
        },
        facebookFollowers: {
            serviceId: 10916, // 5SMM service ID
            name: 'Facebook Followers',
            pricePerThousand: 0.90, // Price per 1000 followers in USD
            minQuantity: 100,
            maxQuantity: 10000,
            description: 'Real Facebook page followers, non-drop',
            enabled: true,
            requirePremium: true
        },
        instagramLikes: {
            serviceId: 16805, // 5SMM service ID - Instagram Likes | Max 5M | Instant
            name: 'Instagram Likes',
            pricePerThousand: 0.24, // Price per 1000 likes in USD (base $0.18 + 30% markup)
            minQuantity: 100,
            maxQuantity: 5000000,
            description: 'Instant Instagram likes - max 5M',
            enabled: true,
            requirePremium: true
        },
        tiktokLikes: {
            serviceId: 7023, // 5SMM service ID - TikTok Likes [Max: 1M] [SuperInstant]
            name: 'TikTok Likes',
            pricePerThousand: 0.10, // Price per 1000 likes in USD (base $0.07 + 30% markup)
            minQuantity: 10,
            maxQuantity: 3000000,
            description: 'SuperInstant TikTok likes - max 3M',
            enabled: true,
            requirePremium: true
        }
    },

    // Application URLs
    urls: {
        whatsappBackend: process.env.WHATSAPP_BACKEND_URL || 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app',
        supportWhatsapp: process.env.SUPPORT_WHATSAPP || 'https://wa.me/994408773836',
        baseUrl: process.env.BASE_URL || 'https://easyboostervip8.vercel.app'
    },

    // WhatsApp Backend API Configuration
    whatsappApi: {
        _t: process.env.WHATSAPP_API_TOKEN
    },

    // OxaPay Payment Configuration
    oxapay: {
        merchantKey: process.env.OXAPAY_MERCHANT_KEY,
        minimumUSD: getFloat('PAYMENT_MINIMUM_USDT', 5), // Minimum $5.00 USD purchase
        orderExpirationHours: getInt('PAYMENT_ORDER_EXPIRATION_HOURS', 12),
        enabled: getBool('PAYMENT_ENABLED', false),
        currency: process.env.OXAPAY_CURRENCY || 'USDT',
        feePaidByPayer: getInt('OXAPAY_FEE_PAID_BY_PAYER', 1)
    },

    // 5SMM API Configuration
    smm: {
        apiKey: process.env.SMM_API_KEY || '36d3cc511939bc60008313955839ffed',
        apiUrl: process.env.SMM_API_URL || 'https://5smm.com/api/v2',
        enabled: getBool('SMM_ENABLED', true)
    }
};
