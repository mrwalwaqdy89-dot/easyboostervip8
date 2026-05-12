/**
 * 5SMM API Service
 * Integration with 5SMM.com API for social media marketing services
 * API Documentation: https://5smm.com/api
 */

const axios = require('axios');
const config = require('./config');

class SMMService {
    constructor() {
        this.apiUrl = 'https://5smm.com/api/v2';
        this.apiKey = config.smm.apiKey;
    }

    /**
     * Make a POST request to the 5SMM API
     * @param {Object} data - Request parameters
     * @returns {Promise<Object>} API response
     */
    async request(data) {
        try {
            const params = new URLSearchParams({
                key: this.apiKey,
                ...data
            });

            const response = await axios.post(this.apiUrl, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'ARCH-SMM-Service/1.0'
                },
                timeout: 30000 // 30 seconds timeout
            });

            return response.data;
        } catch (error) {
            console.error('5SMM API Error:', error.message);
            throw new Error(`5SMM API request failed: ${error.message}`);
        }
    }

    /**
     * Get all available services from 5SMM
     * @returns {Promise<Array>} List of services
     */
    async getServices() {
        try {
            const response = await this.request({ action: 'services' });
            return response;
        } catch (error) {
            console.error('Error fetching services:', error);
            throw error;
        }
    }

    /**
     * Get services filtered by category
     * @param {string} category - Category name
     * @returns {Promise<Array>} Filtered list of services
     */
    async getServicesByCategory(category) {
        try {
            const services = await this.getServices();
            return services.filter(service => 
                service.category && service.category.toLowerCase().includes(category.toLowerCase())
            );
        } catch (error) {
            console.error('Error fetching services by category:', error);
            throw error;
        }
    }

    /**
     * Create a new order
     * @param {Object} orderData - Order details
     * @param {number} orderData.service - Service ID
     * @param {string} orderData.link - Target link
     * @param {number} [orderData.quantity] - Quantity (for default services)
     * @param {string} [orderData.comments] - Comments (for custom comment services)
     * @param {string} [orderData.usernames] - Usernames (for mention services)
     * @param {number} [orderData.runs] - Number of runs (for drip-feed)
     * @param {number} [orderData.interval] - Interval in minutes (for drip-feed)
     * @returns {Promise<Object>} Order response with order ID
     */
    async createOrder(orderData) {
        try {
            const response = await this.request({
                action: 'add',
                ...orderData
            });
            return response;
        } catch (error) {
            console.error('Error creating order:', error);
            throw error;
        }
    }

    /**
     * Get order status
     * @param {number} orderId - Order ID
     * @returns {Promise<Object>} Order status details
     */
    async getOrderStatus(orderId) {
        try {
            const response = await this.request({
                action: 'status',
                order: orderId
            });
            return response;
        } catch (error) {
            console.error('Error fetching order status:', error);
            throw error;
        }
    }

    /**
     * Get multiple orders status
     * @param {Array<number>} orderIds - Array of order IDs (max 100)
     * @returns {Promise<Object>} Multiple order statuses
     */
    async getMultipleOrderStatus(orderIds) {
        try {
            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new Error('orderIds must be a non-empty array');
            }
            if (orderIds.length > 100) {
                throw new Error('Maximum 100 order IDs allowed');
            }

            const response = await this.request({
                action: 'status',
                orders: orderIds.join(',')
            });
            return response;
        } catch (error) {
            console.error('Error fetching multiple order statuses:', error);
            throw error;
        }
    }

    /**
     * Get user balance
     * @returns {Promise<Object>} Balance information
     */
    async getBalance() {
        try {
            const response = await this.request({ action: 'balance' });
            return response;
        } catch (error) {
            console.error('Error fetching balance:', error);
            throw error;
        }
    }

    /**
     * Create a refill request
     * @param {number} orderId - Order ID to refill
     * @returns {Promise<Object>} Refill response
     */
    async createRefill(orderId) {
        try {
            const response = await this.request({
                action: 'refill',
                order: orderId
            });
            return response;
        } catch (error) {
            console.error('Error creating refill:', error);
            throw error;
        }
    }

    /**
     * Create multiple refill requests
     * @param {Array<number>} orderIds - Array of order IDs (max 100)
     * @returns {Promise<Array>} Multiple refill responses
     */
    async createMultipleRefill(orderIds) {
        try {
            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new Error('orderIds must be a non-empty array');
            }
            if (orderIds.length > 100) {
                throw new Error('Maximum 100 order IDs allowed');
            }

            const response = await this.request({
                action: 'refill',
                orders: orderIds.join(',')
            });
            return response;
        } catch (error) {
            console.error('Error creating multiple refills:', error);
            throw error;
        }
    }

    /**
     * Get refill status
     * @param {number} refillId - Refill ID
     * @returns {Promise<Object>} Refill status
     */
    async getRefillStatus(refillId) {
        try {
            const response = await this.request({
                action: 'refill_status',
                refill: refillId
            });
            return response;
        } catch (error) {
            console.error('Error fetching refill status:', error);
            throw error;
        }
    }

    /**
     * Get multiple refill statuses
     * @param {Array<number>} refillIds - Array of refill IDs (max 100)
     * @returns {Promise<Array>} Multiple refill statuses
     */
    async getMultipleRefillStatus(refillIds) {
        try {
            if (!Array.isArray(refillIds) || refillIds.length === 0) {
                throw new Error('refillIds must be a non-empty array');
            }
            if (refillIds.length > 100) {
                throw new Error('Maximum 100 refill IDs allowed');
            }

            const response = await this.request({
                action: 'refill_status',
                refills: refillIds.join(',')
            });
            return response;
        } catch (error) {
            console.error('Error fetching multiple refill statuses:', error);
            throw error;
        }
    }

    /**
     * Cancel orders
     * @param {Array<number>} orderIds - Array of order IDs (max 100)
     * @returns {Promise<Array>} Cancel responses
     */
    async cancelOrders(orderIds) {
        try {
            if (!Array.isArray(orderIds) || orderIds.length === 0) {
                throw new Error('orderIds must be a non-empty array');
            }
            if (orderIds.length > 100) {
                throw new Error('Maximum 100 order IDs allowed');
            }

            const response = await this.request({
                action: 'cancel',
                orders: orderIds.join(',')
            });
            return response;
        } catch (error) {
            console.error('Error canceling orders:', error);
            throw error;
        }
    }

    /**
     * Get popular Instagram services
     * @returns {Promise<Array>} Instagram services
     */
    async getInstagramServices() {
        return await this.getServicesByCategory('Instagram');
    }

    /**
     * Get popular TikTok services
     * @returns {Promise<Array>} TikTok services
     */
    async getTikTokServices() {
        return await this.getServicesByCategory('TikTok');
    }

    /**
     * Get recommended/promo services
     * @returns {Promise<Array>} Recommended services
     */
    async getPromoServices() {
        return await this.getServicesByCategory('5SMM Promo');
    }
}

// Export a singleton instance
module.exports = new SMMService();
