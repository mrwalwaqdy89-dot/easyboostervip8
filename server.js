const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const fs = require('fs');

const config = require('./config');
const db = require('./database');
const emailService = require('./emailService');
const chatService = require('./chatService');
const smmService = require('./smmService');

const app = express();
const PORT = config.server.port;

// Statistics tracking (fallback for in-memory if DB fails)
const stats = {
    requestCount: 0,
    startTime: Date.now()
};

// Global error handlers for uncaught errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// Trust proxy - required for Heroku, Railway, Render, etc.
app.set('trust proxy', 1);

// Session configuration
const sessionSecret = config.session.secret;

// Determine if running on HTTPS (production deployment) or HTTP (local/test)
// Check for HTTPS in the environment or if behind a secure proxy
const isSecureEnvironment = process.env.NODE_ENV === 'production' && 
    (process.env.HEROKU || process.env.RAILWAY || process.env.RENDER || process.env.HTTPS === 'true');

app.use(session({
    store: new pgSession({
        pool: db.pool,
        tableName: 'session', // Explicitly set table name to 'session'
        createTableIfMissing: true // Automatically create session table
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true, // Trust the reverse proxy
    cookie: {
        secure: isSecureEnvironment, // Only use secure cookies when actually on HTTPS
        httpOnly: true, // Prevent XSS attacks
        maxAge: config.session.maxAge,
        sameSite: isSecureEnvironment ? 'none' : 'lax' // Use 'lax' for HTTP, 'none' for HTTPS with OAuth
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await db.getUserById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Google OAuth Strategy
if (config.oauth.google.clientId && config.oauth.google.clientSecret) {
    passport.use(new GoogleStrategy({
        clientID: config.oauth.google.clientId,
        clientSecret: config.oauth.google.clientSecret,
        callbackURL: config.oauth.google.callbackUrl
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const user = await db.findOrCreateUser(profile);
            done(null, user);
        } catch (error) {
            console.error('Error in Google OAuth callback:', error);
            done(error, null);
        }
    }));
    console.log('✅ Google OAuth configured');
} else {
    console.log('⚠️  Google OAuth not configured - Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
}

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to get client IP address
app.use((req, res, next) => {
    // Get IP from various headers (for proxies/load balancers)
    req.clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection?.remoteAddress ||
                   req.socket?.remoteAddress ||
                   req.ip ||
                   'unknown';
    next();
});

// Cache control middleware - prevents caching of HTML files so users always see latest version
function setNoCacheHeaders(res) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
}

// Serve static files (HTML, CSS, JS, images, etc.)
// Set cache control based on file type
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        // Disable caching for HTML files
        if (filePath.endsWith('.html')) {
            setNoCacheHeaders(res);
        }
    }
}));

// Route for the main page
app.get('/', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route for sales page (website for sale)
app.get('/for-sale', (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'for-sale.html'));
});

// ================== DEMO MODE ROUTES ==================

// Simple rate limiter for demo login routes (prevents session spam)
const demoLoginAttempts = new Map();
const DEMO_RATE_LIMIT = 10;        // max attempts
const DEMO_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

function checkDemoRateLimit(ip) {
    const now = Date.now();
    const entry = demoLoginAttempts.get(ip) || { count: 0, firstAttempt: now };
    if (now - entry.firstAttempt > DEMO_RATE_WINDOW_MS) {
        demoLoginAttempts.set(ip, { count: 1, firstAttempt: now });
        return true;
    }
    if (entry.count >= DEMO_RATE_LIMIT) return false;
    entry.count++;
    demoLoginAttempts.set(ip, entry);
    return true;
}

// Demo admin login — sets a read-only admin session and redirects to /admin
app.get('/demo/admin', (req, res) => {
    const clientIp = req.clientIp || req.ip || 'unknown';
    if (!checkDemoRateLimit(clientIp)) {
        return res.status(429).send('Too many demo requests. Please try again later.');
    }
    setNoCacheHeaders(res);
    req.session.isAdmin = true;
    req.session.isDemoAdmin = true;
    req.session.adminUsername = 'Demo Admin (read-only)';
    req.session.adminLoginTime = new Date().toISOString();
    res.redirect('/admin');
});

// Demo user login — creates/finds demo user, logs in via Passport, redirects to /
app.get('/demo/user', async (req, res) => {
    const clientIp = req.clientIp || req.ip || 'unknown';
    if (!checkDemoRateLimit(clientIp)) {
        return res.status(429).send('Too many demo requests. Please try again later.');
    }
    setNoCacheHeaders(res);
    try {
        const demoUser = await db.createOrGetDemoUser();
        req.login(demoUser, (err) => {
            if (err) {
                console.error('Demo user login error:', err);
                return res.redirect('/for-sale');
            }
            req.session.isDemoUser = true;
            res.redirect('/');
        });
    } catch (error) {
        console.error('Error setting up demo user:', error);
        res.redirect('/for-sale');
    }
});

// Demo logout — clears demo session and redirects to for-sale page
app.get('/demo/logout', (req, res) => {
    setNoCacheHeaders(res);
    if (req.session) {
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.redirect('/for-sale');
        });
    } else {
        res.redirect('/for-sale');
    }
});

// Route for maintenance page
app.get('/maintenance', (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'maintenance.html'));
});

// Middleware to check sales page mode for page routes
// Redirects all non-admin visitors to /for-sale when sales page mode is active
async function checkSalesPage(req, res, next) {
    // Admin and demo user sessions bypass the for-sale redirect
    if (req.session && (req.session.isAdmin || req.session.isDemoUser)) {
        return next();
    }
    try {
        const isSalesPage = await db.isSalesPageMode();
        if (isSalesPage) {
            setNoCacheHeaders(res);
            return res.redirect('/for-sale');
        }
    } catch (err) {
        console.error('Error checking sales page mode:', err);
        // On error, proceed normally
    }
    next();
}

// Middleware to check maintenance mode for page routes
async function checkMaintenancePage(req, res, next) {
    try {
        const isMaintenanceOn = await db.isMaintenanceMode();
        if (isMaintenanceOn) {
            setNoCacheHeaders(res);
            return res.redirect('/maintenance');
        }
    } catch (err) {
        // On error, proceed normally
    }
    next();
}

// Route for reactch page
app.get('/reactch', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'reactch.html'));
});

// Route for terms of service page
app.get('/terms', checkSalesPage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'terms.html'));
});

// Route for profile page
app.get('/profile', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'profile.html'));
});

// Route for login page
app.get('/login', checkSalesPage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Route for auto react channels page
app.get('/autoreact', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'autoreact.html'));
});

// Route for transaction history page
app.get('/history', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'history.html'));
});

// Route for pricing/buy coins page
app.get('/pricing', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'pricing.html'));
});

// Route for payment page
app.get('/payment', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'payment.html'));
});

// Route for API key request page
app.get('/api-request', checkSalesPage, checkMaintenancePage, (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'api-request.html'));
});

// Route for API documentation page (requires user with API key or approved request)
app.get('/documentation', checkSalesPage, async (req, res) => {
    setNoCacheHeaders(res);
    
    // Check if user is authenticated
    if (!req.isAuthenticated()) {
        return res.redirect('/login?redirect=/documentation');
    }
    
    // Check if user has at least one API key (active or from approved request)
    try {
        const userApiKeys = await db.getUserApiKeys(req.user.id);
        const apiKeyRequests = await db.getUserApiKeyRequests(req.user.id);
        
        const hasActiveApiKey = userApiKeys.some(key => key.is_active);
        const hasApprovedRequest = apiKeyRequests.some(req => req.status === 'approved' && req.api_key);
        
        if (!hasActiveApiKey && !hasApprovedRequest) {
            // User doesn't have access - redirect to request page
            return res.status(403).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Access Denied - API Documentation</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-gray-900 text-white flex items-center justify-center min-h-screen">
                    <div class="text-center p-8">
                        <h1 class="text-4xl font-bold mb-4">🔒 Access Denied</h1>
                        <p class="text-xl mb-6">You need an approved API key to access the documentation.</p>
                        <p class="text-gray-400 mb-8">Request API access to view the documentation.</p>
                        <a href="/api-request" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg inline-block mr-3">
                            Request API Key
                        </a>
                        <a href="/reactch" class="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg inline-block">
                            Go to Dashboard
                        </a>
                    </div>
                </body>
                </html>
            `);
        }
        
        // User has access - serve documentation
        res.sendFile(path.join(__dirname, 'documentation.html'));
    } catch (error) {
        console.error('Error checking API key access:', error);
        res.status(500).send('Error checking access permissions');
    }
});

// ================== AUTHENTICATION ROUTES ==================

// Helper function to handle banned user logout
// Used by both OAuth callback and auth status check to avoid code duplication
function handleBannedUserLogout(req, res, redirectToLogin = true) {
    req.logout((err) => {
        if (err) {
            console.error('Error logging out banned user:', err);
        }
        if (redirectToLogin) {
            res.redirect('/login?error=account_suspended');
        }
    });
}

// Start Google OAuth
app.get('/api/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

// Google OAuth callback
app.get('/api/auth/google/callback',
    passport.authenticate('google', { 
        failureRedirect: '/login?error=auth_failed' 
    }),
    async (req, res) => {
        try {
            // Update user's IP address
            if (req.user && req.user.id) {
                await db.updateUserIpAddress(req.user.id, req.clientIp);
            }
            
            // Check if user is banned and handle logout
            if (req.user && req.user.is_banned) {
                handleBannedUserLogout(req, res, true);
                return;
            }
            
            // Successful authentication, redirect to dashboard
            res.redirect('/reactch');
        } catch (error) {
            console.error('Error in OAuth callback:', error);
            res.redirect('/reactch');
        }
    }
);

// Check current authentication status
app.get('/api/auth/status', async (req, res) => {
    if (req.isAuthenticated()) {
        // Check if user is banned
        const isBanned = await db.isUserBanned(req.user.id);
        if (isBanned) {
            // Log out the banned user (don't redirect since this is an API endpoint)
            handleBannedUserLogout(req, res, false);
            return res.json({
                success: false,
                authenticated: false,
                banned: true,
                message: 'Your account has been suspended. We are unable to provide our services to you anymore. This decision is final and no further explanation will be provided.'
            });
        }
        
        // Update user's IP address on status check (helps track active users)
        // Error handling is intentionally silent - IP tracking failure should not affect user experience
        db.updateUserIpAddress(req.user.id, req.clientIp).catch(err => {
            console.error('Failed to update user IP address:', err.message);
        });
        
        res.json({
            success: true,
            authenticated: true,
            user: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                avatar: req.user.avatar,
                balance: req.user.balance,
                plan: req.user.plan
            }
        });
    } else {
        res.json({
            success: true,
            authenticated: false,
            user: null
        });
    }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/login');
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// ================== USER API ROUTES ==================

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Authentication required' });
}

// Middleware to check and handle expired Ultra Premium subscriptions
// Automatically downgrades user to free plan if subscription has expired
async function checkSubscriptionStatus(req, res, next) {
    try {
        if (req.isAuthenticated() && req.user && req.user.id) {
            // Check if user's Ultra subscription has expired
            const result = await db.checkAndDowngradeExpiredSubscription(req.user.id);
            if (result.downgraded) {
                // Send notification about downgrade
                await db.createNotification(
                    req.user.id,
                    '⚠️ Ultra Premium Expired',
                    'Your Ultra Premium subscription has expired. Upgrade again to continue enjoying unlimited access!',
                    'warning'
                );
            }
        }
        next();
    } catch (error) {
        // On error, proceed without blocking the request
        console.error('Error checking subscription status:', error);
        next();
    }
}

// Middleware to check maintenance mode - blocks API requests if maintenance is enabled
// Admin routes are excluded from this check
async function checkMaintenanceMode(req, res, next) {
    // Skip maintenance check for admin routes and health check
    if (req.path.startsWith('/api/admin') || req.path === '/health') {
        return next();
    }
    
    try {
        const isMaintenanceOn = await db.isMaintenanceMode();
        if (isMaintenanceOn) {
            return res.status(503).json({
                success: false,
                message: 'Service is currently under maintenance. Please try again later.',
                maintenance: true
            });
        }
        next();
    } catch (error) {
        // On database error, allow request through (fail open)
        console.error('Error checking maintenance mode:', error);
        next();
    }
}

// Middleware to block write operations in demo mode (read-only)
function blockDemoWrites(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }
    // Allow only the demo logout GET path (already GET) — no POST bypasses for demo sessions
    const isDemoAdmin = req.session && req.session.isDemoAdmin;
    const isDemoUser = req.session && req.session.isDemoUser;
    if (isDemoAdmin || isDemoUser) {
        return res.status(403).json({
            success: false,
            message: '🔒 Demo mode: read-only access. No changes can be made in demo mode.'
        });
    }
    next();
}

// Apply demo write-block globally
app.use(blockDemoWrites);

// ================== NOTIFICATION API ROUTES ==================

// Get user notifications
app.get('/api/user/notifications', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const notifications = await db.getUserNotifications(req.user.id, limit);
        const unreadCount = await db.getUnreadNotificationCount(req.user.id);
        
        res.json({
            success: true,
            data: {
                notifications,
                unreadCount
            }
        });
    } catch (error) {
        console.error('Error getting notifications:', error);
        res.status(500).json({ success: false, message: 'Failed to get notifications' });
    }
});

// Get unread notification count
app.get('/api/user/notifications/unread-count', requireAuth, async (req, res) => {
    try {
        const count = await db.getUnreadNotificationCount(req.user.id);
        res.json({ success: true, data: { count } });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ success: false, message: 'Failed to get unread count' });
    }
});

// Mark notification as read
app.post('/api/user/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        await db.markNotificationRead(notificationId, req.user.id);
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
    }
});

// Mark all notifications as read
app.post('/api/user/notifications/read-all', requireAuth, async (req, res) => {
    try {
        await db.markAllNotificationsRead(req.user.id);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
    }
});

// Delete notification
app.delete('/api/user/notifications/:id', requireAuth, async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        await db.deleteNotification(notificationId, req.user.id);
        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
    }
});

// Get current user data
app.get('/api/user/me', requireAuth, checkSubscriptionStatus, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({
            success: true,
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                balance: user.balance,
                plan: user.plan,
                planType: user.plan_type || 'free',
                planExpiresAt: user.plan_expires_at,
                isUnlimited: user.is_unlimited || false,
                offerEndsAt: user.offer_ends_at,
                totalSent: user.total_requests_sent,
                createdAt: user.created_at,
                isDemo: !!(req.session && req.session.isDemoUser)
            }
        });
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ success: false, message: 'Failed to get user data' });
    }
});

// Get user statistics
app.get('/api/user/stats', requireAuth, async (req, res) => {
    try {
        const stats = await db.getUserStats(req.user.id);
        if (!stats) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error getting user stats:', error);
        res.status(500).json({ success: false, message: 'Failed to get user stats' });
    }
});

// Get user transactions
app.get('/api/user/transactions', requireAuth, async (req, res) => {
    try {
        const { filter = 'all', limit = 50 } = req.query;
        const transactions = await db.getUserTransactions(req.user.id, parseInt(limit), filter);
        const summary = await db.getUserTransactionSummary(req.user.id);
        
        res.json({
            success: true,
            data: {
                transactions,
                summary: {
                    totalPurchased: summary.total_credited,
                    totalSpent: summary.total_debited,
                    currentBalance: req.user.balance
                }
            }
        });
    } catch (error) {
        console.error('Error getting transactions:', error);
        res.status(500).json({ success: false, message: 'Failed to get transactions' });
    }
});

// Get user auto react channels
app.get('/api/user/auto-react', requireAuth, async (req, res) => {
    try {
        const { filter = 'all' } = req.query;
        const channels = await db.getUserAutoReactChannels(req.user.id, filter);
        const stats = await db.getAutoReactStats(req.user.id);
        
        res.json({
            success: true,
            data: {
                channels,
                stats
            }
        });
    } catch (error) {
        console.error('Error getting auto react channels:', error);
        res.status(500).json({ success: false, message: 'Failed to get auto react channels' });
    }
});

// Register auto react channel - integrates with external WhatsApp backend API
app.post('/api/user/auto-react', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        const { channelLink, channelJid, channelName, channelFollowers, channelPreview, emojis, days } = req.body;
        
        // Validate input
        if (!channelLink || !days || days < 1) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request. Channel link and days are required.'
            });
        }
        
        if (!emojis || (Array.isArray(emojis) && emojis.length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'Please select at least one emoji for auto react.'
            });
        }
        
        // Validate days (max 365 as per external API)
        if (days > 365) {
            return res.status(400).json({
                success: false,
                message: 'Maximum duration is 365 days.'
            });
        }
        
        // Convert emojis array to string with comma separator (external API format)
        const reactionsString = Array.isArray(emojis) ? emojis.join(',') : emojis;
        
        console.log('📡 Registering auto react channel via external API:', {
            channelLink,
            days,
            reactions: reactionsString
        });
        
        // Call the external WhatsApp backend API to add channel
        const jwtToken = await getRandomToken();
        const backendUrl = `${config.urls.whatsappBackend}/api/channel/add`;
        
        const backendResponse = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'authority': 'foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app',
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'ar-AE,ar;q=0.9,fr-MA;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
                'content-type': 'application/json',
                'cookie': `jwt=${jwtToken}`,
                'origin': 'https://asitha.top',
                'referer': 'https://asitha.top/',
                'sec-ch-ua': '"Chromium";v="107", "Not=A?Brand";v="24"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'cross-site',
                'user-agent': 'Mozilla/5.0 (Linux; Android 12; SM-A217F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36'
            },
            body: JSON.stringify({ channelLink, days, reactions: reactionsString })
        });
        
        const backendData = await backendResponse.json();
        
        console.log('📡 External API response:', backendData);
        
        // Check if external API call was successful
        if (!backendResponse.ok) {
            console.error('External API error:', backendData);
            return res.status(backendResponse.status).json({
                success: false,
                message: backendData.message || 'Failed to register auto react channel with external service.'
            });
        }
        
        // Also save to local database for tracking
        // Cost: 10 coins per day
        try {
            const result = await db.purchaseAutoReactChannel(req.user.id, {
                channelLink, channelJid, channelName, channelFollowers, channelPreview, emojis, days,
                coinsPerDay: 10
            });
            
            res.json({
                success: true,
                message: backendData.message || 'Auto react channel registered successfully',
                data: {
                    ...result.channel,
                    externalChannel: backendData.channel
                }
            });
        } catch (dbError) {
            // CRITICAL: External API succeeded but local DB failed
            // Log for manual intervention - user was charged externally but not tracked locally
            console.error('❌ CRITICAL: Local DB save failed after external API success:', {
                userId: req.user.id,
                channelLink,
                days,
                externalResponse: backendData,
                error: dbError.message
            });
            // Still return success since external API worked - user's channel is active
            res.json({
                success: true,
                message: backendData.message || 'Auto react channel registered successfully',
                data: {
                    externalChannel: backendData.channel
                }
            });
        }
    } catch (error) {
        console.error('Error registering auto react channel:', error);
        
        if (error.message === 'Insufficient balance') {
            return res.status(400).json({ 
                success: false,
                message: 'Insufficient balance. Please add balance.' 
            });
        }
        
        res.status(500).json({ success: false, message: 'Failed to register auto react channel' });
    }
});

// ================== PAYMENT ROUTES ==================

// Configure multer for file uploads
// Use /tmp for serverless environments (Vercel, AWS Lambda, etc.) since the project directory is read-only
// Fall back to local 'uploads' directory for development
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY;
const uploadsDir = isServerless ? '/tmp/uploads' : path.join(__dirname, 'uploads');

// Safely create uploads directory - wrap in try-catch for read-only filesystems
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (dirError) {
    console.warn(`⚠️ Could not create uploads directory at ${uploadsDir}:`, dirError.message);
    console.warn('⚠️ File uploads may not work properly in this environment');
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'payment-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PNG, JPG, GIF, WEBP allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Submit payment proof
app.post('/api/payment/submit', checkMaintenanceMode, requireAuth, upload.single('proof'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Payment proof image is required.'
            });
        }

        const { package: packageName, coins, price } = req.body;
        
        // Validate package
        const validPackages = {
            'starter': { coins: 90, price: 500 },
            'popular': { coins: 190, price: 1000 },
            'pro': { coins: 500, price: 2500 },
            'ultimate': { coins: 1100, price: 5000 }
        };

        const pkg = validPackages[packageName];
        if (!pkg || parseInt(coins) !== pkg.coins || parseInt(price) !== pkg.price) {
            // Clean up uploaded file if validation fails
            if (req.file) {
                fs.unlink(req.file.path, (err) => {
                    if (err) console.error('Error cleaning up file:', err);
                });
            }
            return res.status(400).json({
                success: false,
                message: 'Invalid package selection.'
            });
        }

        // Extract only the safe filename (no path info) for transaction details
        const safeFilename = path.basename(req.file.filename);

        // Save payment request to database with proof file
        const transaction = await db.addTransaction(req.user.id, {
            type: 'credit',
            category: 'purchase',
            description: `Achat de ${coins} coins - ${packageName.toUpperCase()}`,
            details: `Paiement NATCOM: ${parseInt(price).toLocaleString()} Gdes | Ref: ${safeFilename}`,
            amount: parseInt(coins),
            status: 'pending',
            proofFile: safeFilename
        });

        res.json({
            success: true,
            message: 'Payment proof submitted successfully. Your account will be activated within 5 minutes to 6 hours.',
            data: {
                transactionId: transaction.id,
                package: packageName,
                coins: parseInt(coins),
                price: parseInt(price),
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('Error submitting payment proof:', error);
        // Clean up uploaded file on error
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error cleaning up file:', err);
            });
        }
        res.status(500).json({ success: false, message: 'Failed to submit payment proof.' });
    }
});

// ================== OXAPAY PAYMENT API ENDPOINTS ==================

const oxapayService = require('./oxapayService');

/**
 * Get payment configuration (public endpoint)
 * Returns pricing info for frontend display
 */
app.get('/api/payment/config', checkMaintenanceMode, (req, res) => {
    res.json({
        success: true,
        data: {
            minimumUSD: config.oxapay.minimumUSD,
            currency: config.oxapay.currency,
            enabled: config.oxapay.enabled
        }
    });
});

/**
 * Calculate USDT price for USD amount
 * 1 USD = 1 USDT (direct)
 */
app.post('/api/crypto/calculate-price', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        const { amount } = req.body;
        
        // Validate input
        const usdAmount = parseFloat(amount);
        if (isNaN(usdAmount) || usdAmount < config.oxapay.minimumUSD) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase is $${config.oxapay.minimumUSD.toFixed(2)} USD`
            });
        }
        
        // 1 USD = 1 USDT
        const usdtAmount = oxapayService.calculateUSDTFromUSD(usdAmount);
        
        res.json({
            success: true,
            data: {
                amount: parseFloat(usdAmount.toFixed(2)),
                usdtAmount: parseFloat(usdtAmount.toFixed(2))
            }
        });
    } catch (error) {
        console.error('Error calculating price:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to calculate price' 
        });
    }
});

/**
 * Create a new payment order via OxaPay
 * User pays USDT, gets equivalent USD added to balance
 */
app.post('/api/create-payment', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        // Check if payments are enabled
        if (!config.oxapay || !config.oxapay.enabled) {
            return res.status(503).json({
                success: false,
                message: 'Payments are currently disabled'
            });
        }

        // Check if merchant key is configured
        if (!config.oxapay.merchantKey) {
            console.error('❌ OxaPay merchant key not configured');
            return res.status(503).json({
                success: false,
                message: 'Payment system not configured. Please contact support.'
            });
        }

        const { amount, email } = req.body;
        
        // Validate input - amount is in USD
        const usdAmount = parseFloat(amount);
        if (isNaN(usdAmount) || usdAmount < config.oxapay.minimumUSD) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase is $${config.oxapay.minimumUSD.toFixed(2)} USD`
            });
        }
        
        // 1 USD = 1 USDT
        const usdtAmount = oxapayService.calculateUSDTFromUSD(usdAmount);
        
        // Calculate expiration time
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + config.oxapay.orderExpirationHours);
        
        // Create order in database
        const order = await db.createOxaPayOrder({
            userId: req.user.id,
            usdAmount: parseFloat(usdAmount.toFixed(2)),
            expectedUsdtAmount: parseFloat(usdtAmount.toFixed(2)),
            expiresAt: expiresAt
        });
        
        // Create payment with OxaPay
        const paymentResult = await oxapayService.createPayment({
            amount: usdtAmount,
            orderId: order.id,
            email: email || req.user.email || '',
            description: `Add $${usdAmount.toFixed(2)} USD balance - Order #${order.id}`
        });

        // Update order with OxaPay trackId
        await db.updateOxaPayOrderTrackId(order.id, paymentResult.trackId);
        
        console.log(`✅ Created OxaPay order ${order.id} for user ${req.user.id}`);
        console.log(`   TrackId: ${paymentResult.trackId}`);
        console.log(`   Amount: $${usdAmount.toFixed(2)} USD = ${usdtAmount.toFixed(2)} USDT`);
        
        res.json({
            success: true,
            message: 'Payment created successfully',
            data: {
                orderId: order.id,
                trackId: paymentResult.trackId,
                paymentUrl: paymentResult.payLink,
                amount: parseFloat(usdAmount.toFixed(2)),
                usdtAmount: parseFloat(usdtAmount.toFixed(2)),
                expiresAt: expiresAt.toISOString(),
                status: 'pending'
            }
        });
        
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create payment. Please try again.' 
        });
    }
});

/**
 * Create a new Ultra Premium plan payment ($15 fixed price)
 * Returns a payment link to redirect user to
 */
app.post('/api/create-ultra-payment', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        // Check if payments are enabled
        if (!config.oxapay || !config.oxapay.enabled) {
            return res.status(503).json({
                success: false,
                message: 'Payments are currently disabled'
            });
        }

        // Check if merchant key is configured
        if (!config.oxapay.merchantKey) {
            console.error('❌ OxaPay merchant key not configured');
            return res.status(503).json({
                success: false,
                message: 'Payment system not configured. Please contact support.'
            });
        }

        // Check if user is already Ultra Premium
        const currentUser = await db.getUserById(req.user.id);
        if (db.hasActiveUltraPlan(currentUser)) {
            return res.status(400).json({
                success: false,
                message: 'You already have an active Ultra Premium subscription'
            });
        }

        // Fixed price for Ultra Premium: $15 USD
        const ULTRA_PRICE_USDT = 15;
        const { email } = req.body;
        
        // Calculate expiration time
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + config.oxapay.orderExpirationHours);
        
        // Create order in database with special marker for Ultra plan
        const order = await db.createOxaPayOrder({
            userId: req.user.id,
            coinsRequested: -1, // -1 indicates Ultra plan purchase (not coin purchase)
            expectedUsdtAmount: ULTRA_PRICE_USDT,
            expiresAt: expiresAt
        });
        
        // Create payment with OxaPay
        const paymentResult = await oxapayService.createPayment({
            amount: ULTRA_PRICE_USDT,
            orderId: `ULTRA-${order.id}`,
            email: email || req.user.email || '',
            description: `Ultra Premium 14-Day Pass - Order #${order.id}`
        });

        // Update order with OxaPay trackId
        await db.updateOxaPayOrderTrackId(order.id, paymentResult.trackId);
        
        console.log(`✅ Created Ultra Premium order ${order.id} for user ${req.user.id}`);
        console.log(`   TrackId: ${paymentResult.trackId}`);
        console.log(`   Amount: $${ULTRA_PRICE_USDT} USDT (Ultra Premium 14-Day Pass)`);
        
        res.json({
            success: true,
            message: 'Ultra Premium payment created successfully',
            data: {
                orderId: order.id,
                trackId: paymentResult.trackId,
                paymentUrl: paymentResult.payLink,
                planType: 'ultra',
                usdtAmount: ULTRA_PRICE_USDT,
                expiresAt: expiresAt.toISOString(),
                status: 'pending'
            }
        });
        
    } catch (error) {
        console.error('Error creating Ultra payment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create payment. Please try again.' 
        });
    }
});

/**
 * Get Ultra Premium offer status (for countdown timer)
 */
app.get('/api/ultra/offer-status', async (req, res) => {
    try {
        const offerStatus = await db.getUltraOfferStatus();
        res.json({
            success: true,
            data: offerStatus
        });
    } catch (error) {
        console.error('Error getting Ultra offer status:', error);
        res.status(500).json({ success: false, message: 'Failed to get offer status' });
    }
});

/**
 * Create a website sale payment via OxaPay ($50 USD)
 * Public endpoint — no auth required (buyer is not a platform user)
 */
app.post('/api/create-website-sale-payment', async (req, res) => {
    try {
        if (!config.oxapay || !config.oxapay.enabled) {
            return res.status(503).json({ success: false, message: 'Payment system is currently unavailable' });
        }
        if (!config.oxapay.merchantKey) {
            console.error('❌ OxaPay merchant key not configured');
            return res.status(503).json({ success: false, message: 'Payment system not configured. Please contact support.' });
        }

        const { email, name } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'A valid email address is required' });
        }

        const SALE_PRICE_USDT = 50;
        const oxapayOrderId = `WEBSALE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (config.oxapay.orderExpirationHours || 12));

        // Store order record
        await db.createWebsiteSaleOrder({
            buyerEmail: email,
            buyerName: name || null,
            amount: SALE_PRICE_USDT,
            oxapayOrderId,
            expiresAt
        });

        const baseUrl = config.urls?.baseUrl || 'https://easybooster.shop';
        const paymentResult = await oxapayService.createPayment({
            amount: SALE_PRICE_USDT,
            orderId: oxapayOrderId,
            email,
            description: `Easy Booster SMM Platform - Full Source Code ($${SALE_PRICE_USDT} USD)`
        });

        // Store the returned trackId
        await db.updateWebsiteSaleOrderStatus(oxapayOrderId, 'pending', paymentResult.trackId, null);

        console.log(`✅ Website sale payment created: ${oxapayOrderId} for ${email}`);

        res.json({
            success: true,
            data: {
                paymentUrl: paymentResult.payLink,
                orderId: oxapayOrderId,
                amount: SALE_PRICE_USDT
            }
        });
    } catch (error) {
        console.error('Error creating website sale payment:', error);
        res.status(500).json({ success: false, message: 'Failed to create payment. Please try again.' });
    }
});

/**
 * Auto-start Ultra Premium offer if none is active (for MVP)
 * This can be called by the frontend to ensure an offer is always available
 */
app.post('/api/ultra/auto-start-offer', async (req, res) => {
    try {
        // Check if an offer is already active
        const existingOffer = await db.getUltraOfferStatus();
        if (existingOffer.active) {
            return res.json({
                success: true,
                data: existingOffer
            });
        }
        
        // No active offer, start a new one
        const newOffer = await db.startUltraOffer();
        res.json({
            success: true,
            data: newOffer
        });
    } catch (error) {
        console.error('Error auto-starting Ultra offer:', error);
        res.status(500).json({ success: false, message: 'Failed to start offer' });
    }
});

/**
 * Legacy endpoint - redirect to new endpoint
 * @deprecated Use /api/create-payment instead
 */
app.post('/api/crypto/create-order', checkMaintenanceMode, requireAuth, async (req, res) => {
    // Directly call the create-payment logic
    try {
        // Check if payments are enabled
        if (!config.oxapay || !config.oxapay.enabled) {
            return res.status(503).json({
                success: false,
                message: 'Payments are currently disabled'
            });
        }

        // Check if merchant key is configured
        if (!config.oxapay.merchantKey) {
            console.error('❌ OxaPay merchant key not configured');
            return res.status(503).json({
                success: false,
                message: 'Payment system not configured. Please contact support.'
            });
        }

        const { amount, email } = req.body;
        
        // Validate input - amount is in USD
        const usdAmount = parseFloat(amount);
        if (isNaN(usdAmount) || usdAmount < config.oxapay.minimumUSD) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase is $${config.oxapay.minimumUSD.toFixed(2)} USD`
            });
        }
        
        // 1 USD = 1 USDT
        const usdtAmount = oxapayService.calculateUSDTFromUSD(usdAmount);
        
        // Calculate expiration time
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + config.oxapay.orderExpirationHours);
        
        // Create order in database
        const order = await db.createOxaPayOrder({
            userId: req.user.id,
            usdAmount: parseFloat(usdAmount.toFixed(2)),
            expectedUsdtAmount: parseFloat(usdtAmount.toFixed(2)),
            expiresAt: expiresAt
        });
        
        // Create payment with OxaPay
        const paymentResult = await oxapayService.createPayment({
            amount: usdtAmount,
            orderId: order.id,
            email: email || req.user.email || '',
            description: `Add $${usdAmount.toFixed(2)} USD balance - Order #${order.id}`
        });

        // Update order with OxaPay trackId
        await db.updateOxaPayOrderTrackId(order.id, paymentResult.trackId);
        
        console.log(`✅ Created OxaPay order ${order.id} for user ${req.user.id} (via legacy endpoint)`);
        
        res.json({
            success: true,
            message: 'Payment created successfully',
            data: {
                orderId: order.id,
                trackId: paymentResult.trackId,
                paymentUrl: paymentResult.payLink,
                amount: parseFloat(usdAmount.toFixed(2)),
                usdtAmount: parseFloat(usdtAmount.toFixed(2)),
                expiresAt: expiresAt.toISOString(),
                status: 'pending'
            }
        });
        
    } catch (error) {
        console.error('Error creating payment (legacy endpoint):', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create payment. Please try again.' 
        });
    }
});

/**
 * OxaPay Webhook Handler
 * Verifies payment callbacks and updates user balance
 * 
 * Note: Uses express.raw() for HMAC signature verification
 * The raw body is required to compute the HMAC hash correctly
 */
app.post('/api/oxapay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Get raw body for HMAC verification
        const rawBody = req.body.toString();
        const hmacHeader = req.headers['hmac'];
        
        // Verify HMAC signature
        if (!oxapayService.verifyWebhookSignature(rawBody, hmacHeader)) {
            console.error('❌ Invalid OxaPay webhook signature');
            return res.status(401).json({ success: false, message: 'Invalid signature' });
        }
        
        // Parse webhook data
        const webhookData = JSON.parse(rawBody);
        const parsedData = oxapayService.parseWebhookData(webhookData);
        
        if (!parsedData.valid) {
            console.error('❌ Invalid webhook data:', parsedData.error);
            return res.status(400).json({ success: false, message: parsedData.error });
        }

        console.log(`📥 OxaPay webhook received: Order ${parsedData.orderId}, Status: ${parsedData.status}`);

        // Check if this is a website sale order (orderId format: WEBSALE-{timestamp}-{random})
        if (String(parsedData.orderId).startsWith('WEBSALE-')) {
            const saleOrder = await db.getWebsiteSaleOrderByOxapayId(parsedData.orderId);
            if (!saleOrder) {
                console.error(`❌ Website sale order not found: ${parsedData.orderId}`);
                return res.status(404).json({ success: false, message: 'Order not found' });
            }
            if (saleOrder.status === 'paid' || saleOrder.status === 'complete') {
                return res.json({ success: true, message: 'Already processed' });
            }
            if (parsedData.isPaid) {
                await db.updateWebsiteSaleOrderStatus(parsedData.orderId, 'paid', parsedData.trackId, parsedData.txID);
                console.log(`✅ Website sale payment confirmed: ${parsedData.orderId}, buyer: ${saleOrder.buyer_email}`);

                // Build shared email transport once
                const emailConfig = require('./emailConfig');
                const nodemailer = require('nodemailer');
                const mailTransport = nodemailer.createTransport({
                    host: emailConfig.smtp.host,
                    port: emailConfig.smtp.port,
                    secure: emailConfig.smtp.secure,
                    auth: emailConfig.smtp.auth
                });
                const buyerName = saleOrder.buyer_name || 'there';

                // ── 1. Notify the owner ──────────────────────────────────────
                try {
                    await mailTransport.sendMail({
                        from: `"Easy Booster" <${emailConfig.from.email}>`,
                        to: emailConfig.from.email,
                        subject: '🎉 Website Sale Confirmed — $50 USD Payment Received',
                        html: `
                            <h2>🎉 Someone just bought your website!</h2>
                            <p><strong>Buyer Email:</strong> ${saleOrder.buyer_email}</p>
                            ${saleOrder.buyer_name ? `<p><strong>Buyer Name:</strong> ${saleOrder.buyer_name}</p>` : ''}
                            <p><strong>Amount Paid:</strong> $${saleOrder.amount} USD</p>
                            <p><strong>OxaPay Track ID:</strong> ${parsedData.trackId || 'N/A'}</p>
                            <p><strong>TxID:</strong> ${parsedData.txID || 'N/A'}</p>
                            <p><strong>Order ID:</strong> ${parsedData.orderId}</p>
                            <hr>
                            <p>The buyer has automatically received the installation documentation and platform info email. Please also invite <strong>${saleOrder.buyer_email}</strong> to the private GitHub repository.</p>
                        `
                    });
                    console.log(`📧 Owner notified about website sale to ${saleOrder.buyer_email}`);
                } catch (emailErr) {
                    console.error('Failed to send owner notification email:', emailErr.message);
                }

                // ── 2. Send buyer the delivery / documentation email ─────────
                try {
                    const installationGuideHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0d1117;color:#c9d1d9;margin:0;padding:0;}
  .wrap{max-width:680px;margin:0 auto;padding:40px 24px;}
  h1{color:#58a6ff;font-size:1.7rem;margin-bottom:4px;}
  h2{color:#e6edf3;font-size:1.1rem;margin:28px 0 10px;border-bottom:1px solid #30363d;padding-bottom:8px;}
  p,li{color:#8b949e;font-size:14px;line-height:1.7;}
  li{margin-bottom:6px;}
  code,pre{background:#161b22;border:1px solid #30363d;border-radius:6px;font-size:13px;color:#79c0ff;}
  code{padding:2px 6px;}
  pre{padding:14px 18px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
  .badge{display:inline-block;background:#1f6feb22;border:1px solid #1f6feb55;border-radius:6px;padding:4px 12px;font-size:12px;color:#58a6ff;font-weight:600;margin-bottom:24px;}
  .check{color:#3fb950;margin-right:6px;}
  .step{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 20px;margin-bottom:12px;}
  .step-num{display:inline-block;background:#1f6feb;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:10px;}
  .highlight-box{background:#1f2d1f;border:1px solid #3fb95055;border-radius:10px;padding:16px 20px;margin:20px 0;}
  .warning-box{background:#2d1f1f;border:1px solid #f8514955;border-radius:10px;padding:16px 20px;margin:20px 0;}
  a{color:#58a6ff;}
  hr{border:none;border-top:1px solid #30363d;margin:28px 0;}
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">🎉 Payment Confirmed — Order ${parsedData.orderId}</div>
  <h1>Welcome, ${buyerName}!</h1>
  <p style="color:#c9d1d9;font-size:15px;">Thank you for purchasing the <strong>Easy Booster SMM Platform</strong>. Below is everything you need to set it up and launch your own version. Read through carefully — this email is your complete getting-started guide.</p>

  <hr>

  <!-- WHAT YOU'RE GETTING -->
  <h2>📦 What You're Getting</h2>
  <ul>
    <li><span class="check">✓</span> Complete Node.js + Express back-end source code</li>
    <li><span class="check">✓</span> All front-end HTML pages (dashboard, admin, pricing, etc.)</li>
    <li><span class="check">✓</span> PostgreSQL database schema + auto-init on first start</li>
    <li><span class="check">✓</span> OxaPay crypto payment integration (USDT, BTC, LTC, ETH, 100+)</li>
    <li><span class="check">✓</span> Google OAuth 2.0 authentication</li>
    <li><span class="check">✓</span> Full admin dashboard (users, balances, coupons, notifications, settings)</li>
    <li><span class="check">✓</span> SMM service engine — 200+ services across all major platforms</li>
    <li><span class="check">✓</span> WhatsApp channel growth tools (unique feature)</li>
    <li><span class="check">✓</span> AI ban &amp; abuse detection system with fingerprinting</li>
    <li><span class="check">✓</span> Email notification system (Nodemailer, SMTP)</li>
    <li><span class="check">✓</span> Coupon / discount code system</li>
    <li><span class="check">✓</span> One-click database backup &amp; restore from admin panel</li>
    <li><span class="check">✓</span> Maintenance mode toggle</li>
    <li><span class="check">✓</span> Procfile ready for Heroku / Railway / Render</li>
    <li><span class="check">✓</span> Access to the private GitHub repository (invite will be sent to this email)</li>
  </ul>

  <div class="highlight-box">
    <p style="margin:0;color:#3fb950;font-weight:600;">🐙 GitHub Repository</p>
    <p style="margin:8px 0 0;">You will receive a GitHub repository invitation at <strong>${saleOrder.buyer_email}</strong> within 24 hours. The repo contains the full commit history, all branches, and the latest production-ready code. Accept the invite and you'll have owner-level access.</p>
    <p style="margin:8px 0 0;"><strong>Repo:</strong> <a href="https://github.com/mc-shizzy/ARCH">github.com/mc-shizzy/ARCH</a></p>
  </div>

  <hr>

  <!-- TECH STACK -->
  <h2>🛠️ Tech Stack at a Glance</h2>
  <ul>
    <li><strong>Runtime:</strong> Node.js (v18+)</li>
    <li><strong>Framework:</strong> Express.js</li>
    <li><strong>Database:</strong> PostgreSQL (v14+)</li>
    <li><strong>Auth:</strong> Google OAuth 2.0 + Passport.js + express-session</li>
    <li><strong>Payments:</strong> OxaPay (crypto) via REST API</li>
    <li><strong>Email:</strong> Nodemailer (Gmail / any SMTP)</li>
    <li><strong>Hosting:</strong> Heroku, Railway, or Render (one-click with Procfile)</li>
    <li><strong>SMM API:</strong> Provider-agnostic — works with any panel that has a standard SMM API</li>
  </ul>

  <hr>

  <!-- INSTALLATION GUIDE -->
  <h2>🚀 Installation &amp; Setup Guide</h2>

  <div class="step">
    <span class="step-num">1</span><strong>Clone / download the repository</strong>
    <pre>git clone https://github.com/mc-shizzy/ARCH.git
cd ARCH
npm install</pre>
  </div>

  <div class="step">
    <span class="step-num">2</span><strong>Create your <code>.env</code> file</strong>
    <p>Copy the template below and fill in your own values:</p>
    <pre># ─── Database ─────────────────────────────────────────────
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME

# ─── Session secret (any long random string) ───────────────
SESSION_SECRET=change_this_to_a_random_64_char_string

# ─── Google OAuth ──────────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback

# ─── OxaPay (crypto payments) ─────────────────────────────
OXAPAY_MERCHANT_KEY=your_oxapay_merchant_key
OXAPAY_CALLBACK_URL=https://yourdomain.com/api/oxapay-webhook
OXAPAY_RETURN_URL=https://yourdomain.com/pricing?status=success

# ─── Base URL ──────────────────────────────────────────────
BASE_URL=https://yourdomain.com

# ─── SMM API ───────────────────────────────────────────────
SMM_API_URL=https://your-smm-provider.com/api/v2
SMM_API_KEY=your_smm_api_key

# ─── Email (Nodemailer SMTP) ───────────────────────────────
# Edit emailConfig.js directly OR set via env vars
NODE_ENV=production</pre>
  </div>

  <div class="step">
    <span class="step-num">3</span><strong>Set up PostgreSQL</strong>
    <p>Create a new database. The app auto-creates all tables on first start — no manual SQL needed.</p>
    <pre># Example (local):
createdb easybooster

# Or use a cloud provider:
# - Heroku Postgres (free tier available)
# - Railway Postgres
# - Supabase (free tier)
# - Neon (free tier)</pre>
  </div>

  <div class="step">
    <span class="step-num">4</span><strong>Configure Google OAuth</strong>
    <ol>
      <li>Go to <a href="https://console.cloud.google.com/">console.cloud.google.com</a></li>
      <li>Create a new project (or use an existing one)</li>
      <li>Enable the <strong>Google+ API</strong> / <strong>Google Identity</strong></li>
      <li>Create OAuth 2.0 credentials → Web Application</li>
      <li>Set the Authorised redirect URI to: <code>https://yourdomain.com/auth/google/callback</code></li>
      <li>Copy <code>Client ID</code> and <code>Client Secret</code> into your <code>.env</code></li>
    </ol>
  </div>

  <div class="step">
    <span class="step-num">5</span><strong>Configure OxaPay</strong>
    <ol>
      <li>Create a merchant account at <a href="https://oxapay.com">oxapay.com</a></li>
      <li>In your OxaPay dashboard, create a new merchant key</li>
      <li>Set the webhook (callback) URL to: <code>https://yourdomain.com/api/oxapay-webhook</code></li>
      <li>Set the return URL to: <code>https://yourdomain.com/pricing?status=success</code></li>
      <li>Copy your merchant key into your <code>.env</code> as <code>OXAPAY_MERCHANT_KEY</code></li>
    </ol>
  </div>

  <div class="step">
    <span class="step-num">6</span><strong>Set your SMM API provider</strong>
    <p>The platform works with any SMM panel that provides a standard <code>/api/v2</code> endpoint. Popular providers: SMMPanel, JustAnotherPanel, etc.</p>
    <pre># In your .env:
SMM_API_URL=https://your-provider.com/api/v2
SMM_API_KEY=your_api_key_from_provider</pre>
    <p>You can also update the default services list in <code>smmService.js</code> to match your provider's service IDs.</p>
  </div>

  <div class="step">
    <span class="step-num">7</span><strong>Configure email (Nodemailer)</strong>
    <p>Edit <code>emailConfig.js</code> directly with your SMTP credentials (Gmail recommended):</p>
    <pre>// emailConfig.js
from: { name: 'Your Platform Name', email: 'you@gmail.com' },
smtp: {
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: 'you@gmail.com', pass: 'your_app_password' }
}</pre>
    <p>For Gmail: use a 16-character App Password (requires 2FA). <a href="https://myaccount.google.com/apppasswords">Generate App Password →</a></p>
  </div>

  <div class="step">
    <span class="step-num">8</span><strong>Run locally</strong>
    <pre>npm start
# or for development with auto-reload:
npm install -g nodemon
nodemon server.js</pre>
    <p>Visit <code>http://localhost:3000</code> in your browser.</p>
  </div>

  <div class="step">
    <span class="step-num">9</span><strong>Deploy to Railway (recommended — free tier)</strong>
    <ol>
      <li>Push your code to a GitHub repo (your new private repo)</li>
      <li>Go to <a href="https://railway.app">railway.app</a> → New Project → Deploy from GitHub</li>
      <li>Add a PostgreSQL plugin to your project</li>
      <li>Set all environment variables in the Railway dashboard</li>
      <li>Railway auto-detects the <code>Procfile</code> and deploys with <code>npm start</code></li>
      <li>Add your custom domain in Railway settings</li>
    </ol>
  </div>

  <div class="step">
    <span class="step-num">10</span><strong>Set your admin account</strong>
    <p>Sign in via Google OAuth first. Then in your PostgreSQL database, run:</p>
    <pre>UPDATE users SET is_admin = true WHERE email = 'your@email.com';</pre>
    <p>You'll now have full admin access at <code>/admin</code>.</p>
  </div>

  <hr>

  <!-- KEY FILES -->
  <h2>📁 Key Files &amp; Structure</h2>
  <ul>
    <li><code>server.js</code> — Main Express server, all API routes and middleware</li>
    <li><code>database.js</code> — All PostgreSQL queries and DB helper functions</li>
    <li><code>config.js</code> — Reads environment variables and exports config object</li>
    <li><code>emailConfig.js</code> — SMTP settings (edit directly, not via .env)</li>
    <li><code>oxapayService.js</code> — OxaPay payment creation and webhook verification</li>
    <li><code>smmService.js</code> — SMM API integration layer</li>
    <li><code>emailService.js</code> — Email templates and broadcast system</li>
    <li><code>index.html</code> — Main landing / home page</li>
    <li><code>dashboard.html</code> → <code>pricing.html</code> — User-facing pages</li>
    <li><code>admin.html</code> — Admin control panel</li>
    <li><code>Procfile</code> — Heroku/Railway start command: <code>web: node server.js</code></li>
  </ul>

  <hr>

  <!-- IMPORTANT NOTES -->
  <h2>⚠️ Important Notes</h2>
  <div class="warning-box">
    <ul style="margin:0;padding-left:18px;">
      <li>Never commit your <code>.env</code> file to GitHub — it's already in <code>.gitignore</code></li>
      <li>Rotate the <code>SESSION_SECRET</code> — use a new random 64-character string</li>
      <li>Change <code>emailConfig.js</code> to your own email/SMTP before going live</li>
      <li>Update the OxaPay merchant key — the current one belongs to Easy Booster</li>
      <li>Replace the Google OAuth credentials with your own application</li>
      <li>For the SMM services to work, sign up with an SMM API provider and update <code>SMM_API_KEY</code></li>
    </ul>
  </div>

  <div class="highlight-box">
    <p style="margin:0;color:#3fb950;font-weight:600;">✅ You're all set!</p>
    <p style="margin:8px 0 0;">Once configured, your platform will be fully functional. To re-open SMM services for users, go to the admin dashboard and toggle off "Sales Page Mode".</p>
    <p style="margin:8px 0 0;">If you have any questions, feel free to reply to this email or contact the seller at <a href="mailto:${emailConfig.from.email}">${emailConfig.from.email}</a>.</p>
  </div>

  <hr>
  <p style="font-size:12px;color:#484f58;text-align:center;">
    Easy Booster SMM Platform · One-time purchase · Order ${parsedData.orderId}<br>
    This email was sent automatically upon payment confirmation.
  </p>
</div>
</body>
</html>`;

                    await mailTransport.sendMail({
                        from: `"Easy Booster" <${emailConfig.from.email}>`,
                        to: saleOrder.buyer_email,
                        subject: '🎉 Easy Booster — Your Purchase is Confirmed! Installation Guide Inside',
                        html: installationGuideHtml
                    });
                    console.log(`📧 Buyer delivery email sent to ${saleOrder.buyer_email}`);
                } catch (emailErr) {
                    console.error('Failed to send buyer delivery email:', emailErr.message);
                }
            } else {
                await db.updateWebsiteSaleOrderStatus(parsedData.orderId, parsedData.status.toLowerCase(), parsedData.trackId, null);
            }
            return res.json({ success: true, message: 'Webhook processed' });
        }

        // Check if this is an Ultra plan order (orderId format: ULTRA-{id})
        let actualOrderId = parsedData.orderId;
        let isUltraOrder = false;
        if (String(parsedData.orderId).startsWith('ULTRA-')) {
            actualOrderId = parseInt(String(parsedData.orderId).replace('ULTRA-', ''));
            isUltraOrder = true;
        }
        
        // Get order from database
        const order = await db.getOxaPayOrderById(actualOrderId);
        
        if (!order) {
            console.error(`❌ Order not found: ${actualOrderId}`);
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        
        // Already processed
        if (order.status === 'paid' || order.status === 'completed') {
            return res.json({ success: true, message: 'Already processed' });
        }
        
        // Process payment if status is Paid or Complete
        if (parsedData.isPaid) {
            // Update order status
            await db.updateOxaPayOrderStatus(
                order.id, 
                'paid', 
                parsedData.trackId,
                parsedData.txID
            );
            
            // Check if this is an Ultra Premium plan purchase (coins_requested = -1)
            if (order.coins_requested === -1 || isUltraOrder) {
                // Ultra Premium plan purchase
                await db.upgradeToUltraPlan(order.user_id);
                
                // Create transaction record for Ultra Premium
                await db.addTransaction(order.user_id, {
                    type: 'credit',
                    category: 'ultra-premium',
                    description: 'Ultra Premium 14-Day Pass - Unlimited Access',
                    details: 'Ultra Premium subscription activated - $15 USDT',
                    amount: 0,
                    status: 'completed'
                });
                
                // Send confirmation notification
                await db.createNotification(
                    order.user_id,
                    '🎉 Ultra Premium Activated!',
                    'Congratulations! Your Ultra Premium 14-Day Pass is now active. Enjoy unlimited access, priority support, and no daily limits!',
                    'success'
                );
                
                console.log(`✅ Ultra Premium payment confirmed for order ${order.id}`);
                console.log(`   User ${order.user_id} upgraded to Ultra Premium (14 days)`);
                console.log(`   TxID: ${parsedData.txID}`);
            } else {
                // Regular balance purchase - credit USD directly
                const usdToAdd = parseFloat(order.expected_usdt_amount);
                await db.updateUserBalance(order.user_id, usdToAdd, 'credit');
                
                // Create transaction record
                await db.addTransaction(order.user_id, {
                    type: 'credit',
                    category: 'purchase',
                    description: `Added $${usdToAdd.toFixed(2)} USD balance`,
                    details: `Added $${usdToAdd.toFixed(2)} USD via OxaPay payment`,
                    amount: usdToAdd,
                    status: 'completed'
                });

                // Upgrade user to premium if not already
                const user = await db.getUserById(order.user_id);
                if (user && !user.is_premium) {
                    await db.pool.query(
                        'UPDATE users SET is_premium = true WHERE id = $1',
                        [order.user_id]
                    );
                }
                
                // Send confirmation notification
                await db.createNotification(
                    order.user_id,
                    '💰 Payment Confirmed!',
                    `Your payment has been confirmed. $${usdToAdd.toFixed(2)} USD has been added to your balance.`,
                    'success'
                );
                
                console.log(`✅ Payment confirmed for order ${order.id}`);
                console.log(`   User ${order.user_id} credited with $${usdToAdd.toFixed(2)} USD`);
                console.log(`   TxID: ${parsedData.txID}`);
            }
        } else {
            // Update order status to reflect current state
            await db.updateOxaPayOrderStatus(order.id, parsedData.status.toLowerCase());
        }
        
        res.json({ success: true, message: 'Webhook processed' });
        
    } catch (error) {
        console.error('Error processing OxaPay webhook:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * Check payment status for an order
 */
app.get('/api/crypto/check-payment/:orderId', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId);
        
        // Get order from OxaPay orders table
        let order = await db.getOxaPayOrderById(orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        // Check if order belongs to user
        if (order.user_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: {
                orderId: order.id,
                status: order.status,
                amount: parseFloat(order.expected_usdt_amount),
                usdtAmount: parseFloat(order.expected_usdt_amount),
                trackId: order.oxapay_track_id || order.track_id,
                txid: order.txid,
                createdAt: order.created_at,
                expiresAt: order.expires_at,
                paidAt: order.paid_at
            }
        });
        
    } catch (error) {
        console.error('Error checking payment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to check payment status' 
        });
    }
});

/**
 * Get user's payment orders
 */
app.get('/api/crypto/orders', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        const orders = await db.getUserOxaPayOrders(req.user.id, 50);
        
        res.json({
            success: true,
            data: orders.map(order => ({
                orderId: order.id,
                status: order.status,
                amount: parseFloat(order.expected_usdt_amount),
                usdtAmount: parseFloat(order.expected_usdt_amount),
                trackId: order.oxapay_track_id,
                txid: order.txid,
                createdAt: order.created_at,
                expiresAt: order.expires_at,
                paidAt: order.paid_at
            }))
        });
        
    } catch (error) {
        console.error('Error getting orders:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get orders' 
        });
    }
});

// Get user pending payments
app.get('/api/user/pending-payments', requireAuth, async (req, res) => {
    try {
        const transactions = await db.getUserTransactions(req.user.id, 50, 'purchase');
        const pendingPayments = transactions.filter(t => t.status === 'pending');
        
        res.json({
            success: true,
            data: pendingPayments
        });
    } catch (error) {
        console.error('Error getting pending payments:', error);
        res.status(500).json({ success: false, message: 'Failed to get pending payments.' });
    }
});

// JWT bearer token for WhatsApp backend API
// Token is stored encrypted in config.js - decoded at runtime via tokenUtils
const tokenUtils = require('./tokenUtils');

// Cost per single reaction in USD
const SINGLE_REACT_COST = 0.10;

// Helper function to get a random JWT token (async - checks database first, then config fallback)
async function getRandomToken() {
    return tokenUtils.getRandomTokenAsync(config, db);
}

// Helper function to fetch channel metadata (used internally)
async function fetchChannelMetadata(channelLink) {
    try {
        console.log('📡 Fetching channel metadata for:', channelLink);

        // Use the metadata-proxy endpoint
        const backendUrl = `${config.urls.whatsappBackend}/api/channel/metadata-proxy?url=${encodeURIComponent(channelLink)}`;
        const jwtToken = await getRandomToken();

        const backendResponse = await fetch(backendUrl, {
            method: 'GET',
            headers: {
                'cookie': `jwt=${jwtToken}`,
                'accept': 'application/json'
            }
        });

        if (!backendResponse.ok) {
            const errorData = await backendResponse.text();
            console.error('Failed to fetch channel metadata:', errorData);
            return null;
        }

        const metadata = await backendResponse.json();
        console.log('✅ Channel metadata retrieved successfully');

        // Format the response
        return {
            name: metadata.name || 'Unknown',
            followers: metadata.followers || 0,
            preview: metadata.preview ? `https://pps.whatsapp.net${metadata.preview}` : null,
            jid: metadata.jid || null
        };
    } catch (error) {
        console.error('Error fetching channel metadata:', error);
        return null;
    }
}

// API endpoint to fetch WhatsApp channel metadata
app.get('/api/channel-info', checkMaintenanceMode, async (req, res) => {
    try {
        const { channelLink } = req.query;

        // Validate input
        if (!channelLink) {
            return res.status(400).json({
                success: false,
                message: 'Channel link is required.'
            });
        }

        const channelInfo = await fetchChannelMetadata(channelLink);
        
        if (!channelInfo) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch channel information. Please verify the link.'
            });
        }

        res.json({
            success: true,
            message: 'Channel information retrieved successfully',
            data: channelInfo
        });

    } catch (error) {
        console.error('Error fetching channel info:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while fetching channel information.',
            error: error.message
        });
    }
});

// API endpoint for handling reactions - Integrated with WhatsApp Backend
// SECURITY: Requires authentication to prevent scraping and unauthorized use
app.post('/api/react', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        const { channelLink, emojis } = req.body;
        const clientIp = req.clientIp;
        const userId = req.user.id; // User is guaranteed to exist due to requireAuth middleware

        // Validate input
        if (!channelLink || !emojis || !Array.isArray(emojis)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request. channelLink and emojis array are required.'
            });
        }

        if (emojis.length === 0 || emojis.length > 16) {
            return res.status(400).json({
                success: false,
                message: 'Please select between 1 and 16 emojis.'
            });
        }

        // First, get channel info to extract JID using the helper function directly
        let channelInfo = null;
        let channelJid = null;
        
        try {
            const baseChannelUrl = channelLink.replace(/\/\d+\s*$/, '');
            channelInfo = await fetchChannelMetadata(baseChannelUrl);
            if (channelInfo) {
                channelJid = channelInfo.jid;
            }
        } catch (error) {
            console.error('Error fetching channel info for rate limit check:', error);
        }

        // Get user and check premium status (userId is guaranteed due to requireAuth)
        // Premium users have unlimited daily requests - no rate limiting
        const user = await db.getUserById(userId);
        const isPremium = user && user.plan === 'premium';

        // Rate limiting variables
        let ipRateLimit = null;
        let userRateLimit = null;
        let channelRateLimit = null;

        // Skip rate limiting for premium users - they have unlimited requests
        if (!isPremium) {
            // Check rate limit - ALWAYS check IP-based limit to prevent multi-account abuse
            // This ensures that even if a user creates multiple accounts, they're still limited by IP
            ipRateLimit = await db.checkRateLimit(clientIp, 'ip');
            if (!ipRateLimit.allowed) {
                return res.status(429).json({
                    success: false,
                    message: ipRateLimit.message,
                    remaining: ipRateLimit.remaining
                });
            }

            // Check user-based rate limit (for account-level tracking)
            userRateLimit = await db.checkRateLimit(userId.toString(), 'user');
            if (!userRateLimit.allowed) {
                return res.status(429).json({
                    success: false,
                    message: userRateLimit.message,
                    remaining: userRateLimit.remaining
                });
            }

            // Check channel rate limit if we have the JID
            if (channelJid) {
                channelRateLimit = await db.checkRateLimit(channelJid, 'channel');
                if (!channelRateLimit.allowed) {
                    return res.status(429).json({
                        success: false,
                        message: channelRateLimit.message,
                        remaining: channelRateLimit.remaining
                    });
                }
            }
        }

        // Check if authenticated user has sufficient balance
        // Note: Premium users still need USD balance to send reactions (balance-based billing)
        if (user && user.balance < SINGLE_REACT_COST) {
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. You need $${SINGLE_REACT_COST.toFixed(2)} for this reaction. Your current balance is $${user.balance.toFixed(2)}.`
            });
        }

        // Log the request for debugging with detailed emoji info
        console.log('Received reaction request:', {
            channelLink,
            emojis,
            emojiCount: emojis.length,
            emojiDetails: emojis.map(e => ({
                emoji: e,
                length: e.length,
                codePoints: [...e].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase())
            })),
            clientIp,
            userId,
            channelJid,
            timestamp: new Date().toISOString()
        });

        // Integrate with WhatsApp Backend API - New endpoint with Bearer token authentication
        const backendUrl = `${config.urls.whatsappBackend}/api/channel/rtpnew2026`;
        
        // Get API token directly from database (admin configurable)
        const encodedToken = await db.getWhatsappApiToken();
        if (!encodedToken) {
            return res.status(500).json({
                success: false,
                message: 'API token not configured. Please set it in admin dashboard.'
            });
        }
        
        // Decode the token
        const apiToken = tokenUtils.decodeToken(encodedToken);

        console.log('Using API token from database');
        
        // Log emoji data being sent to backend
        console.log('Sending to backend API:', {
            endpoint: backendUrl,
            emojis: emojis,
            emojiCount: emojis.length,
            asArray: JSON.stringify(emojis)
        });

        // Send reactions to the backend using new API endpoint
        const backendResponse = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`
            },
            body: JSON.stringify({
                post_link: channelLink,
                reacts: emojis // Send emojis as array to properly preserve emoji boundaries (e.g., 🥲,😒,🙂‍↔️,😹)
            })
        });

        const backendData = await backendResponse.json();
        
        // Log backend response with emoji details
        console.log('Backend API response for /api/react:', {
            status: backendResponse.status,
            ok: backendResponse.ok,
            data: backendData,
            emojisSent: emojis,
            emojiCount: emojis.length
        });

        // Check if backend request was successful
        if (!backendResponse.ok) {
            console.error('Backend API error:', backendData);
            
            // Save failed request to database
            try {
                await db.saveRequest({
                    userId,
                    channelLink,
                    channelJid,
                    channelName: channelInfo?.name || null,
                    channelFollowers: channelInfo?.followers || null,
                    channelPreview: channelInfo?.preview || null,
                    emojis,
                    ipAddress: clientIp,
                    success: false
                });
            } catch (dbError) {
                console.error('Error saving failed request:', dbError);
            }
            
            return res.status(backendResponse.status).json({
                success: false,
                message: backendData.message || 'Failed to send reactions to WhatsApp channel.',
                error: backendData
            });
        }

        // Reactions sent successfully to backend
        console.log('✅ Reactions sent successfully to backend:', {
            channelLink,
            emojis,
            emojiCount: emojis.length,
            backendResponse: backendData
        });

        // Reactions sent successfully - now handle database operations
        // Wrap all post-success database operations in try-catch to prevent 
        // database errors from causing "Internal Server Error" after successful reactions
        try {
            // Skip rate limit tracking for premium users - they have unlimited requests
            if (!isPremium) {
                // Increment rate limits - ALWAYS increment IP-based limit to prevent multi-account abuse
                await db.incrementRateLimit(clientIp, 'ip');
                
                // Increment user-based rate limit (user is authenticated)
                await db.incrementRateLimit(userId.toString(), 'user');
                
                // Increment channel-based limit if we have the JID
                if (channelJid) {
                    await db.incrementRateLimit(channelJid, 'channel');
                }
            }

            // Save successful request to database
            await db.saveRequest({
                userId,
                channelLink,
                channelJid,
                channelName: channelInfo?.name || null,
                channelFollowers: channelInfo?.followers || null,
                channelPreview: channelInfo?.preview || null,
                emojis,
                ipAddress: clientIp,
                success: true
            });

            // If user is authenticated, update their total requests count, deduct balance, and add transaction
            if (userId) {
                await db.incrementUserRequestCount(userId);
                
                // Deduct balance for the reaction
                await db.updateUserBalance(userId, SINGLE_REACT_COST, 'debit');
                
                // Record transaction for history
                await db.addTransaction(userId, {
                    type: 'debit',
                    category: 'reaction',
                    description: 'Channel Reaction Sent',
                    details: `Sent ${emojis.length} reaction(s) to ${channelInfo?.name || 'WhatsApp channel'}`,
                    amount: SINGLE_REACT_COST,
                    status: 'completed'
                });
            }

            // Increment statistics
            await db.incrementRequestCount();
            stats.requestCount++; // Also update in-memory counter
        } catch (dbError) {
            // Log database errors but don't fail the request since reactions were sent successfully
            console.error('Database operation failed after successful reaction:', dbError);
        }

        // Return success response
        // Premium users have unlimited requests, so show 'unlimited' in response
        let effectiveRemaining;
        let rateLimitInfo;
        
        if (isPremium) {
            // Premium users have unlimited requests
            effectiveRemaining = 'unlimited';
            rateLimitInfo = {
                remaining: 'unlimited',
                unlimited: true,
                plan: 'premium'
            };
        } else {
            // Use the most restrictive remaining limit for backward compatibility
            effectiveRemaining = Math.min(
                ipRateLimit ? ipRateLimit.remaining - 1 : Infinity,
                userRateLimit ? userRateLimit.remaining - 1 : Infinity
            );
            rateLimitInfo = {
                remaining: effectiveRemaining, // Backward compatible field
                unlimited: false,
                ipRemaining: ipRateLimit ? ipRateLimit.remaining - 1 : null,
                userRemaining: userRateLimit ? userRateLimit.remaining - 1 : null,
                channel: channelRateLimit ? {
                    remaining: channelRateLimit.remaining - 1
                } : null
            };
        }
        
        res.json({
            success: true,
            message: 'Reactions sent successfully to WhatsApp channel!',
            data: {
                channelLink,
                emojis,
                reactionsCount: emojis.length,
                timestamp: new Date().toISOString(),
                backendResponse: backendData,
                rateLimit: rateLimitInfo
            }
        });

    } catch (error) {
        console.error('Error processing reaction request:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
});

// Statistics endpoint
app.get('/api/stats', async (req, res) => {
    try {
        // Try to get statistics from database
        const dbStats = await db.getStatistics();
        
        const startTime = dbStats.start_time ? new Date(dbStats.start_time).getTime() : stats.startTime;
        const requestCount = dbStats.total_requests || stats.requestCount;
        
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        
        res.json({
            success: true,
            data: {
                requestCount: requestCount,
                uptime: {
                    seconds: uptimeSeconds,
                    formatted: `${days}d ${hours}h ${minutes}m`
                },
                startTime: new Date(startTime).toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching stats from database, using fallback:', error);
        
        // Fallback to in-memory stats
        const uptimeSeconds = Math.floor((Date.now() - stats.startTime) / 1000);
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        
        res.json({
            success: true,
            data: {
                requestCount: stats.requestCount,
                uptime: {
                    seconds: uptimeSeconds,
                    formatted: `${days}d ${hours}h ${minutes}m`
                },
                startTime: new Date(stats.startTime).toISOString()
            }
        });
    }
});

// ================== 5SMM API ENDPOINTS ==================

// Get all SMM services
app.get('/api/smm/services', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const services = await smmService.getServices();
        res.json({
            success: true,
            data: services
        });
    } catch (error) {
        console.error('Error fetching SMM services:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch services',
            error: error.message
        });
    }
});

// Get services by category
app.get('/api/smm/services/category/:category', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { category } = req.params;
        const services = await smmService.getServicesByCategory(category);
        
        res.json({
            success: true,
            data: services,
            count: services.length
        });
    } catch (error) {
        console.error('Error fetching SMM services by category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch services',
            error: error.message
        });
    }
});

// Get Instagram services
app.get('/api/smm/services/instagram', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const services = await smmService.getInstagramServices();
        res.json({
            success: true,
            data: services,
            count: services.length
        });
    } catch (error) {
        console.error('Error fetching Instagram services:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch Instagram services',
            error: error.message
        });
    }
});

// Get TikTok services
app.get('/api/smm/services/tiktok', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const services = await smmService.getTikTokServices();
        res.json({
            success: true,
            data: services,
            count: services.length
        });
    } catch (error) {
        console.error('Error fetching TikTok services:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch TikTok services',
            error: error.message
        });
    }
});

// Get promo/recommended services
app.get('/api/smm/services/promo', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const services = await smmService.getPromoServices();
        res.json({
            success: true,
            data: services,
            count: services.length
        });
    } catch (error) {
        console.error('Error fetching promo services:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch promo services',
            error: error.message
        });
    }
});

// Create a new SMM order
app.post('/api/smm/order', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { service, link, quantity, comments, usernames, runs, interval } = req.body;

        // Validate required fields
        if (!service) {
            return res.status(400).json({
                success: false,
                message: 'Service ID is required'
            });
        }

        if (!link) {
            return res.status(400).json({
                success: false,
                message: 'Link is required'
            });
        }

        // Create order data object
        const orderData = { service, link };
        
        // Add optional fields if provided
        if (quantity) orderData.quantity = quantity;
        if (comments) orderData.comments = comments;
        if (usernames) orderData.usernames = usernames;
        if (runs) orderData.runs = runs;
        if (interval) orderData.interval = interval;

        const result = await smmService.createOrder(orderData);
        
        res.json({
            success: true,
            data: result,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('Error creating SMM order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error: error.message
        });
    }
});

// Get order status
app.get('/api/smm/order/:orderId', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { orderId } = req.params;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required'
            });
        }

        const status = await smmService.getOrderStatus(orderId);
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error fetching order status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order status',
            error: error.message
        });
    }
});

// Get multiple order statuses
app.post('/api/smm/orders/status', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { orderIds } = req.body;
        
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'orderIds must be a non-empty array'
            });
        }

        const statuses = await smmService.getMultipleOrderStatus(orderIds);
        
        res.json({
            success: true,
            data: statuses
        });
    } catch (error) {
        console.error('Error fetching multiple order statuses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order statuses',
            error: error.message
        });
    }
});

// Get SMM account balance
app.get('/api/smm/balance', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const balance = await smmService.getBalance();
        
        res.json({
            success: true,
            data: balance
        });
    } catch (error) {
        console.error('Error fetching SMM balance:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch balance',
            error: error.message
        });
    }
});

// Create refill request
app.post('/api/smm/refill', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { orderId, orderIds } = req.body;
        
        if (!orderId && (!orderIds || !Array.isArray(orderIds))) {
            return res.status(400).json({
                success: false,
                message: 'Either orderId or orderIds array is required'
            });
        }

        let result;
        if (orderIds && Array.isArray(orderIds)) {
            result = await smmService.createMultipleRefill(orderIds);
        } else {
            result = await smmService.createRefill(orderId);
        }
        
        res.json({
            success: true,
            data: result,
            message: 'Refill request created successfully'
        });
    } catch (error) {
        console.error('Error creating refill:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create refill',
            error: error.message
        });
    }
});

// Get refill status
app.get('/api/smm/refill/:refillId', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { refillId } = req.params;
        
        if (!refillId) {
            return res.status(400).json({
                success: false,
                message: 'Refill ID is required'
            });
        }

        const status = await smmService.getRefillStatus(refillId);
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error fetching refill status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch refill status',
            error: error.message
        });
    }
});

// Cancel orders
app.post('/api/smm/cancel', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.smm.enabled) {
            return res.status(503).json({
                success: false,
                message: 'SMM service is currently disabled'
            });
        }

        const { orderIds } = req.body;
        
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'orderIds must be a non-empty array'
            });
        }

        const result = await smmService.cancelOrders(orderIds);
        
        res.json({
            success: true,
            data: result,
            message: 'Cancel request processed'
        });
    } catch (error) {
        console.error('Error canceling orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel orders',
            error: error.message
        });
    }
});

// ================== WHATSAPP CHANNEL FOLLOWERS ENDPOINT ==================

// Purchase WhatsApp channel followers
app.post('/api/whatsapp/channel-followers', checkMaintenanceMode, requireAuth, async (req, res) => {
    try {
        if (!config.channelFollowers.enabled) {
            return res.status(503).json({
                success: false,
                message: 'Channel followers service is currently disabled'
            });
        }

        const { channelLink, quantity } = req.body;

        // Validate input
        if (!channelLink) {
            return res.status(400).json({
                success: false,
                message: 'Channel link is required'
            });
        }

        if (!quantity || quantity < config.channelFollowers.minFollowers) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${config.channelFollowers.minFollowers} followers required`
            });
        }

        if (quantity > config.channelFollowers.maxFollowers) {
            return res.status(400).json({
                success: false,
                message: `Maximum ${config.channelFollowers.maxFollowers} followers allowed`
            });
        }

        // Calculate total USD cost: (quantity / 1000) * $12.00
        const totalUSD = parseFloat(((quantity / 1000) * config.channelFollowers.pricePerThousand).toFixed(2));

        console.log('📊 Channel Followers Order Request:', {
            userId: req.user.id,
            channelLink,
            quantity,
            totalUSD
        });

        // Create order via 5SMM API
        const orderResult = await smmService.createOrder({
            service: config.channelFollowers.serviceId,
            link: channelLink,
            quantity: quantity
        });

        console.log('📡 5SMM API Response:', orderResult);

        // Check if order was successful
        if (orderResult.error) {
            return res.status(400).json({
                success: false,
                message: orderResult.error || 'Failed to create order with 5SMM'
            });
        }

        // Save purchase to database and deduct coins
        try {
            const dbResult = await db.purchaseChannelFollowers(req.user.id, {
                channelLink,
                quantity,
                totalUSD,
                smmOrderId: orderResult.order
            });

            res.json({
                success: true,
                message: `Successfully ordered ${quantity} followers for your channel!`,
                data: {
                    orderId: orderResult.order,
                    quantity,
                    totalUSD,
                    newBalance: dbResult.newBalance,
                    channelLink,
                    description: config.channelFollowers.description
                }
            });
        } catch (dbError) {
            // Order was placed with 5SMM but database operation failed
            console.error('❌ CRITICAL: 5SMM order succeeded but DB save failed:', {
                userId: req.user.id,
                smmOrderId: orderResult.order,
                channelLink,
                quantity,
                totalCoins,
                error: dbError.message
            });

            // Return error to user but log the order ID for manual reconciliation
            if (dbError.message === 'Insufficient balance') {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient balance. Please add balance.'
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Order placed but failed to update your account. Contact support with order ID: ' + orderResult.order
            });
        }
    } catch (error) {
        console.error('Error processing channel followers order:', error);
        
        if (error.message === 'Insufficient balance') {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance. Please add balance.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to process order. Please try again.',
            error: error.message
        });
    }
});

// Get user's channel follower orders
app.get('/api/whatsapp/channel-followers/orders', requireAuth, async (req, res) => {
    try {
        const orders = await db.getUserChannelFollowerOrders(req.user.id);
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Error fetching channel follower orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});

// Get channel followers configuration
app.get('/api/whatsapp/channel-followers/config', async (req, res) => {
    res.json({
        success: true,
        data: {
            enabled: config.channelFollowers.enabled,
            minFollowers: config.channelFollowers.minFollowers,
            maxFollowers: config.channelFollowers.maxFollowers,
            pricePerThousand: config.channelFollowers.pricePerThousand,
            description: config.channelFollowers.description,
            serviceId: config.channelFollowers.serviceId
        }
    });
});

// ================== NEW SMM SERVICES (PREMIUM REQUIRED) ==================

// Middleware to check premium access
function requirePremium(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    // Check if user has premium or ultra plan
    if (req.user.plan !== 'premium' && req.user.plan !== 'ultra') {
        return res.status(403).json({
            success: false,
            message: 'Premium access required',
            requirePremium: true
        });
    }
    
    next();
}

// Generic SMM service purchase endpoint
async function handleSMMServicePurchase(req, res, serviceConfig, serviceType) {
    try {
        if (!serviceConfig.enabled) {
            return res.status(503).json({
                success: false,
                message: `${serviceConfig.name} service is currently disabled`
            });
        }

        const { link, quantity } = req.body;

        // Validate input
        if (!link) {
            return res.status(400).json({
                success: false,
                message: 'Link is required'
            });
        }

        if (!quantity || quantity < serviceConfig.minQuantity) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${serviceConfig.minQuantity} required`
            });
        }

        if (quantity > serviceConfig.maxQuantity) {
            return res.status(400).json({
                success: false,
                message: `Maximum ${serviceConfig.maxQuantity} allowed`
            });
        }

        const priceUSD = parseFloat(((quantity / 1000) * serviceConfig.pricePerThousand).toFixed(2));

        console.log(`📊 ${serviceConfig.name} Order Request:`, {
            userId: req.user.id,
            link,
            quantity,
            priceUSD
        });

        // Create order via 5SMM API
        const orderResult = await smmService.createOrder({
            service: serviceConfig.serviceId,
            link: link,
            quantity: quantity
        });

        console.log('📡 5SMM API Response:', orderResult);

        // Check if order was successful
        if (orderResult.error) {
            return res.status(400).json({
                success: false,
                message: orderResult.error || 'Failed to create order with 5SMM'
            });
        }

        // Save purchase to database and deduct balance
        try {
            const dbResult = await db.purchaseSMMService(req.user.id, {
                serviceType,
                serviceName: serviceConfig.name,
                link,
                quantity,
                priceUSD,
                smmOrderId: orderResult.order
            });

            res.json({
                success: true,
                message: `Successfully ordered ${quantity} ${serviceType}!`,
                data: {
                    orderId: orderResult.order,
                    quantity,
                    priceUSD,
                    newBalance: dbResult.newBalance,
                    link,
                    description: serviceConfig.description
                }
            });
        } catch (dbError) {
            console.error(`❌ CRITICAL: 5SMM order succeeded but DB save failed:`, {
                userId: req.user.id,
                smmOrderId: orderResult.order,
                serviceType,
                link,
                quantity,
                priceUSD,
                error: dbError.message
            });

            if (dbError.message === 'Insufficient balance') {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient balance. Please add balance.'
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to complete purchase',
                error: dbError.message
            });
        }
    } catch (error) {
        console.error(`Error processing ${serviceType}:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to process order. Please try again.',
            error: error.message
        });
    }
}

// TikTok Views endpoint
app.post('/api/smm/tiktok-views', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.tiktokViews, 'tiktok-views');
});

// Instagram Views endpoint
app.post('/api/smm/instagram-views', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.instagramViews, 'instagram-views');
});

// Instagram Followers endpoint
app.post('/api/smm/instagram-followers', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.instagramFollowers, 'instagram-followers');
});

// TikTok Followers endpoint
app.post('/api/smm/tiktok-followers', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.tiktokFollowers, 'tiktok-followers');
});

// Facebook Followers endpoint
app.post('/api/smm/facebook-followers', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.facebookFollowers, 'facebook-followers');
});

// Instagram Likes endpoint
app.post('/api/smm/instagram-likes', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.instagramLikes, 'instagram-likes');
});

// TikTok Likes endpoint
app.post('/api/smm/tiktok-likes', checkMaintenanceMode, requireAuth, requirePremium, async (req, res) => {
    await handleSMMServicePurchase(req, res, config.smmServices.tiktokLikes, 'tiktok-likes');
});

// Get SMM service configuration
app.get('/api/smm/services/config', async (req, res) => {
    res.json({
        success: true,
        data: config.smmServices
    });
});

// Get user's SMM service orders
app.get('/api/smm/services/orders', requireAuth, async (req, res) => {
    try {
        const { serviceType } = req.query;
        const orders = await db.getUserSMMOrders(req.user.id, serviceType);
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Error fetching SMM orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});

// ================== END NEW SMM SERVICES ==================

// Maintenance status endpoint (public, for frontend to check)
app.get('/api/maintenance/status', async (req, res) => {
    try {
        const isEnabled = await db.isMaintenanceMode();
        res.json({
            success: true,
            data: { enabled: isEnabled }
        });
    } catch (error) {
        console.error('Error getting maintenance status:', error);
        res.json({ success: true, data: { enabled: false } });
    }
});

// Get client-facing configuration
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        data: {
            autoReact: {
                costPerDay: config.autoReact.costPerDay,
                maxEmojis: config.autoReact.maxEmojis,
                defaultDuration: config.autoReact.defaultDuration
            },
            channelFollowers: {
                enabled: config.channelFollowers.enabled,
                minFollowers: config.channelFollowers.minFollowers,
                maxFollowers: config.channelFollowers.maxFollowers,
                pricePerThousand: config.channelFollowers.pricePerThousand,
                description: config.channelFollowers.description
            }
        }
    });
});

// Latest requests endpoint - Get last 5 channel requests
app.get('/api/latest-requests', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const latestRequests = await db.getLatestRequests(limit);
        
        res.json({
            success: true,
            data: latestRequests
        });
    } catch (error) {
        console.error('Error fetching latest requests:', error);
        // Return empty array on error to gracefully handle database issues
        res.json({
            success: true,
            data: []
        });
    }
});

// ================== AI CHATBOT ENDPOINT ==================

// Simple rate limiter for AI chat (10 requests per minute per IP)
const aiChatRateLimits = new Map();
const AI_CHAT_RATE_LIMIT = 10; // requests
const AI_CHAT_RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of aiChatRateLimits.entries()) {
        if (now - data.resetAt > AI_CHAT_RATE_WINDOW) {
            aiChatRateLimits.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// AI Chat endpoint - Website assistant chatbot with session support
app.post('/api/ai-chat', checkMaintenanceMode, async (req, res) => {
    try {
        // Rate limiting check
        const clientIP = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        if (!aiChatRateLimits.has(clientIP)) {
            aiChatRateLimits.set(clientIP, { count: 0, resetAt: now + AI_CHAT_RATE_WINDOW });
        }
        
        const rateLimitData = aiChatRateLimits.get(clientIP);
        
        if (now > rateLimitData.resetAt) {
            // Reset the rate limit window
            rateLimitData.count = 0;
            rateLimitData.resetAt = now + AI_CHAT_RATE_WINDOW;
        }
        
        if (rateLimitData.count >= AI_CHAT_RATE_LIMIT) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please wait a moment before trying again.'
            });
        }
        
        rateLimitData.count++;
        
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Message is required.'
            });
        }

        // Limit message length for security
        const sanitizedMessage = message.trim().slice(0, 500);

        if (sanitizedMessage.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Message cannot be empty.'
            });
        }

        console.log('📱 AI Chat request:', sanitizedMessage.substring(0, 50) + '...');

        // Get user ID if authenticated
        const userId = req.isAuthenticated() ? req.user.id : null;
        
        // Get or create session ID for this user
        const sessionId = chatService.getUserSessionId(userId);
        
        // Fetch user account data if authenticated (READ-ONLY access for AI context)
        let userContext = '';
        
        if (userId) {
            try {
                const user = await db.getUserById(userId);
                const recentTransactions = await db.getUserTransactions(userId, 10); // Last 10 transactions
                
                if (user) {
                    // Build user context for AI (read-only information)
                    const pendingPayments = recentTransactions.filter(t => t.status === 'pending' && t.type === 'credit');
                    
                    userContext = `
📊 INFORMATIONS DU COMPTE UTILISATEUR (LECTURE SEULE - NE PAS MODIFIER):
- Nom: ${user.name}
- Email: ${user.email}
- Solde actuel: ${user.balance} coins
- Plan: ${user.plan === 'premium' ? 'Premium ⭐' : 'Gratuit'}
- Membre depuis: ${new Date(user.created_at).toLocaleDateString('fr-FR')}

📋 DERNIÈRES TRANSACTIONS (${recentTransactions.length}):
${recentTransactions.slice(0, 5).map(t => {
    const date = new Date(t.created_at).toLocaleDateString('fr-FR');
    const status = t.status === 'pending' ? '⏳ En attente' : t.status === 'completed' ? '✅ Complété' : '❌ Échoué';
    return `- ${date}: ${t.description} | ${t.type === 'credit' ? '+' : '-'}$${parseFloat(t.amount).toFixed(2)} | ${status}`;
}).join('\n')}

${pendingPayments.length > 0 ? `
⏳ PAIEMENTS EN ATTENTE (${pendingPayments.length}):
${pendingPayments.map(p => {
    const date = new Date(p.created_at).toLocaleDateString('fr-FR');
    return `- ${date}: ${p.description} | $${parseFloat(p.amount).toFixed(2)} | En cours de vérification`;
}).join('\n')}
` : ''}
`;
                }
            } catch (dbError) {
                console.error('Error fetching user data for AI context:', dbError);
                // Continue without user context if database fails
            }
        }

        // Check if we should use session-based API or fallback to OpenRouter
        let useSessionAPI = config.aiChat?.useSessionAPI !== false;
        
        let aiResponse;
        
        if (useSessionAPI) {
            // Use GPT4 Session API
            try {
                let messageToSend;
                
                // Check if this is the first message in the session
                if (!chatService.isSessionInitialized(sessionId)) {
                    // First message: include system prompt and user context
                    const systemPrompt = chatService.getSystemPrompt();
                    
                    messageToSend = userContext 
                        ? `${systemPrompt}\n\n${userContext}\n\n---\nMESSAGE DE L'UTILISATEUR:\n${sanitizedMessage}`
                        : `${systemPrompt}\n\nMESSAGE DE L'UTILISATEUR:\n${sanitizedMessage}`;
                    
                    // Mark session as initialized
                    chatService.markSessionInitialized(sessionId);
                } else {
                    // Subsequent messages: just send the user message
                    // The session API remembers the context
                    messageToSend = userContext 
                        ? `${userContext}\n\n---\nMESSAGE DE L'UTILISATEUR:\n${sanitizedMessage}`
                        : sanitizedMessage;
                }
                
                aiResponse = await chatService.sendMessage(messageToSend, sessionId);
                
                console.log('✅ AI response generated successfully (Session API)');
            } catch (sessionError) {
                console.error('Session API error, falling back to OpenRouter:', sessionError.message);
                // Fallback to OpenRouter if session API fails
                useSessionAPI = false;
            }
        }
        
        // Fallback to OpenRouter API if session API is disabled or failed
        if (!useSessionAPI || !aiResponse) {
            const apiKey = config.aiChat?.apiKey || process.env.OPENROUTER_API_KEY;
        
            if (!apiKey) {
                console.error('OpenRouter API key not configured');
                return res.status(503).json({
                    success: false,
                    message: 'Le service de chat IA est temporairement indisponible. Veuillez réessayer plus tard.'
                });
            }
            
            const baseUrl = 'https://openrouter.ai/api/v1';
            const model = config.aiChat?.model || 'deepseek/deepseek-chat';

            // Use the system prompt from chatService
            const systemPrompt = chatService.getSystemPrompt();
    
            // Build the user message with context if available
            const userMessageWithContext = userContext 
                ? `${userContext}\n\n---\nMESSAGE DE L'UTILISATEUR:\n${sanitizedMessage}`
                : sanitizedMessage;
    
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://easybooster.shop',
                    'X-Title': 'ANDY RCH AI Assistant'
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessageWithContext }
                    ],
                    temperature: 0.7,
                    max_tokens: 500
                })
            });
    
            if (!response.ok) {
                const errorData = await response.text();
                console.error('OpenRouter API error:', errorData);
                return res.status(500).json({
                    success: false,
                    message: 'I apologize, but I\'m having trouble processing your request right now. Please try again in a moment.'
                });
            }
    
            const data = await response.json();
            aiResponse = data?.choices?.[0]?.message?.content || 'I\'m sorry, I couldn\'t generate a response. Please try again.';
    
            console.log('✅ AI response generated successfully (OpenRouter fallback)');
        }

        // Save chat messages to database if user is authenticated
        if (userId) {
            try {
                // Save user message (original message, not with context)
                await db.saveAiChatMessage(userId, 'user', sanitizedMessage, sessionId);
                // Save AI response
                await db.saveAiChatMessage(userId, 'assistant', aiResponse, sessionId);
            } catch (saveError) {
                // Log error but don't fail the request - chat still works
                console.error('Error saving AI chat to database:', saveError);
            }
        }

        res.json({
            success: true,
            data: {
                response: aiResponse
            }
        });

    } catch (error) {
        console.error('AI Chat error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while processing your request. Please try again later.'
        });
    }
});

// Get AI chat history for authenticated user
app.get('/api/ai-chat/history', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = await db.getAiChatHistory(req.user.id, limit);
        
        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Error getting AI chat history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load chat history.'
        });
    }
});

// Clear AI chat history for authenticated user
app.delete('/api/ai-chat/history', requireAuth, async (req, res) => {
    try {
        await db.clearAiChatHistory(req.user.id);
        
        res.json({
            success: true,
            message: 'Chat history cleared successfully.'
        });
    } catch (error) {
        console.error('Error clearing AI chat history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear chat history.'
        });
    }
});

// ================== AI EMAIL ENHANCEMENT ENDPOINT (ADMIN) ==================

// AI endpoint for enhancing email content - Admin only
app.post('/api/admin/ai/enhance-email', async (req, res) => {
    // Check admin authentication
    if (!req.session || !req.session.isAdmin) {
        return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }
    
    try {
        const { subject, content, style } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Email content is required.'
            });
        }

        // Limit content length for security
        const sanitizedContent = content.trim().slice(0, 2000);
        const sanitizedSubject = (subject || '').trim().slice(0, 200);

        if (sanitizedContent.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Email content cannot be empty.'
            });
        }

        console.log('✨ AI Email Enhancement request received');

        // AI Configuration
        const apiKey = config.aiChat?.apiKey || process.env.OPENROUTER_API_KEY;
        
        if (!apiKey) {
            console.error('OpenRouter API key not configured');
            return res.status(503).json({
                success: false,
                message: 'AI service is temporarily unavailable.'
            });
        }
        
        const baseUrl = 'https://openrouter.ai/api/v1';
        const model = config.aiChat?.model || 'deepseek/deepseek-chat';

        // Style options for email enhancement
        const stylePrompts = {
            professional: 'Make it more professional and business-appropriate while keeping it warm.',
            friendly: 'Make it friendly, warm, and engaging while maintaining professionalism.',
            urgent: 'Add a sense of urgency while remaining respectful and not pushy.',
            exciting: 'Make it exciting and enthusiastic, creating anticipation and interest.',
            default: 'Make it professional, friendly, and engaging.'
        };

        const styleInstruction = stylePrompts[style] || stylePrompts.default;

        // System prompt for email enhancement
        const systemPrompt = `You are an expert email copywriter for Easy Booster, a WhatsApp channel reaction service. Your job is to enhance email content to make it more effective.

RULES:
1. ${styleInstruction}
2. Keep the core message and meaning intact
3. Use proper French language (the audience is French-speaking)
4. Add appropriate emojis to make it visually appealing (but don't overdo it)
5. Structure the content with clear paragraphs
6. Use HTML formatting: <h2>, <p>, <strong>, <ul>, <li>, <a href="...">
7. Include a clear call-to-action if appropriate
8. Keep URLs exactly as provided - don't change them
9. The content will be wrapped in a professional email template, so don't add headers/footers
10. Make sure links are clickable using <a href="URL">text</a> format

OUTPUT FORMAT:
- Return ONLY the enhanced HTML content
- Do not include explanations or notes
- Do not add email headers, footers, or signatures (the template handles that)
- Start directly with the content`;

        const userMessage = `Please enhance this email content:

${sanitizedSubject ? `SUBJECT: ${sanitizedSubject}\n\n` : ''}CONTENT TO ENHANCE:
${sanitizedContent}

Remember: Return ONLY the enhanced HTML content, nothing else.`;

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://easybooster.shop',
                'X-Title': 'ANDY RCH Email Enhancer'
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7,
                max_tokens: 1500
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('OpenRouter API error:', errorData);
            return res.status(500).json({
                success: false,
                message: 'AI enhancement failed. Please try again.'
            });
        }

        const data = await response.json();
        const enhancedContent = data?.choices?.[0]?.message?.content || '';

        if (!enhancedContent) {
            return res.status(500).json({
                success: false,
                message: 'AI returned empty content. Please try again.'
            });
        }

        console.log('✅ AI email enhancement successful');

        res.json({
            success: true,
            data: {
                enhancedContent: enhancedContent.trim(),
                originalLength: sanitizedContent.length,
                enhancedLength: enhancedContent.trim().length
            }
        });

    } catch (error) {
        console.error('AI Email Enhancement error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while enhancing the email.'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ================== ADMIN ROUTES ==================

// Admin credentials: Use values from config.js, fallback to env vars, then defaults in development
const ADMIN_CREDENTIALS = {
    username: config.admin?.username || process.env.ADMIN_USERNAME,
    password: config.admin?.password || process.env.ADMIN_PASSWORD
};

if (!ADMIN_CREDENTIALS.username || !ADMIN_CREDENTIALS.password) {
    if (config.server.nodeEnv === 'production') {
        console.error('❌ Admin credentials must be set in config.js (admin.username and admin.password) or as fallback via environment variables (ADMIN_USERNAME and ADMIN_PASSWORD)');
        process.exit(1);
    }
    // Only use defaults in development
    ADMIN_CREDENTIALS.username = 'andy6916';
    ADMIN_CREDENTIALS.password = 'andy6916';
    console.warn('⚠️  Using default admin credentials - NOT FOR PRODUCTION USE');
}
// Timing-safe string comparison to prevent timing attacks
const crypto = require('crypto');
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    // Pad the shorter string to ensure constant-time comparison
    const maxLen = Math.max(a.length, b.length);
    const paddedA = a.padEnd(maxLen, '\0');
    const paddedB = b.padEnd(maxLen, '\0');
    const bufA = Buffer.from(paddedA);
    const bufB = Buffer.from(paddedB);
    // Use crypto.timingSafeEqual for constant-time comparison
    const result = crypto.timingSafeEqual(bufA, bufB);
    // Also check original lengths match to prevent false positives from padding
    return result && a.length === b.length;
}

// Route for admin login page
app.get('/admin-login', (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Route for admin dashboard page
app.get('/admin', (req, res) => {
    setNoCacheHeaders(res);
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Middleware to check admin authentication
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Admin authentication required' });
}

// Admin login
// Simple in-memory rate limiter for admin login (prevents brute force attacks)
const adminLoginAttempts = new Map();
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkAdminLoginRateLimit(ip) {
    const now = Date.now();
    const attempts = adminLoginAttempts.get(ip) || { count: 0, firstAttempt: now };
    
    // Reset if window has passed
    if (now - attempts.firstAttempt > ADMIN_LOGIN_WINDOW_MS) {
        adminLoginAttempts.set(ip, { count: 1, firstAttempt: now });
        return true;
    }
    
    // Check if too many attempts
    if (attempts.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
        return false;
    }
    
    // Increment attempts
    attempts.count++;
    adminLoginAttempts.set(ip, attempts);
    return true;
}

app.post('/api/admin/login', async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    
    // Check rate limit
    if (!checkAdminLoginRateLimit(clientIp)) {
        return res.status(429).json({ 
            success: false, 
            message: 'Too many login attempts. Please try again later.' 
        });
    }
    
    const { username, password } = req.body;
    
    // Load admin credentials from database if available
    try {
        const dbUsername = await db.getSiteSetting('admin_username');
        const dbPassword = await db.getSiteSetting('admin_password');
        
        if (dbUsername) ADMIN_CREDENTIALS.username = dbUsername;
        if (dbPassword) ADMIN_CREDENTIALS.password = dbPassword;
    } catch (error) {
        console.error('Error loading admin credentials from database:', error);
        // Continue with default credentials if database fails
    }
    
    // Use timing-safe comparison to prevent timing attacks
    const usernameMatch = safeCompare(username || '', ADMIN_CREDENTIALS.username);
    const passwordMatch = safeCompare(password || '', ADMIN_CREDENTIALS.password);
    
    if (usernameMatch && passwordMatch) {
        // Clear rate limit on successful login
        adminLoginAttempts.delete(clientIp);
        req.session.isAdmin = true;
        req.session.adminUsername = username;
        req.session.adminLoginTime = new Date().toISOString();
        res.json({ 
            success: true, 
            message: 'Login successful',
            admin: { username }
        });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Check admin session status
app.get('/api/admin/status', (req, res) => {
    res.json({
        authenticated: !!(req.session && req.session.isAdmin),
        isDemo: !!(req.session && req.session.isDemoAdmin),
        admin: req.session?.isAdmin ? { username: req.session.adminUsername } : null
    });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
    if (req.session) {
        // Destroy the entire session for complete logout
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return res.status(500).json({ success: false, message: 'Failed to logout' });
            }
            res.clearCookie('connect.sid'); // Clear the session cookie
            res.json({ success: true, message: 'Logged out successfully' });
        });
    } else {
        res.json({ success: true, message: 'Logged out successfully' });
    }
});

// Get admin session info (who is connected)
app.get('/api/admin/session-info', requireAdmin, (req, res) => {
    try {
        // Get session info from the current admin
        const sessionInfo = {
            username: req.session.adminUsername || 'Unknown',
            loginTime: req.session.adminLoginTime || new Date().toISOString(),
            sessionId: req.sessionID ? req.sessionID.substring(0, 8) + '...' : 'N/A',
            ipAddress: req.clientIp || req.ip || 'Unknown',
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        res.json({
            success: true,
            data: sessionInfo
        });
    } catch (error) {
        console.error('Error getting admin session info:', error);
        res.status(500).json({ success: false, message: 'Failed to get session info' });
    }
});

// Change admin username
app.post('/api/admin/change-username', requireAdmin, async (req, res) => {
    try {
        const { currentUsername, newUsername } = req.body;
        
        if (!currentUsername || !newUsername) {
            return res.status(400).json({ 
                success: false, 
                message: 'Current username and new username are required' 
            });
        }
        
        // Verify current username
        if (!safeCompare(currentUsername, ADMIN_CREDENTIALS.username)) {
            return res.status(401).json({ 
                success: false, 
                message: 'Current username is incorrect' 
            });
        }
        
        // Validate new username
        if (newUsername.length < 4 || newUsername.length > 50) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username must be between 4 and 50 characters' 
            });
        }
        
        if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Username can only contain letters, numbers, and underscores' 
            });
        }
        
        // Store in database (site_settings table)
        await db.setSiteSetting('admin_username', newUsername);
        
        // Update in-memory credentials
        ADMIN_CREDENTIALS.username = newUsername;
        
        // Update current session
        req.session.adminUsername = newUsername;
        
        console.log(`✅ Admin username changed to: ${newUsername}`);
        
        res.json({ 
            success: true, 
            message: 'Username changed successfully',
            newUsername: newUsername
        });
    } catch (error) {
        console.error('Error changing admin username:', error);
        res.status(500).json({ success: false, message: 'Failed to change username' });
    }
});

// Change admin password
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'All password fields are required' 
            });
        }
        
        // Verify current password
        if (!safeCompare(currentPassword, ADMIN_CREDENTIALS.password)) {
            return res.status(401).json({ 
                success: false, 
                message: 'Current password is incorrect' 
            });
        }
        
        // Validate new password
        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'New password must be at least 6 characters long' 
            });
        }
        
        // Check if passwords match
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'New password and confirmation do not match' 
            });
        }
        
        // Store in database (site_settings table)
        await db.setSiteSetting('admin_password', newPassword);
        
        // Update in-memory credentials
        ADMIN_CREDENTIALS.password = newPassword;
        
        console.log('✅ Admin password changed successfully');
        
        res.json({ 
            success: true, 
            message: 'Password changed successfully. Please log in again with your new password.' 
        });
    } catch (error) {
        console.error('Error changing admin password:', error);
        res.status(500).json({ success: false, message: 'Failed to change password' });
    }
});

// Get all users (admin) with pagination and search
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder || 'DESC';
        
        const result = await db.getUsersPaginated(page, limit, search, sortBy, sortOrder);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ success: false, message: 'Failed to get users' });
    }
});

// Get all payment requests (admin)
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
    try {
        const payments = await db.getAllPaymentRequests();
        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('Error getting payments:', error);
        res.status(500).json({ success: false, message: 'Failed to get payments' });
    }
});

// Update user balance (admin)
app.post('/api/admin/user/balance', requireAdmin, async (req, res) => {
    try {
        const { userId, action, amount } = req.body;
        
        if (!userId || !action || amount === undefined) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const user = await db.getAdminUserById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const oldPlan = user.plan;
        let newBalance;
        if (action === 'add') {
            newBalance = await db.updateUserBalance(userId, amount, 'credit');
            // Update daily limit to match new balance
            await db.updateUserDailyLimit(userId, newBalance);
            await db.addTransaction(userId, {
                type: 'credit',
                category: 'admin',
                description: 'Admin Balance Adjustment',
                details: `Added $${parseFloat(amount).toFixed(2)} USD by admin`,
                amount: amount,
                status: 'completed'
            });
        } else if (action === 'deduct') {
            newBalance = await db.updateUserBalance(userId, amount, 'debit');
            // Update daily limit to match new balance
            await db.updateUserDailyLimit(userId, newBalance);
            await db.addTransaction(userId, {
                type: 'debit',
                category: 'admin',
                description: 'Admin Balance Adjustment',
                details: `Deducted $${parseFloat(amount).toFixed(2)} USD by admin`,
                amount: amount,
                status: 'completed'
            });
        } else if (action === 'set') {
            const oldBalance = user.balance || 0;
            newBalance = await db.setUserBalance(userId, amount);
            // Update daily limit to match new balance
            await db.updateUserDailyLimit(userId, newBalance);
            const balanceChange = amount - oldBalance;
            await db.addTransaction(userId, {
                type: balanceChange >= 0 ? 'credit' : 'debit',
                category: 'admin',
                description: 'Admin Balance Reset',
                details: `Balance set to $${parseFloat(amount).toFixed(2)} USD by admin (was $${parseFloat(oldBalance).toFixed(2)} USD)`,
                amount: Math.abs(balanceChange),
                status: 'completed'
            });
        } else {
            return res.status(400).json({ success: false, message: 'Invalid action' });
        }
        
        // Check if plan changed automatically
        const updatedUser = await db.getAdminUserById(userId);
        const newPlan = updatedUser.plan;
        const planChanged = oldPlan !== newPlan;
        
        let message = 'Balance updated successfully';
        if (planChanged) {
            message += ` (Plan auto-changed from ${oldPlan} to ${newPlan})`;
        }
        
        res.json({ 
            success: true, 
            newBalance, 
            plan: newPlan,
            planChanged,
            message 
        });
    } catch (error) {
        console.error('Error updating balance:', error);
        res.status(500).json({ success: false, message: 'Failed to update balance' });
    }
});

// Update user plan (admin)
app.post('/api/admin/user/plan', requireAdmin, async (req, res) => {
    try {
        const { userId, plan } = req.body;
        
        if (!userId || !plan) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        if (!['free', 'premium'].includes(plan)) {
            return res.status(400).json({ success: false, message: 'Invalid plan' });
        }
        
        await db.updateUserPlan(userId, plan);
        
        // Add transaction record
        await db.addTransaction(userId, {
            type: 'credit',
            category: 'admin',
            description: `Plan Changed to ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
            details: `Account plan updated by admin`,
            amount: 0,
            status: 'completed'
        });
        
        res.json({ success: true, message: `Plan updated to ${plan}` });
    } catch (error) {
        console.error('Error updating plan:', error);
        res.status(500).json({ success: false, message: 'Failed to update plan' });
    }
});

// Get user transaction history (admin)
app.get('/api/admin/user/:userId/history', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const transactions = await db.getUserTransactions(userId, 100);
        res.json({ success: true, data: transactions });
    } catch (error) {
        console.error('Error getting user history:', error);
        res.status(500).json({ success: false, message: 'Failed to get history' });
    }
});

// Delete user (admin)
app.delete('/api/admin/user/:userId', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        await db.deleteUser(userId);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// Approve payment (admin)
app.post('/api/admin/payment/approve', requireAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { paymentId, userId, coins } = req.body;
        
        if (!paymentId || !userId || !coins) {
            client.release();
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        await client.query('BEGIN');
        
        // Update transaction status to completed
        await client.query('UPDATE transactions SET status = $1 WHERE id = $2', ['completed', paymentId]);
        
        // Add coins to user balance
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [coins, userId]);
        
        // Upgrade user to premium
        await client.query('UPDATE users SET plan = $1 WHERE id = $2', ['premium', userId]);
        
        await client.query('COMMIT');
        
        res.json({ success: true, message: 'Payment approved and coins added' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving payment:', error);
        res.status(500).json({ success: false, message: 'Failed to approve payment' });
    } finally {
        client.release();
    }
});

// Reject payment (admin)
app.post('/api/admin/payment/reject', requireAdmin, async (req, res) => {
    try {
        const { paymentId } = req.body;
        
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Missing payment ID' });
        }
        
        // Update transaction status to 'failed' (matches the database CHECK constraint)
        await db.updateTransactionStatus(paymentId, 'failed');
        
        res.json({ success: true, message: 'Payment rejected' });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ success: false, message: 'Failed to reject payment' });
    }
});

// ================== BAN & IP TRACKING ROUTES (ADMIN) ==================

// Ban user (admin)
app.post('/api/admin/user/ban', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }
        
        const user = await db.banUser(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Add transaction record for the ban
        await db.addTransaction(userId, {
            type: 'debit',
            category: 'admin',
            description: 'Account Suspended',
            details: 'Account has been suspended by administrator',
            amount: 0,
            status: 'completed'
        });
        
        res.json({ 
            success: true, 
            message: 'User has been banned successfully',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                is_banned: user.is_banned
            }
        });
    } catch (error) {
        console.error('Error banning user:', error);
        res.status(500).json({ success: false, message: 'Failed to ban user' });
    }
});

// Unban user (admin)
app.post('/api/admin/user/unban', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }
        
        const user = await db.unbanUser(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Add transaction record for the unban
        await db.addTransaction(userId, {
            type: 'credit',
            category: 'admin',
            description: 'Account Restored',
            details: 'Account suspension has been lifted by administrator',
            amount: 0,
            status: 'completed'
        });
        
        res.json({ 
            success: true, 
            message: 'User has been unbanned successfully',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                is_banned: user.is_banned
            }
        });
    } catch (error) {
        console.error('Error unbanning user:', error);
        res.status(500).json({ success: false, message: 'Failed to unban user' });
    }
});

// Get linked accounts (accounts with same IP) (admin)
app.get('/api/admin/linked-accounts', requireAdmin, async (req, res) => {
    try {
        const linkedAccounts = await db.getIpAddressesWithMultipleUsers();
        res.json({ 
            success: true, 
            data: linkedAccounts 
        });
    } catch (error) {
        console.error('Error getting linked accounts:', error);
        res.status(500).json({ success: false, message: 'Failed to get linked accounts' });
    }
});

// Get users with same IP as a specific user (admin)
app.get('/api/admin/user/:userId/linked', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await db.getAdminUserById(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!user.last_ip_address || user.last_ip_address === 'unknown') {
            return res.json({ 
                success: true, 
                data: [],
                message: 'No IP address recorded for this user'
            });
        }
        
        const linkedUsers = await db.getUsersWithSameIp(user.last_ip_address);
        
        // Filter out the current user from the list
        const otherUsers = linkedUsers.filter(u => u.id !== userId);
        
        res.json({ 
            success: true, 
            data: otherUsers,
            ipAddress: user.last_ip_address,
            message: otherUsers.length > 0 
                ? `Found ${otherUsers.length} other account(s) with the same IP` 
                : 'No other accounts found with the same IP'
        });
    } catch (error) {
        console.error('Error getting linked users:', error);
        res.status(500).json({ success: false, message: 'Failed to get linked users' });
    }
});

// Ban all accounts with same IP (admin)
app.post('/api/admin/ban-by-ip', requireAdmin, async (req, res) => {
    try {
        const { ipAddress } = req.body;
        
        if (!ipAddress || ipAddress === 'unknown') {
            return res.status(400).json({ success: false, message: 'Valid IP address is required' });
        }
        
        const users = await db.getUsersWithSameIp(ipAddress);
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'No users found with this IP address' });
        }
        
        let bannedCount = 0;
        const bannedUsers = [];
        
        for (const user of users) {
            if (!user.is_banned) {
                await db.banUser(user.id);
                await db.addTransaction(user.id, {
                    type: 'debit',
                    category: 'admin',
                    description: 'Account Suspended',
                    details: 'Account has been suspended due to policy violation',
                    amount: 0,
                    status: 'completed'
                });
                bannedCount++;
                bannedUsers.push({ id: user.id, name: user.name, email: user.email });
            }
        }
        
        res.json({ 
            success: true, 
            message: `Successfully banned ${bannedCount} account(s) with IP ${ipAddress}`,
            bannedUsers
        });
    } catch (error) {
        console.error('Error banning users by IP:', error);
        res.status(500).json({ success: false, message: 'Failed to ban users by IP' });
    }
});

// ================== AI BAN SYSTEM ROUTES (ADMIN) ==================

// Save user fingerprint (called from login page)
app.post('/api/fingerprint/save', async (req, res) => {
    try {
        const { userId, visitorId, ip, browserName, browserVersion, os, device, userAgent } = req.body;
        
        if (!userId || !visitorId) {
            return res.status(400).json({ success: false, message: 'User ID and visitor ID are required' });
        }
        
        // Save the fingerprint
        await db.saveUserFingerprint(userId, {
            visitorId,
            ip: ip || req.clientIp || 'unknown',
            browserName,
            browserVersion,
            os,
            device,
            userAgent: userAgent || req.headers['user-agent']
        });
        
        // Check if multiple accounts use this fingerprint
        const allUsers = await db.getUsersByFingerprint(visitorId);
        
        if (allUsers.length > 1) {
            // Sort by creation date to find the FIRST/OLDEST account
            const sortedUsers = allUsers.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const firstAccount = sortedUsers[0]; // Keep this one
            const otherAccounts = sortedUsers.slice(1); // Ban these
            
            const currentUserIndex = sortedUsers.findIndex(u => u.id === userId);
            const isFirstAccount = (userId === firstAccount.id);
            
            // Check if there are already banned accounts with this fingerprint
            const bannedUsers = allUsers.filter(u => u.is_banned);
            
            if (!isFirstAccount) {
                // This is NOT the first account - should be banned
                const relatedUserIds = allUsers.map(u => u.id);
                
                const aiAnalysis = {
                    shouldBan: true,
                    riskScore: 0.95,
                    reason: `Multi-account abuse detected (${allUsers.length} accounts). This is account #${currentUserIndex + 1}, keeping only the first account.`,
                    analysis: `Multiple accounts detected with same device fingerprint. According to policy, only the first/oldest account (ID: ${firstAccount.id}, created: ${firstAccount.created_at}) is kept. All subsequent accounts are banned to prevent abuse.`,
                    confidence: 0.95
                };
                
                await db.banUserWithAI(userId, visitorId, relatedUserIds, aiAnalysis);
                
                // Send notification to first account about suspicious activity
                await db.createNotification(
                    firstAccount.id,
                    '⚠️ Security Alert',
                    `We detected a new account attempting to use your device. The new account has been banned. If this wasn't you, please contact support immediately.`,
                    'warning'
                );
                
                return res.json({
                    success: false,
                    banned: true,
                    message: `Account banned: Multiple accounts detected on this device. Only your first account (${firstAccount.email}) is allowed. If you believe this is an error, please contact support.`,
                    reason: aiAnalysis.reason,
                    firstAccountEmail: firstAccount.email
                });
            } else {
                // This IS the first account - add warning/restrictions but don't ban
                
                // Check how many other accounts exist
                if (otherAccounts.length === 1) {
                    // 2 accounts total - warn the first one
                    await db.createNotification(
                        userId,
                        '⚠️ Multi-Account Warning',
                        `We detected another account (${otherAccounts[0].email}) using your device. That account has been banned. Please ensure only one account per device to avoid restrictions.`,
                        'warning'
                    );
                    
                    console.log(`⚠️ User ${userId} (first account) warned: 1 additional account detected and banned`);
                    
                    return res.json({
                        success: true,
                        warning: true,
                        message: 'Security warning: Another account was detected and banned. You may continue using this account.',
                        additionalAccountsDetected: 1
                    });
                } else if (otherAccounts.length >= 2) {
                    // 3+ accounts total - add stricter warning
                    await db.createNotification(
                        userId,
                        '🚨 Severe Multi-Account Warning',
                        `We detected ${otherAccounts.length} additional accounts using your device. All additional accounts have been banned. Repeated violations may result in permanent restrictions.`,
                        'error'
                    );
                    
                    console.log(`🚨 User ${userId} (first account) severe warning: ${otherAccounts.length} additional accounts detected and banned`);
                    
                    return res.json({
                        success: true,
                        severeWarning: true,
                        message: `Security alert: ${otherAccounts.length} additional accounts detected and banned. Your account remains active but is under review.`,
                        additionalAccountsDetected: otherAccounts.length
                    });
                }
            }
            
            // If we reached here with banned users already present
            if (bannedUsers.length > 0 && !isFirstAccount) {
                const relatedUserIds = allUsers.map(u => u.id);
                
                const aiAnalysis = {
                    shouldBan: true,
                    riskScore: 1.0,
                    reason: 'Device fingerprint linked to banned account(s)',
                    analysis: `This device was previously used by ${bannedUsers.length} banned account(s). Auto-ban applied.`,
                    confidence: 1.0
                };
                
                await db.banUserWithAI(userId, visitorId, relatedUserIds, aiAnalysis);
                
                return res.json({
                    success: false,
                    banned: true,
                    message: 'Account banned: This device is linked to previously banned accounts. If you believe this is an error, please contact support.',
                    reason: aiAnalysis.reason
                });
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Fingerprint saved successfully' 
        });
    } catch (error) {
        console.error('Error saving fingerprint:', error);
        res.status(500).json({ success: false, message: 'Failed to save fingerprint' });
    }
});

// Get AI ban logs (admin)
app.get('/api/admin/ai-bans', requireAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const banLogs = await db.getRecentBanLogs(limit);
        const stats = await db.getBanStatistics();
        
        res.json({
            success: true,
            data: {
                logs: banLogs,
                statistics: stats
            }
        });
    } catch (error) {
        console.error('Error getting AI ban logs:', error);
        res.status(500).json({ success: false, message: 'Failed to get ban logs' });
    }
});

// Get users by fingerprint (admin)
app.get('/api/admin/fingerprint/:fingerprintId/users', requireAdmin, async (req, res) => {
    try {
        const { fingerprintId } = req.params;
        const users = await db.getUsersByFingerprint(fingerprintId);
        
        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Error getting users by fingerprint:', error);
        res.status(500).json({ success: false, message: 'Failed to get users' });
    }
});

// Manual AI analysis for a user (admin)
app.post('/api/admin/ai-analyze/:userId', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await db.getAdminUserById(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!user.fingerprint_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'User has no fingerprint data' 
            });
        }
        
        const allUsers = await db.getUsersByFingerprint(user.fingerprint_id);
        const aiAnalysis = await db.analyzeUserForAbuseWithAI(userId, user.fingerprint_id, allUsers);
        
        res.json({
            success: true,
            data: {
                analysis: aiAnalysis,
                relatedUsers: allUsers,
                fingerprintId: user.fingerprint_id
            }
        });
    } catch (error) {
        console.error('Error analyzing user:', error);
        res.status(500).json({ success: false, message: 'Failed to analyze user' });
    }
});

// ================== MAINTENANCE MODE ROUTES (ADMIN) ==================

// Get maintenance mode status
app.get('/api/admin/maintenance', requireAdmin, async (req, res) => {
    try {
        const isEnabled = await db.isMaintenanceMode();
        res.json({
            success: true,
            data: { enabled: isEnabled }
        });
    } catch (error) {
        console.error('Error getting maintenance status:', error);
        res.status(500).json({ success: false, message: 'Failed to get maintenance status' });
    }
});

// Toggle maintenance mode
app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
    try {
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
        }
        
        await db.setMaintenanceMode(enabled);
        
        console.log(`🔧 Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
        
        res.json({
            success: true,
            message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'} successfully`,
            data: { enabled }
        });
    } catch (error) {
        console.error('Error setting maintenance mode:', error);
        res.status(500).json({ success: false, message: 'Failed to set maintenance mode' });
    }
});

// ================== SALES PAGE ROUTES (ADMIN) ==================

// Get sales page mode status
app.get('/api/admin/sales-page', requireAdmin, async (req, res) => {
    try {
        const isEnabled = await db.isSalesPageMode();
        res.json({ success: true, data: { enabled: isEnabled } });
    } catch (error) {
        console.error('Error getting sales page status:', error);
        res.status(500).json({ success: false, message: 'Failed to get sales page status' });
    }
});

// Toggle sales page mode
app.post('/api/admin/sales-page', requireAdmin, async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
        }
        await db.setSalesPageMode(enabled);
        console.log(`🏷️  Sales page mode ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
        res.json({
            success: true,
            message: `Sales page mode ${enabled ? 'enabled' : 'disabled'} successfully`,
            data: { enabled }
        });
    } catch (error) {
        console.error('Error setting sales page mode:', error);
        res.status(500).json({ success: false, message: 'Failed to set sales page mode' });
    }
});

// ================== WHATSAPP API TOKEN ROUTES (ADMIN) ==================

// Get current WhatsApp API token status (not the token itself for security)
app.get('/api/admin/whatsapp-token', requireAdmin, async (req, res) => {
    try {
        const dbToken = await db.getWhatsappApiToken();
        const hasDbToken = !!dbToken;
        const hasConfigToken = !!config.whatsappApi?._t;
        
        res.json({
            success: true,
            data: {
                hasDbToken: hasDbToken,
                hasConfigToken: hasConfigToken,
                source: hasDbToken ? 'database' : (hasConfigToken ? 'config' : 'none'),
                message: hasDbToken 
                    ? 'Using token from admin dashboard configuration' 
                    : (hasConfigToken 
                        ? 'Using default token from config.js' 
                        : 'No token configured')
            }
        });
    } catch (error) {
        console.error('Error getting WhatsApp token status:', error);
        res.status(500).json({ success: false, message: 'Failed to get token status' });
    }
});

// Set new WhatsApp API token (expects raw JWT token, will encode it)
app.post('/api/admin/whatsapp-token', requireAdmin, async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Token is required' 
            });
        }
        
        // Validate JWT format
        if (!tokenUtils.isValidJwtFormat(token)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid token format. Please provide a valid JWT token.' 
            });
        }
        
        // Encode the token for secure storage
        const encodedToken = tokenUtils.encodeToken(token);
        
        // Save to database
        const saved = await db.setWhatsappApiToken(encodedToken);
        
        if (!saved) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to save token to database' 
            });
        }
        
        // Clear the token cache so the new token takes effect immediately
        tokenUtils.clearTokenCache();
        
        console.log('✅ WhatsApp API token updated by admin');
        
        res.json({
            success: true,
            message: 'WhatsApp API token updated successfully. Changes take effect immediately.'
        });
    } catch (error) {
        console.error('Error setting WhatsApp token:', error);
        res.status(500).json({ success: false, message: 'Failed to set token' });
    }
});

// Delete WhatsApp API token from database (reverts to config.js fallback)
app.delete('/api/admin/whatsapp-token', requireAdmin, async (req, res) => {
    try {
        const cleared = await db.clearWhatsappApiToken();
        
        if (!cleared) {
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to clear token from database' 
            });
        }
        
        // Clear the token cache so the system falls back to config.js immediately
        tokenUtils.clearTokenCache();
        
        console.log('✅ WhatsApp API token cleared by admin (reverted to config.js)');
        
        res.json({
            success: true,
            message: 'Token cleared. System will now use the default token from config.js.'
        });
    } catch (error) {
        console.error('Error clearing WhatsApp token:', error);
        res.status(500).json({ success: false, message: 'Failed to clear token' });
    }
});

// Test WhatsApp API token (verifies it works with the backend)
app.post('/api/admin/whatsapp-token/test', requireAdmin, async (req, res) => {
    try {
        // Get the current active token (from DB or config)
        const jwtToken = await getRandomToken();
        
        // Try to make a simple request to the WhatsApp backend
        const testUrl = `${config.urls.whatsappBackend}/api/channel/metadata-proxy?url=${encodeURIComponent('https://whatsapp.com/channel/0029VaCCYBXGehGLiMpKO03B')}`;
        
        const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
                'cookie': `jwt=${jwtToken}`,
                'accept': 'application/json'
            }
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: 'Token is valid and working!',
                data: {
                    status: 'active',
                    testedAt: new Date().toISOString()
                }
            });
        } else {
            const errorData = await response.text();
            res.json({
                success: false,
                message: 'Token test failed. The token may be expired or invalid.',
                data: {
                    status: 'failed',
                    httpStatus: response.status,
                    testedAt: new Date().toISOString()
                }
            });
        }
    } catch (error) {
        console.error('Error testing WhatsApp token:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to test token: ' + error.message 
        });
    }
});

// ================== POPUP ANNOUNCEMENT ROUTES (ADMIN) ==================

// Get popup announcement (public - for users to see)
app.get('/api/popup-announcement', async (req, res) => {
    try {
        const announcement = await db.getSiteSetting('popup_announcement');
        if (!announcement) {
            return res.json({ success: true, data: null });
        }
        
        let data;
        try {
            data = JSON.parse(announcement);
        } catch (parseError) {
            console.error('Error parsing popup announcement JSON:', parseError);
            return res.json({ success: true, data: null });
        }
        
        // Check if announcement is enabled
        if (!data.enabled) {
            return res.json({ success: true, data: null });
        }
        
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error getting popup announcement:', error);
        res.json({ success: true, data: null });
    }
});

// Get popup announcement (admin - full details)
app.get('/api/admin/popup-announcement', requireAdmin, async (req, res) => {
    try {
        const announcement = await db.getSiteSetting('popup_announcement');
        if (!announcement) {
            return res.json({ 
                success: true, 
                data: { enabled: false, title: '', message: '', type: 'info' }
            });
        }
        
        let data;
        try {
            data = JSON.parse(announcement);
        } catch (parseError) {
            console.error('Error parsing popup announcement JSON:', parseError);
            return res.json({ 
                success: true, 
                data: { enabled: false, title: '', message: '', type: 'info' }
            });
        }
        
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error getting popup announcement:', error);
        res.status(500).json({ success: false, message: 'Failed to get popup announcement' });
    }
});

// Create/Update popup announcement (admin)
app.post('/api/admin/popup-announcement', requireAdmin, async (req, res) => {
    try {
        const { title, message, type = 'info', enabled = true } = req.body;
        
        if (!title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'Title and message are required' 
            });
        }
        
        // Validate type
        const validTypes = ['info', 'success', 'warning', 'error'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'type must be one of: info, success, warning, error' 
            });
        }
        
        const data = {
            title,
            message,
            type,
            enabled,
            updatedAt: new Date().toISOString()
        };
        
        await db.setSiteSetting('popup_announcement', JSON.stringify(data));
        
        console.log(`📢 Popup announcement ${enabled ? 'enabled' : 'disabled'} by admin`);
        
        res.json({
            success: true,
            message: enabled ? 'Popup announcement created/updated successfully' : 'Popup announcement disabled',
            data
        });
    } catch (error) {
        console.error('Error setting popup announcement:', error);
        res.status(500).json({ success: false, message: 'Failed to set popup announcement' });
    }
});

// Delete popup announcement (admin)
app.delete('/api/admin/popup-announcement', requireAdmin, async (req, res) => {
    try {
        await db.setSiteSetting('popup_announcement', JSON.stringify({
            enabled: false,
            title: '',
            message: '',
            type: 'info',
            updatedAt: new Date().toISOString()
        }));
        
        console.log('📢 Popup announcement deleted by admin');
        
        res.json({
            success: true,
            message: 'Popup announcement deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting popup announcement:', error);
        res.status(500).json({ success: false, message: 'Failed to delete popup announcement' });
    }
});

// ================== NOTIFICATION ROUTES (ADMIN) ==================

// Send notification to a specific user
app.post('/api/admin/notifications/send', requireAdmin, async (req, res) => {
    try {
        const { userId, title, message, type = 'info' } = req.body;
        
        if (!userId || !title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId, title, and message are required' 
            });
        }
        
        // Validate type
        const validTypes = ['info', 'success', 'warning', 'error'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'type must be one of: info, success, warning, error' 
            });
        }
        
        const notification = await db.createNotification(userId, title, message, type);
        
        res.json({
            success: true,
            message: 'Notification sent successfully',
            data: notification
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
});

// Send notification to all users (broadcast)
app.post('/api/admin/notifications/broadcast', requireAdmin, async (req, res) => {
    try {
        const { title, message, type = 'info' } = req.body;
        
        if (!title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'title and message are required' 
            });
        }
        
        // Validate type
        const validTypes = ['info', 'success', 'warning', 'error'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'type must be one of: info, success, warning, error' 
            });
        }
        
        const result = await db.createBroadcastNotification(title, message, type);
        
        console.log(`📢 Broadcast notification sent to ${result.count} users`);
        
        res.json({
            success: true,
            message: `Notification sent to ${result.count} users`,
            data: result
        });
    } catch (error) {
        console.error('Error broadcasting notification:', error);
        res.status(500).json({ success: false, message: 'Failed to broadcast notification' });
    }
});

// ================== EMAIL BROADCAST ROUTES (ADMIN) ==================

// Get available broadcast categories
app.get('/api/admin/broadcast/categories', requireAdmin, (req, res) => {
    try {
        const categories = emailService.getBroadcastCategories();
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('Error getting broadcast categories:', error);
        res.status(500).json({ success: false, message: 'Failed to get categories' });
    }
});

// Get preview of broadcast template
app.get('/api/admin/broadcast/preview/:category', requireAdmin, (req, res) => {
    try {
        const { category } = req.params;
        const preview = emailService.getPresetPreview(category);
        
        if (!preview) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        
        res.json({ success: true, data: preview });
    } catch (error) {
        console.error('Error getting broadcast preview:', error);
        res.status(500).json({ success: false, message: 'Failed to get preview' });
    }
});

// Verify email configuration
app.get('/api/admin/broadcast/verify', requireAdmin, async (req, res) => {
    try {
        const result = await emailService.verifyConnection();
        // Add email status for better debugging
        result.status = emailService.getEmailStatus();
        res.json(result);
    } catch (error) {
        console.error('Error verifying email connection:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send broadcast to all users
// Track broadcast status for monitoring
let currentBroadcast = {
    active: false,
    startTime: null,
    totalUsers: 0,
    sent: 0,
    failed: 0,
    category: null,
    currentBatch: 0,
    totalBatches: 0
};

app.post('/api/admin/broadcast/send', requireAdmin, async (req, res) => {
    try {
        const { category, customMessage, targetFilter } = req.body;
        
        if (!category && !customMessage) {
            return res.status(400).json({ 
                success: false, 
                message: 'Either category or custom message is required' 
            });
        }
        
        // Check if a broadcast is already in progress
        if (currentBroadcast.active) {
            return res.status(409).json({
                success: false,
                message: 'A broadcast is already in progress. Please wait for it to complete.',
                data: {
                    sent: currentBroadcast.sent,
                    total: currentBroadcast.totalUsers,
                    startTime: currentBroadcast.startTime,
                    currentBatch: currentBroadcast.currentBatch,
                    totalBatches: currentBroadcast.totalBatches
                }
            });
        }
        
        // Get users to send to
        let users = await db.getAllUsers();
        
        // Apply target filter if provided
        if (targetFilter) {
            if (targetFilter === 'free') {
                users = users.filter(u => u.plan === 'free');
            } else if (targetFilter === 'premium') {
                users = users.filter(u => u.plan === 'premium');
            }
            // 'all' = no filter needed
        }
        
        // Filter out users without email and banned users
        users = users.filter(u => u.email && !u.is_banned);
        
        if (users.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No users with email addresses found' 
            });
        }
        
        // Get batch configuration from email service
        const batchSize = emailService.BATCH_CONFIG?.batchSize || 50;
        const totalBatches = Math.ceil(users.length / batchSize);
        const estimatedTimeMinutes = Math.ceil(totalBatches * (emailService.BATCH_CONFIG?.delayBetweenBatches || 60000) / 60000);
        
        console.log(`📧 Starting batch broadcast to ${users.length} users in ${totalBatches} batches...`);
        
        // Track broadcast status
        const totalUsers = users.length;
        currentBroadcast = {
            active: true,
            startTime: new Date().toISOString(),
            totalUsers: totalUsers,
            sent: 0,
            failed: 0,
            category: category,
            currentBatch: 0,
            totalBatches: totalBatches
        };
        
        // Progress callback to update broadcast status in real-time
        const onProgress = (progress) => {
            currentBroadcast.currentBatch = progress.currentBatch;
            currentBroadcast.sent = progress.sent;
            currentBroadcast.failed = progress.failed;
        };
        
        // Start sending emails asynchronously (non-blocking)
        // This works on all platforms: Vercel (serverless), Heroku, Coolify, etc.
        // On Heroku/Coolify: Process stays alive, emails complete in background
        // On Vercel: May timeout for large broadcasts, but response is already sent
        setImmediate(async () => {
            try {
                const result = await emailService.sendBroadcastToUsers(users, category, customMessage, onProgress);
                currentBroadcast.sent = result.sent;
                currentBroadcast.failed = result.failed;
                console.log(`✅ Broadcast complete: ${result.sent} sent, ${result.failed} failed`);
                if (result.errors && result.errors.length > 0) {
                    console.log('❌ Errors:', result.errors.slice(0, 5)); // Log first 5 errors
                }
            } catch (error) {
                console.error('❌ Background broadcast error:', error);
            } finally {
                currentBroadcast.active = false;
            }
        });
        
        // Respond immediately to client
        res.json({
            success: true,
            message: `Email broadcast queued for ${totalUsers} users. Emails will be sent in ${totalBatches} batch(es).`,
            data: {
                queued: totalUsers,
                status: 'processing',
                batchInfo: {
                    batchSize: batchSize,
                    totalBatches: totalBatches,
                    estimatedTimeMinutes: estimatedTimeMinutes
                },
                note: 'Emails are sent in batches to avoid rate limiting. Check the status endpoint for progress.'
            }
        });
    } catch (error) {
        console.error('Error sending broadcast:', error);
        currentBroadcast.active = false;
        res.status(500).json({ success: false, message: 'Failed to send broadcast' });
    }
});

// Get broadcast status (admin only)
app.get('/api/admin/broadcast/status', requireAdmin, (req, res) => {
    // Calculate progress percentage
    const progress = currentBroadcast.totalUsers > 0 
        ? Math.round(((currentBroadcast.sent + currentBroadcast.failed) / currentBroadcast.totalUsers) * 100) 
        : 0;
    
    res.json({
        success: true,
        data: {
            active: currentBroadcast.active,
            startTime: currentBroadcast.startTime,
            totalUsers: currentBroadcast.totalUsers,
            sent: currentBroadcast.sent,
            failed: currentBroadcast.failed,
            category: currentBroadcast.category,
            currentBatch: currentBroadcast.currentBatch,
            totalBatches: currentBroadcast.totalBatches,
            progress: progress
        }
    });
});

// Send test email to admin
app.post('/api/admin/broadcast/test', requireAdmin, async (req, res) => {
    try {
        const { email, category, customMessage } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }
        
        // Create a fake user for testing
        const testUser = { email, name: 'Test User' };
        
        const result = await emailService.sendBroadcastToUsers([testUser], category, customMessage);
        
        // Provide detailed feedback for test emails
        // Use predefined messages for security, with sanitized error hints
        let message;
        if (result.sent > 0) {
            message = 'Test email sent successfully! Check your inbox.';
        } else if (result.errors && result.errors.length > 0) {
            // Map common SMTP errors to user-friendly messages
            const errorText = result.errors[0].error || '';
            if (errorText.includes('auth') || errorText.includes('credentials')) {
                message = 'Failed to send test email: Authentication failed. Please check SMTP credentials.';
            } else if (errorText.includes('connect') || errorText.includes('ECONNREFUSED')) {
                message = 'Failed to send test email: Could not connect to mail server.';
            } else if (errorText.includes('timeout')) {
                message = 'Failed to send test email: Connection timed out.';
            } else {
                message = 'Failed to send test email. Check server logs for details.';
            }
        } else {
            message = 'Failed to send test email. Check server logs for details.';
        }
        
        res.json({
            success: result.sent > 0,
            message: message,
            data: result
        });
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({ success: false, message: 'Failed to send test email' });
    }
});

// Serve uploaded files (for admin to view payment proofs)
app.use('/uploads', express.static(uploadsDir));

// ================== BACKUP & RESTORE ROUTES (ADMIN) ==================

// Create backup - exports all database tables to JSON
app.get('/api/admin/backup/create', requireAdmin, async (req, res) => {
    try {
        console.log('📦 Creating database backup...');
        
        const backup = await db.createDatabaseBackup();
        
        if (!backup.success) {
            return res.status(500).json({
                success: false,
                message: backup.message || 'Failed to create backup'
            });
        }
        
        // Set headers for file download
        const filename = `easybooster-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        res.json(backup.data);
    } catch (error) {
        console.error('Error creating backup:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create backup: ' + error.message
        });
    }
});

// Get backup metadata (without actual data)
app.get('/api/admin/backup/info', requireAdmin, async (req, res) => {
    try {
        const info = await db.getBackupInfo();
        res.json({
            success: true,
            data: info
        });
    } catch (error) {
        console.error('Error getting backup info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get backup information'
        });
    }
});

// Configure multer for backup file uploads
const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for backup files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error('Only JSON files are allowed for backup restore'), false);
        }
    }
});

// Restore from backup - imports data from JSON file
app.post('/api/admin/backup/restore', requireAdmin, backupUpload.single('backupFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No backup file provided'
            });
        }
        
        console.log('📥 Restoring database from backup...');
        
        // Parse the JSON backup file
        let backupData;
        try {
            backupData = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid backup file format. Must be valid JSON.'
            });
        }
        
        // Validate backup structure
        if (!backupData.metadata || !backupData.tables) {
            return res.status(400).json({
                success: false,
                message: 'Invalid backup file structure. Missing required fields.'
            });
        }
        
        const result = await db.restoreDatabaseBackup(backupData);
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: result.message || 'Failed to restore backup'
            });
        }
        
        console.log('✅ Database restored successfully');
        
        res.json({
            success: true,
            message: 'Database restored successfully',
            data: result.data
        });
    } catch (error) {
        console.error('Error restoring backup:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to restore backup: ' + error.message
        });
    }
});

// Validate backup file without restoring
app.post('/api/admin/backup/validate', requireAdmin, backupUpload.single('backupFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No backup file provided'
            });
        }
        
        // Parse the JSON backup file
        let backupData;
        try {
            backupData = JSON.parse(req.file.buffer.toString('utf8'));
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid backup file format. Must be valid JSON.',
                valid: false
            });
        }
        
        const validation = await db.validateBackupFile(backupData);
        
        res.json({
            success: true,
            valid: validation.valid,
            message: validation.message,
            data: validation.data
        });
    } catch (error) {
        console.error('Error validating backup:', error);
        res.status(500).json({
            success: false,
            valid: false,
            message: 'Failed to validate backup: ' + error.message
        });
    }
});

// ================== API KEY MANAGEMENT ROUTES (ADMIN) ==================

// Get all API keys
app.get('/api/admin/api-keys', requireAdmin, async (req, res) => {
    try {
        const apiKeys = await db.getAllApiKeys();
        res.json({ success: true, data: apiKeys });
    } catch (error) {
        console.error('Error getting API keys:', error);
        res.status(500).json({ success: false, message: 'Failed to get API keys' });
    }
});

// Generate new API key
app.post('/api/admin/api-keys/generate', requireAdmin, async (req, res) => {
    try {
        const { userId, name, requestLimit, expiresInDays } = req.body;
        
        if (!name || !requestLimit) {
            return res.status(400).json({
                success: false,
                message: 'Name and request limit are required'
            });
        }
        
        const limit = parseInt(requestLimit);
        if (isNaN(limit) || limit < 1 || limit > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Request limit must be between 1 and 10000'
            });
        }
        
        // If userId is provided, verify user exists
        if (userId) {
            const user = await db.getUserById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }
        }
        
        const apiKey = await db.createApiKey(
            userId || null,
            name,
            limit,
            expiresInDays ? parseInt(expiresInDays) : null
        );
        
        console.log(`✅ API key generated: ${apiKey.name} (ID: ${apiKey.id})`);
        
        res.json({
            success: true,
            message: 'API key generated successfully',
            data: apiKey
        });
    } catch (error) {
        console.error('Error generating API key:', error);
        res.status(500).json({ success: false, message: 'Failed to generate API key' });
    }
});

// Get API key details with statistics
app.get('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
        const apiKeyId = parseInt(req.params.id);
        const apiKey = await db.getApiKeyById(apiKeyId);
        
        if (!apiKey) {
            return res.status(404).json({
                success: false,
                message: 'API key not found'
            });
        }
        
        const stats = await db.getApiKeyStats(apiKeyId);
        const recentRequests = await db.getApiKeyRequests(apiKeyId, 20);
        
        res.json({
            success: true,
            data: {
                apiKey,
                stats,
                recentRequests
            }
        });
    } catch (error) {
        console.error('Error getting API key details:', error);
        res.status(500).json({ success: false, message: 'Failed to get API key details' });
    }
});

// Update API key limit
app.put('/api/admin/api-keys/:id/limit', requireAdmin, async (req, res) => {
    try {
        const apiKeyId = parseInt(req.params.id);
        const { requestLimit } = req.body;
        
        if (!requestLimit) {
            return res.status(400).json({
                success: false,
                message: 'Request limit is required'
            });
        }
        
        const limit = parseInt(requestLimit);
        if (isNaN(limit) || limit < 1 || limit > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Request limit must be between 1 and 10000'
            });
        }
        
        const updatedKey = await db.updateApiKeyLimit(apiKeyId, limit);
        
        if (!updatedKey) {
            return res.status(404).json({
                success: false,
                message: 'API key not found'
            });
        }
        
        res.json({
            success: true,
            message: 'API key limit updated successfully',
            data: updatedKey
        });
    } catch (error) {
        console.error('Error updating API key limit:', error);
        res.status(500).json({ success: false, message: 'Failed to update API key limit' });
    }
});

// Toggle API key active status
app.put('/api/admin/api-keys/:id/toggle', requireAdmin, async (req, res) => {
    try {
        const apiKeyId = parseInt(req.params.id);
        const updatedKey = await db.toggleApiKeyStatus(apiKeyId);
        
        if (!updatedKey) {
            return res.status(404).json({
                success: false,
                message: 'API key not found'
            });
        }
        
        res.json({
            success: true,
            message: `API key ${updatedKey.is_active ? 'enabled' : 'disabled'} successfully`,
            data: updatedKey
        });
    } catch (error) {
        console.error('Error toggling API key status:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle API key status' });
    }
});

// Delete API key
app.delete('/api/admin/api-keys/:id', requireAdmin, async (req, res) => {
    try {
        const apiKeyId = parseInt(req.params.id);
        await db.deleteApiKey(apiKeyId);
        
        res.json({
            success: true,
            message: 'API key deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).json({ success: false, message: 'Failed to delete API key' });
    }
});

// ================== API KEY REQUEST ENDPOINTS ==================

// User: Submit API key request
app.post('/api/user/api-key-request', async (req, res) => {
    try {
        // Check authentication
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const { purpose } = req.body;
        
        // Validation
        if (!purpose || purpose.trim().length < 20) {
            return res.status(400).json({
                success: false,
                message: 'Purpose is required and must be at least 20 characters'
            });
        }

        if (purpose.length > 1000) {
            return res.status(400).json({
                success: false,
                message: 'Purpose must not exceed 1000 characters'
            });
        }

        // Check cooldown
        const cooldownCheck = await db.canUserSubmitApiKeyRequest(req.user.id);
        if (!cooldownCheck.canSubmit) {
            return res.status(429).json({
                success: false,
                message: cooldownCheck.message,
                hoursRemaining: cooldownCheck.hoursRemaining
            });
        }

        // Create the request
        const request = await db.createApiKeyRequest(req.user.id, purpose.trim());
        
        res.json({
            success: true,
            message: 'API key request submitted successfully',
            data: request
        });
    } catch (error) {
        console.error('Error submitting API key request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit API key request'
        });
    }
});

// User: Get their API key requests
app.get('/api/user/api-key-requests', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const requests = await db.getUserApiKeyRequests(req.user.id);
        const cooldownCheck = await db.canUserSubmitApiKeyRequest(req.user.id);
        
        res.json({
            success: true,
            data: {
                requests,
                canSubmit: cooldownCheck.canSubmit,
                cooldownMessage: cooldownCheck.message,
                hoursRemaining: cooldownCheck.hoursRemaining
            }
        });
    } catch (error) {
        console.error('Error getting user API key requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get API key requests'
        });
    }
});

// Admin: Get all API key requests
app.get('/api/admin/api-key-requests', requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        const requests = await db.getAllApiKeyRequests(status);
        
        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Error getting API key requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get API key requests'
        });
    }
});

// Admin: Get pending API key requests
app.get('/api/admin/api-key-requests/pending', requireAdmin, async (req, res) => {
    try {
        const requests = await db.getAllPendingApiKeyRequests();
        
        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Error getting pending API key requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending requests'
        });
    }
});

// Admin: Approve API key request
app.post('/api/admin/api-key-requests/:id/approve', requireAdmin, async (req, res) => {
    try {
        const requestId = parseInt(req.params.id);
        const { reason } = req.body;
        
        const adminUsername = req.session.adminUsername || 'admin';
        const result = await db.approveApiKeyRequest(requestId, adminUsername, reason);
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        res.json({
            success: true,
            message: result.message,
            data: result.apiKey
        });
    } catch (error) {
        console.error('Error approving API key request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve API key request'
        });
    }
});

// Admin: Reject API key request
app.post('/api/admin/api-key-requests/:id/reject', requireAdmin, async (req, res) => {
    try {
        const requestId = parseInt(req.params.id);
        const { reason } = req.body;
        
        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required and must be at least 10 characters'
            });
        }
        
        const adminUsername = req.session.adminUsername || 'admin';
        const result = await db.rejectApiKeyRequest(requestId, adminUsername, reason.trim());
        
        if (!result.success) {
            return res.status(400).json(result);
        }
        
        res.json({
            success: true,
            message: result.message,
            data: result.request
        });
    } catch (error) {
        console.error('Error rejecting API key request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject API key request'
        });
    }
});

// ================== COUPON MANAGEMENT API ENDPOINTS ==================

// Create a new coupon (admin only)
app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    try {
        const { code, coinAmount, usageLimit, expirationDate, whatsappGroupLink } = req.body;
        
        // Validation
        if (!code || !coinAmount || !usageLimit || !expirationDate) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: code, coinAmount, usageLimit, expirationDate' 
            });
        }
        
        if (coinAmount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Coin amount must be greater than 0' 
            });
        }
        
        if (usageLimit <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Usage limit must be greater than 0' 
            });
        }
        
        // Check if expiration date is in the future
        if (new Date(expirationDate) <= new Date()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Expiration date must be in the future' 
            });
        }
        
        const coupon = await db.createCoupon({
            code,
            coinAmount,
            usageLimit,
            expirationDate,
            whatsappGroupLink,
            createdBy: req.session.adminUsername || 'admin'
        });
        
        res.json({
            success: true,
            message: 'Coupon created successfully',
            data: coupon
        });
    } catch (error) {
        console.error('Error creating coupon:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to create coupon' 
        });
    }
});

// Get all coupons (admin only)
app.get('/api/admin/coupons', requireAdmin, async (req, res) => {
    try {
        const coupons = await db.getAllCoupons();
        res.json({
            success: true,
            data: coupons
        });
    } catch (error) {
        console.error('Error getting coupons:', error);
        res.status(500).json({ success: false, message: 'Failed to get coupons' });
    }
});

// Get a single coupon with claimers (admin only)
app.get('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    try {
        const couponId = parseInt(req.params.id);
        const coupon = await db.getCouponById(couponId);
        
        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Coupon not found' });
        }
        
        res.json({
            success: true,
            data: coupon
        });
    } catch (error) {
        console.error('Error getting coupon:', error);
        res.status(500).json({ success: false, message: 'Failed to get coupon' });
    }
});

// Deactivate a coupon (admin only)
app.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    try {
        const couponId = parseInt(req.params.id);
        const coupon = await db.deactivateCoupon(couponId);
        
        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Coupon not found' });
        }
        
        res.json({
            success: true,
            message: 'Coupon deactivated successfully',
            data: coupon
        });
    } catch (error) {
        console.error('Error deactivating coupon:', error);
        res.status(500).json({ success: false, message: 'Failed to deactivate coupon' });
    }
});

// ================== USER COUPON API ENDPOINTS ==================

// Validate a coupon code (user)
app.get('/api/user/validate-coupon/:code', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        const code = req.params.code;
        const coupon = await db.getCouponByCode(code);
        
        if (!coupon) {
            return res.json({ 
                success: false, 
                valid: false,
                message: 'Invalid coupon code' 
            });
        }
        
        // Check various conditions
        if (!coupon.is_active) {
            return res.json({ 
                success: false, 
                valid: false,
                message: 'This coupon is no longer active' 
            });
        }
        
        if (new Date(coupon.expiration_date) < new Date()) {
            return res.json({ 
                success: false, 
                valid: false,
                message: 'This coupon has expired' 
            });
        }
        
        if (coupon.usage_count >= coupon.usage_limit) {
            return res.json({ 
                success: false, 
                valid: false,
                message: 'This coupon has reached its usage limit' 
            });
        }
        
        // Check if user already claimed
        const alreadyClaimed = await db.hasUserClaimedCoupon(req.user.id, coupon.id);
        if (alreadyClaimed) {
            return res.json({ 
                success: false, 
                valid: false,
                message: 'You have already claimed this coupon' 
            });
        }
        
        res.json({
            success: true,
            valid: true,
            message: 'Coupon is valid',
            data: {
                code: coupon.code,
                coinAmount: coupon.coin_amount,
                expirationDate: coupon.expiration_date
            }
        });
    } catch (error) {
        console.error('Error validating coupon:', error);
        res.status(500).json({ success: false, message: 'Failed to validate coupon' });
    }
});

// Claim a coupon (user)
app.post('/api/user/claim-coupon', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        // Check if user is banned
        if (req.user.is_banned) {
            return res.status(403).json({ 
                success: false, 
                message: 'Your account is suspended. You cannot claim coupons.' 
            });
        }
        
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Coupon code is required' 
            });
        }
        
        const result = await db.claimCoupon(req.user.id, code);
        
        res.json({
            success: true,
            message: `Coupon claimed successfully! ${result.coinAmount} coins added to your account.`,
            data: {
                coinAmount: result.coinAmount,
                whatsappGroupLink: result.whatsappGroupLink
            }
        });
    } catch (error) {
        console.error('Error claiming coupon:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message || 'Failed to claim coupon' 
        });
    }
});

// Get user's claimed coupons history
app.get('/api/user/coupons/claimed', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        const coupons = await db.getUserClaimedCoupons(req.user.id);
        
        res.json({
            success: true,
            data: coupons
        });
    } catch (error) {
        console.error('Error getting claimed coupons:', error);
        res.status(500).json({ success: false, message: 'Failed to get claimed coupons' });
    }
});

// ================== PUBLIC API ENDPOINTS (API KEY AUTHENTICATION) ==================

// Middleware to validate API key
async function requireApiKey(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Missing or invalid authorization header. Use: Authorization: Bearer YOUR_API_KEY'
            });
        }
        
        const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
        
        const validation = await db.validateAndUseApiKey(apiKey);
        
        if (!validation.valid) {
            return res.status(401).json({
                success: false,
                message: validation.message,
                remaining: validation.remaining
            });
        }
        
        // Attach API key info to request
        req.apiKey = validation.apiKey;
        req.apiKeyRemaining = validation.remaining;
        next();
    } catch (error) {
        console.error('Error validating API key:', error);
        res.status(500).json({
            success: false,
            message: 'Internal error validating API key'
        });
    }
}

// Public API endpoint for single react (requires API key)
app.post('/api/v1/react', checkMaintenanceMode, requireApiKey, async (req, res) => {
    try {
        const { channelLink, emojis } = req.body;
        const clientIp = req.clientIp;
        const userAgent = req.headers['user-agent'];
        const apiKeyId = req.apiKey.id;
        const userId = req.apiKey.user_id;

        // Validate input
        if (!channelLink || !emojis || !Array.isArray(emojis)) {
            await db.logApiRequest(apiKeyId, userId, channelLink || 'N/A', emojis || [], clientIp, userAgent, false, 'Invalid request: channelLink and emojis array are required');
            return res.status(400).json({
                success: false,
                message: 'Invalid request. channelLink and emojis array are required.'
            });
        }

        if (emojis.length === 0 || emojis.length > 16) {
            await db.logApiRequest(apiKeyId, userId, channelLink, emojis, clientIp, userAgent, false, 'Invalid emoji count');
            return res.status(400).json({
                success: false,
                message: 'Please select between 1 and 16 emojis.'
            });
        }

        console.log('📡 API request received:', {
            channelLink,
            emojis,
            emojiCount: emojis.length,
            emojiDetails: emojis.map(e => ({
                emoji: e,
                length: e.length,
                codePoints: [...e].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase())
            })),
            apiKey: req.apiKey.name,
            remaining: req.apiKeyRemaining
        });

        // Integrate with WhatsApp Backend API - same as the regular /api/react endpoint
        const backendUrl = `${config.urls.whatsappBackend}/api/channel/rtpnew2026`;
        
        // Get API token from database
        const encodedToken = await db.getWhatsappApiToken();
        if (!encodedToken) {
            await db.logApiRequest(apiKeyId, userId, channelLink, emojis, clientIp, userAgent, false, 'WhatsApp API token not configured');
            return res.status(500).json({
                success: false,
                message: 'API token not configured. Please contact administrator.'
            });
        }
        
        const tokenUtils = require('./tokenUtils');
        const apiToken = tokenUtils.decodeToken(encodedToken);
        
        // Log emoji data being sent to backend
        console.log('Sending to backend API (v1/react):', {
            endpoint: backendUrl,
            emojis: emojis,
            emojiCount: emojis.length,
            asArray: JSON.stringify(emojis)
        });

        // Send reactions to the backend
        const backendResponse = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`
            },
            body: JSON.stringify({
                post_link: channelLink,
                reacts: emojis // Send emojis as array to properly preserve emoji boundaries (e.g., 🥲,😒,🙂‍↔️,😹)
            })
        });

        const backendData = await backendResponse.json();
        
        // Log backend response with emoji details
        console.log('Backend API response for /api/v1/react:', {
            status: backendResponse.status,
            ok: backendResponse.ok,
            data: backendData,
            emojisSent: emojis,
            emojiCount: emojis.length
        });

        // Check if backend request was successful
        if (!backendResponse.ok) {
            console.error('Backend API error:', backendData);
            await db.logApiRequest(apiKeyId, userId, channelLink, emojis, clientIp, userAgent, false, backendData.message || 'WhatsApp backend error');
            return res.status(backendResponse.status).json({
                success: false,
                message: backendData.message || 'Failed to send reactions to WhatsApp channel.',
                error: backendData
            });
        }

        // Log successful API request
        await db.logApiRequest(apiKeyId, userId, channelLink, emojis, clientIp, userAgent, true, null);

        // Return success response
        res.json({
            success: true,
            message: 'Reactions sent successfully to WhatsApp channel!',
            data: {
                channelLink,
                emojis,
                reactionsCount: emojis.length,
                timestamp: new Date().toISOString(),
                backendResponse: backendData,
                rateLimit: {
                    remaining: req.apiKeyRemaining,
                    limit: req.apiKey.request_limit
                }
            }
        });

    } catch (error) {
        console.error('Error processing API request:', error);
        // Safely access req.apiKey properties with fallbacks
        const apiKeyId = req.apiKey?.id || null;
        const apiKeyUserId = req.apiKey?.user_id || null;
        const channelLink = req.body?.channelLink || 'N/A';
        const emojis = req.body?.emojis || [];
        
        if (apiKeyId) {
            await db.logApiRequest(apiKeyId, apiKeyUserId, channelLink, emojis, req.clientIp, req.headers['user-agent'], false, error.message);
        }
        
        res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
});

// ================== END ADMIN ROUTES ==================

// 404 handler - serves index.html for all unmatched routes
// This is intentional SPA (Single Page Application) behavior
// All client-side routing is handled by the frontend
app.use((req, res) => {
    setNoCacheHeaders(res);
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Start server (for non-Vercel environments)
async function startServer() {
    try {
        // Initialize database
        await db.initializeDatabase();
        
        // OxaPay payment system is webhook-based - no initialization needed
        console.log('✅ OxaPay payment system ready (webhook-based)');
        
        // Run cleanup on startup for notifications and chat history older than configured retention period
        try {
            await db.cleanupOldData();
            console.log('✅ Startup cleanup complete: removed old notifications and chat history');
        } catch (cleanupError) {
            console.error('⚠️ Error during startup cleanup (non-fatal):', cleanupError);
        }
        
        // Schedule cleanup of old rate limits (run once per day)
        setInterval(async () => {
            try {
                await db.cleanupOldRateLimits();
                console.log('✅ Cleaned up old rate limit records');
            } catch (error) {
                console.error('❌ Error during rate limit cleanup:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24 hours
        
        // Schedule cleanup of old notifications and chat history (run once per day)
        setInterval(async () => {
            try {
                await db.cleanupOldData();
            } catch (error) {
                console.error('❌ Error during notifications/chat history cleanup:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24 hours
        
        app.listen(PORT, () => {
            console.log(`🚀 Andy CH React server is running on port ${PORT}`);
            console.log(`📱 Open http://localhost:${PORT} in your browser`);
            console.log(`🌐 Environment: ${config.server.nodeEnv}`);
            console.log(`🔐 Rate limit: ${config.rateLimit.perDay} requests per day`);
            console.log(`💰 Default user balance: ${config.user.defaultBalance} coins`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        console.log('⚠️  Starting server without database connection...');
        
        app.listen(PORT, () => {
            console.log(`🚀 Andy CH React server is running on port ${PORT} (DATABASE DISABLED)`);
            console.log(`📱 Open http://localhost:${PORT} in your browser`);
            console.log(`🌐 Environment: ${config.server.nodeEnv}`);
        });
    }
}

// Export app for Vercel serverless functions
module.exports = app;

// Only start the server when not running on Vercel (serverless)
// Vercel sets VERCEL=1 environment variable in serverless functions
if (process.env.VERCEL !== '1') {
    startServer();
}
