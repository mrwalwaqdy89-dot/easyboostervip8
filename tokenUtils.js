// Token Utility Module
// Provides secure encoding/decoding for sensitive tokens
// This module centralizes token handling to prevent scraping

// XOR key for encryption (must match between encode/decode)
const XOR_KEY = 'ANDY_RCH_SECRET_2025';

// Cache for dynamic token from database (to avoid repeated DB calls)
let cachedDynamicToken = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 seconds cache TTL

/**
 * XOR encode/decode a string with a key
 * XOR is symmetric - same function works for both encoding and decoding
 */
function xorCipher(str, key) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
}

/**
 * Decode an obfuscated token
 * Process: reverse -> base64 decode -> XOR decode
 * @param {string} obfuscatedToken - The obfuscated token from config
 * @returns {string} The original token
 */
function decodeToken(obfuscatedToken) {
    if (!obfuscatedToken) {
        throw new Error('Token is required');
    }
    
    try {
        // Reverse the string
        const unreversed = obfuscatedToken.split('').reverse().join('');
        // Base64 decode (use latin1 instead of deprecated binary)
        const decoded = Buffer.from(unreversed, 'base64').toString('latin1');
        // XOR decode
        return xorCipher(decoded, XOR_KEY);
    } catch (error) {
        throw new Error('Failed to decode token: ' + error.message);
    }
}

/**
 * Encode a token for storage in config
 * Process: XOR encode -> base64 encode -> reverse
 * Note: This is for generating new tokens only, not used at runtime
 * @param {string} token - The original token to obfuscate
 * @returns {string} The obfuscated token
 */
function encodeToken(token) {
    if (!token) {
        throw new Error('Token is required');
    }
    
    // XOR encode
    const xored = xorCipher(token, XOR_KEY);
    // Base64 encode (use latin1 instead of deprecated binary)
    const base64 = Buffer.from(xored, 'latin1').toString('base64');
    // Reverse
    return base64.split('').reverse().join('');
}

/**
 * Get decoded JWT tokens from config
 * @param {object} config - The config object
 * @returns {string[]} Array of decoded tokens
 */
function getJwtTokens(config) {
    const obfuscated = config?.whatsappApi?._t;
    if (!obfuscated) {
        console.error('❌ WhatsApp API token not configured in config.js');
        return [];
    }
    
    try {
        return [decodeToken(obfuscated)];
    } catch (error) {
        console.error('❌ Failed to decode WhatsApp API token:', error.message);
        return [];
    }
}

/**
 * Get a random JWT token from config (synchronous version - uses cache or config fallback)
 * @param {object} config - The config object
 * @returns {string} A decoded JWT token
 */
function getRandomToken(config) {
    // First check if we have a cached dynamic token that's still valid
    if (cachedDynamicToken && (Date.now() - cacheTimestamp) < CACHE_TTL) {
        return cachedDynamicToken;
    }
    
    // Fall back to config tokens
    const tokens = getJwtTokens(config);
    if (tokens.length === 0) {
        throw new Error('No JWT tokens available');
    }
    return tokens[Math.floor(Math.random() * tokens.length)];
}

/**
 * Get a random JWT token from config or database (async version - checks database first)
 * This function prioritizes the database token over the config.js fallback
 * @param {object} config - The config object
 * @param {object} db - The database module
 * @returns {Promise<string>} A decoded JWT token
 */
async function getRandomTokenAsync(config, db) {
    try {
        // Check cache first
        if (cachedDynamicToken && (Date.now() - cacheTimestamp) < CACHE_TTL) {
            return cachedDynamicToken;
        }
        
        // Try to get token from database
        if (db && typeof db.getWhatsappApiToken === 'function') {
            const dbEncodedToken = await db.getWhatsappApiToken();
            if (dbEncodedToken) {
                try {
                    const decodedToken = decodeToken(dbEncodedToken);
                    // Cache the dynamic token
                    cachedDynamicToken = decodedToken;
                    cacheTimestamp = Date.now();
                    return decodedToken;
                } catch (decodeError) {
                    console.error('❌ Failed to decode database token, falling back to config:', decodeError.message);
                }
            }
        }
        
        // Fall back to config tokens
        const tokens = getJwtTokens(config);
        if (tokens.length === 0) {
            throw new Error('No JWT tokens available');
        }
        return tokens[Math.floor(Math.random() * tokens.length)];
    } catch (error) {
        console.error('❌ Error in getRandomTokenAsync:', error.message);
        // Final fallback to config
        const tokens = getJwtTokens(config);
        if (tokens.length === 0) {
            throw new Error('No JWT tokens available');
        }
        return tokens[Math.floor(Math.random() * tokens.length)];
    }
}

/**
 * Clear the cached dynamic token (call this when admin updates the token)
 */
function clearTokenCache() {
    cachedDynamicToken = null;
    cacheTimestamp = 0;
    console.log('✅ Token cache cleared');
}

/**
 * Validate a JWT token format (basic check)
 * @param {string} token - The token to validate
 * @returns {boolean} True if token appears to be a valid JWT format
 */
function isValidJwtFormat(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }
    // JWT tokens have 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) {
        return false;
    }
    // Each part should be base64url encoded and decodable
    const base64urlRegex = /^[A-Za-z0-9_-]+$/;
    for (const part of parts) {
        if (part.length === 0 || !base64urlRegex.test(part)) {
            return false;
        }
        // Try to decode the part to verify it's valid base64url
        try {
            // Convert base64url to base64 (replace - with +, _ with /)
            const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
            // Pad if needed
            const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
            Buffer.from(padded, 'base64');
        } catch {
            return false;
        }
    }
    return true;
}

module.exports = {
    decodeToken,
    encodeToken,
    getJwtTokens,
    getRandomToken,
    getRandomTokenAsync,
    clearTokenCache,
    isValidJwtFormat
};
