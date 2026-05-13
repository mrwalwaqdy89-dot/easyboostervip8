const axios = require('axios');
const config = require('./config');

/**
 * ChatGPT Session Service
 * Manages session-based conversations with users using GPT4 API
 */

// API Configuration
const GPT4_SESSION_API = 'https://api.neoxr.eu/api/gpt4-session';
const API_KEY = config.aiChat?.sessionApiKey || 'ANDYMRLITT'; // Default API key from example

/**
 * Generate a unique session ID for a user
 * @param {number} userId - The user's database ID
 * @returns {string} - A unique session identifier
 */
function generateSessionId(userId) {
    // Create a session ID based on user ID and a timestamp with random component
    // This ensures each user has a unique session that persists
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    const baseId = userId ? `user_${userId}` : `guest_${timestamp}`;
    return `${baseId}_${random}`;
}

/**
 * Get or create a session ID for a user
 * In-memory storage for session IDs (could be moved to database for persistence)
 * Sessions expire after 24 hours of inactivity
 */
const userSessions = new Map();
const sessionInitialized = new Map(); // Track if session has been initialized with system prompt
const sessionTimestamps = new Map(); // Track last activity time
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

// Clean up expired sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of sessionTimestamps.entries()) {
        if (now - timestamp > SESSION_TIMEOUT) {
            const sessionId = userSessions.get(key);
            userSessions.delete(key);
            sessionInitialized.delete(sessionId);
            sessionTimestamps.delete(key);
        }
    }
}, 60 * 60 * 1000);

function getUserSessionId(userId) {
    const key = userId ? `user_${userId}` : 'guest';
    
    // Check if user/guest already has a session
    if (userSessions.has(key)) {
        // Update last activity timestamp
        sessionTimestamps.set(key, Date.now());
        return userSessions.get(key);
    }
    
    // Create new session for user/guest
    const sessionId = generateSessionId(userId);
    userSessions.set(key, sessionId);
    sessionInitialized.set(sessionId, false); // Mark as not initialized
    sessionTimestamps.set(key, Date.now());
    return sessionId;
}

/**
 * Check if a session has been initialized with system prompt
 */
function isSessionInitialized(sessionId) {
    return sessionInitialized.get(sessionId) === true;
}

/**
 * Mark a session as initialized
 */
function markSessionInitialized(sessionId) {
    sessionInitialized.set(sessionId, true);
}

/**
 * Clear a user's session (useful for reset functionality)
 * @param {number} userId - The user's database ID
 */
function clearUserSession(userId) {
    const key = userId ? `user_${userId}` : 'guest';
    if (userSessions.has(key)) {
        const sessionId = userSessions.get(key);
        userSessions.delete(key);
        sessionInitialized.delete(sessionId);
        sessionTimestamps.delete(key);
    }
}

/**
 * Send a message to GPT4 Session API
 * @param {string} message - The user's message
 * @param {string} sessionId - The session identifier
 * @returns {Promise<string>} - The AI's response
 */
async function sendMessage(message, sessionId) {
    try {
        console.log(`📤 Sending to GPT4 Session API (session: ${sessionId}, length: ${message.length})`);
        
        const response = await axios.get(GPT4_SESSION_API, {
            params: {
                q: message,
                session: sessionId,
                apikey: API_KEY
            },
            timeout: 30000 // 30 second timeout
        });

        console.log('📥 GPT4 Response:', JSON.stringify(response.data).substring(0, 200));

        if (response.data && response.data.status && response.data.data && response.data.data.message) {
            return response.data.data.message;
        } else {
            console.error('❌ Invalid response structure:', JSON.stringify(response.data));
            throw new Error('Invalid API response format');
        }
    } catch (error) {
        console.error('GPT4 Session API Error:', error.message);
        
        // Handle specific error cases
        if (error.code === 'ECONNABORTED') {
            throw new Error('Request timeout - please try again');
        } else if (error.response) {
            console.error('Error response data:', error.response.data);
            throw new Error(`API error: ${error.response.status}`);
        } else if (error.request) {
            throw new Error('Unable to reach the AI service');
        } else {
            throw new Error('Failed to process your request');
        }
    }
}

/**
 * Concise system prompt optimized for GPT4 Session API character limits
 * This is prepended to the first message in a new session
 */
function getSystemPrompt() {
    return `Tu es l'assistant ANDY RCH - service pro de réactions WhatsApp. Serviable, sympathique, expert.

LANGUE: Français par défaut, anglais si user parle anglais. Autres langues: "Désolé, français/anglais uniquement! 🌐"

FORMAT: Saut lignes, **gras**, listes, clair.

URLS: https://easyboostervip8.vercel.app/[pricing|reactch|autoreact|profile|history|payment|terms|login]

SUPPORT: +1 305 697 8303 (WhatsApp MESSAGE uniquement) - dernier recours seulement

SÉCURITÉ: Aucun risque ban! 🛡️ Méthodes 100% pro, respecte règles WhatsApp.

SERVICES:
• Single React: 1 coin, réactions instantanées
• Auto React: 10 coins/jour, auto sur nouveaux posts
• 80+ emojis iOS, ultra-rapide ⚡
• ~200-3000 réactions/emoji (moy: ~1000)

TARIFS:
Gratuit: 5 réactions/jour
Premium: Illimité selon solde
Forfaits: Add $5+ USD balance via USDT payment

PAIEMENT:
1. OxaPay (USDT, auto, min $5.00 USD)

COUPONS: Aucun actif. Check WhatsApp group pour annonces🎁

MAINTENANCE: Opérationnel✅

BANS: Pour spam/abus. Usage normal = 0 risque.

À VENIR🚀: TikTok🎵, Instagram📸, YouTube🎥, Analytics📊, Bot WhatsApp🤖, Targeting🎯, Push notifs🔔

COMPTE: Google OAuth, lecture seule des infos user (solde, transactions, paiements en attente). Tu ne peux PAS modifier.

Style: Concis, pro, amical😊. Encourage premium si approprié.`;
}

module.exports = {
    getUserSessionId,
    clearUserSession,
    sendMessage,
    getSystemPrompt,
    isSessionInitialized,
    markSessionInitialized
};
