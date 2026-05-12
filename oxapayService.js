// OxaPay Payment Service
// Handles payment creation and webhook verification for OxaPay gateway

const crypto = require('crypto');
const config = require('./config');

const OXAPAY_API_URL = 'https://api.oxapay.com/merchants/request';

// Payment status constants
const PAYMENT_STATUS = {
    PAID: 'Paid',
    CONFIRMING: 'Confirming',
    COMPLETE: 'Complete'
};

// Status values that indicate payment is successful
const PAID_STATUSES = [PAYMENT_STATUS.PAID, PAYMENT_STATUS.CONFIRMING, PAYMENT_STATUS.COMPLETE];

// Base URL for callbacks
const getBaseUrl = () => {
    return config.urls.baseUrl || 'https://easybooster.shop';
};

/**
 * Create a payment request with OxaPay
 * @param {Object} params - Payment parameters
 * @param {number} params.amount - Amount in USDT
 * @param {string} params.orderId - Unique order ID
 * @param {string} params.email - Customer email (optional)
 * @param {string} params.description - Payment description (optional)
 * @returns {Promise<Object>} OxaPay response with payment URL
 */
async function createPayment({ amount, orderId, email = '', description = '' }) {
    const merchantKey = config.oxapay.merchantKey;
    
    if (!merchantKey) {
        throw new Error('OxaPay merchant key not configured');
    }

    const baseUrl = getBaseUrl();
    const payload = {
        merchant: merchantKey,
        amount: parseFloat(amount).toFixed(2),
        currency: config.oxapay.currency || 'USDT',
        lifeTime: config.oxapay.orderExpirationHours * 60, // Convert hours to minutes
        feePaidByPayer: config.oxapay.feePaidByPayer || 1,
        orderId: String(orderId),
        description: description || `Purchase of coins - Order #${orderId}`,
        callbackUrl: process.env.OXAPAY_CALLBACK_URL || `${baseUrl}/api/oxapay-webhook`,
        returnUrl: process.env.OXAPAY_RETURN_URL || `${baseUrl}/pricing?status=success`
    };

    if (email) {
        payload.email = email;
    }

    try {
        const response = await fetch(OXAPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`OxaPay API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.result !== 100) {
            throw new Error(`OxaPay error: ${data.message || 'Unknown error'}`);
        }

        return {
            success: true,
            trackId: data.trackId,
            payLink: data.payLink,
            orderId: orderId,
            amount: amount,
            currency: config.oxapay.currency
        };
    } catch (error) {
        console.error('OxaPay createPayment error:', error);
        throw error;
    }
}

/**
 * Verify OxaPay webhook signature (HMAC)
 * @param {string} payload - Raw request body as string
 * @param {string} hmacHeader - HMAC signature from request header
 * @returns {boolean} True if signature is valid
 */
function verifyWebhookSignature(payload, hmacHeader) {
    const merchantKey = config.oxapay.merchantKey;
    
    if (!merchantKey || !hmacHeader) {
        return false;
    }

    try {
        const expectedSignature = crypto
            .createHmac('sha512', merchantKey)
            .update(payload)
            .digest('hex');

        // Use timing-safe comparison to prevent timing attacks
        const hmacBuffer = Buffer.from(hmacHeader, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (hmacBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(hmacBuffer, expectedBuffer);
    } catch (error) {
        console.error('HMAC verification error:', error);
        return false;
    }
}

/**
 * Parse and validate OxaPay webhook data
 * @param {Object} webhookData - Webhook payload from OxaPay
 * @returns {Object} Parsed webhook data with validation status
 */
function parseWebhookData(webhookData) {
    const { 
        status, 
        orderId, 
        amount, 
        trackId,
        payAmount,
        payCurrency,
        txID,
        type
    } = webhookData;

    // Validate required fields
    if (!orderId || !status) {
        return {
            valid: false,
            error: 'Missing required fields'
        };
    }

    // Check if payment is complete using constants
    const isPaid = PAID_STATUSES.includes(status);

    return {
        valid: true,
        isPaid,
        status,
        orderId,
        trackId,
        amount: parseFloat(amount) || 0,
        payAmount: parseFloat(payAmount) || 0,
        payCurrency,
        txID,
        type
    };
}

/**
 * Calculate coins from USDT amount
 * USD to USDT is 1:1 (direct balance addition)
 * @param {number} usdAmount - Amount in USD
 * @returns {number} Amount in USDT (same value)
 */
function calculateUSDTFromUSD(usdAmount) {
    return usdAmount; // 1 USD = 1 USDT
}

module.exports = {
    createPayment,
    verifyWebhookSignature,
    parseWebhookData,
    calculateUSDTFromUSD
};
