/**
 * 5SMM API Usage Examples
 * 
 * This file demonstrates how to use the 5SMM API integration
 * in your application. All examples assume you're authenticated.
 */

// ============================================================
// Example 1: Get Balance
// ============================================================
async function checkBalance() {
    try {
        const response = await fetch('/api/smm/balance', {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`Balance: $${data.data.balance} ${data.data.currency}`);
            return data.data.balance;
        } else {
            console.error('Failed to get balance:', data.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 2: Get All Instagram Services
// ============================================================
async function getInstagramServices() {
    try {
        const response = await fetch('/api/smm/services/instagram', {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`Found ${data.count} Instagram services`);
            
            // Display first 10 services
            data.data.slice(0, 10).forEach(service => {
                console.log(`
                    Service ID: ${service.service}
                    Name: ${service.name}
                    Rate: $${service.rate}
                    Min: ${service.min}, Max: ${service.max}
                    Refill: ${service.refill ? 'Yes' : 'No'}
                `);
            });
            
            return data.data;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 3: Search for Specific Service
// ============================================================
async function searchService(keyword) {
    try {
        const response = await fetch('/api/smm/services', {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Filter services by keyword
            const filtered = data.data.filter(service => 
                service.name.toLowerCase().includes(keyword.toLowerCase())
            );
            
            console.log(`Found ${filtered.length} services matching "${keyword}"`);
            return filtered;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 4: Create an Order for Instagram Followers
// ============================================================
async function orderInstagramFollowers(instagramLink, quantity) {
    try {
        // First, get Instagram follower services
        const servicesResponse = await fetch('/api/smm/services/instagram', {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const servicesData = await servicesResponse.json();
        
        if (!servicesData.success) {
            console.error('Failed to get services');
            return;
        }
        
        // Find a suitable followers service
        const followerService = servicesData.data.find(service => 
            service.name.toLowerCase().includes('followers') &&
            service.min <= quantity &&
            service.max >= quantity
        );
        
        if (!followerService) {
            console.error('No suitable service found for requested quantity');
            return;
        }
        
        console.log(`Using service: ${followerService.name} (ID: ${followerService.service})`);
        console.log(`Cost: $${(followerService.rate * quantity / 1000).toFixed(2)}`);
        
        // Create the order
        const orderResponse = await fetch('/api/smm/order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            },
            body: JSON.stringify({
                service: followerService.service,
                link: instagramLink,
                quantity: quantity
            })
        });
        
        const orderData = await orderResponse.json();
        
        if (orderData.success) {
            console.log('Order created successfully!');
            console.log('Order ID:', orderData.data.order);
            return orderData.data.order;
        } else {
            console.error('Order failed:', orderData.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 5: Check Order Status
// ============================================================
async function checkOrderStatus(orderId) {
    try {
        const response = await fetch(`/api/smm/order/${orderId}`, {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`
                Order ID: ${orderId}
                Status: ${data.data.status}
                Charge: $${data.data.charge}
                Start Count: ${data.data.start_count}
                Remains: ${data.data.remains}
            `);
            return data.data;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 6: Check Multiple Order Statuses
// ============================================================
async function checkMultipleOrders(orderIds) {
    try {
        const response = await fetch('/api/smm/orders/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            },
            body: JSON.stringify({
                orderIds: orderIds
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            Object.entries(data.data).forEach(([orderId, status]) => {
                if (status.error) {
                    console.log(`Order ${orderId}: Error - ${status.error}`);
                } else {
                    console.log(`Order ${orderId}: ${status.status} (Remains: ${status.remains})`);
                }
            });
            return data.data;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 7: Get Promo Services (Best Prices)
// ============================================================
async function getPromoServices() {
    try {
        const response = await fetch('/api/smm/services/promo', {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`Found ${data.count} promotional services with best prices`);
            
            data.data.forEach(service => {
                console.log(`
                    ${service.name}
                    Service ID: ${service.service}
                    Rate: $${service.rate}
                    Min: ${service.min}, Max: ${service.max}
                `);
            });
            
            return data.data;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 8: Request Refill
// ============================================================
async function requestRefill(orderId) {
    try {
        const response = await fetch('/api/smm/refill', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            },
            body: JSON.stringify({
                orderId: orderId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('Refill requested successfully!');
            console.log('Refill ID:', data.data.refill);
            return data.data.refill;
        } else {
            console.error('Refill request failed:', data.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 9: Cancel Order
// ============================================================
async function cancelOrder(orderId) {
    try {
        const response = await fetch('/api/smm/cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_AUTH_TOKEN'
            },
            body: JSON.stringify({
                orderIds: [orderId]
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('Cancel request processed');
            console.log(data.data);
            return data.data;
        } else {
            console.error('Cancel request failed:', data.message);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// Example 10: Complete Workflow - Order and Track
// ============================================================
async function completeOrderWorkflow(instagramLink, quantity) {
    console.log('Starting complete order workflow...\n');
    
    // Step 1: Check balance
    console.log('Step 1: Checking balance...');
    const balance = await checkBalance();
    
    if (!balance || parseFloat(balance) < 1) {
        console.error('Insufficient balance!');
        return;
    }
    
    // Step 2: Create order
    console.log('\nStep 2: Creating order...');
    const orderId = await orderInstagramFollowers(instagramLink, quantity);
    
    if (!orderId) {
        console.error('Failed to create order');
        return;
    }
    
    // Step 3: Check order status
    console.log('\nStep 3: Checking order status...');
    const orderStatus = await checkOrderStatus(orderId);
    
    console.log('\n✅ Workflow completed successfully!');
    console.log(`Order ID: ${orderId}`);
    console.log(`Status: ${orderStatus.status}`);
}

// ============================================================
// Usage Instructions
// ============================================================

/*
HOW TO USE THESE EXAMPLES:

1. Make sure you're authenticated and have a valid auth token

2. Include this file in your HTML:
   <script src="smm-examples.js"></script>

3. Call any function from the browser console or your code:
   
   // Get balance
   checkBalance();
   
   // Get Instagram services
   getInstagramServices();
   
   // Search for a specific service
   searchService('followers');
   
   // Create an order
   orderInstagramFollowers('https://instagram.com/username', 1000);
   
   // Check order status
   checkOrderStatus(23501);
   
   // Run complete workflow
   completeOrderWorkflow('https://instagram.com/username', 500);

4. For React/Vue/Angular applications, adapt these functions to use
   your preferred HTTP client (axios, fetch, etc.) and state management.

5. Remember to replace 'Bearer YOUR_AUTH_TOKEN' with actual authentication
   mechanism used in your application.
*/

// Export functions for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkBalance,
        getInstagramServices,
        searchService,
        orderInstagramFollowers,
        checkOrderStatus,
        checkMultipleOrders,
        getPromoServices,
        requestRefill,
        cancelOrder,
        completeOrderWorkflow
    };
}
