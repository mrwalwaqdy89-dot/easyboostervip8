#!/usr/bin/env node

/**
 * Migration Script: Reset Free User Balances to 1 Coin
 * 
 * This script resets all free tier users' balances to 1 coin.
 * It's designed to be run once during deployment to adjust for the new free tier limit.
 * 
 * Usage: node reset-free-user-balances.js
 */

const db = require('./database');

async function resetFreeUserBalances() {
    console.log('🔄 Starting free user balance reset migration...\n');
    
    try {
        // Initialize database connection
        await db.initializeDatabase();
        
        // Get all users with free plan
        const allUsers = await db.getAllUsers();
        const freeUsers = allUsers.filter(user => user.plan === 'free');
        
        console.log(`📊 Found ${freeUsers.length} free tier users\n`);
        
        if (freeUsers.length === 0) {
            console.log('✅ No free users found. Migration complete.\n');
            process.exit(0);
        }
        
        let updated = 0;
        let skipped = 0;
        let errors = 0;
        
        for (const user of freeUsers) {
            try {
                // Skip users who already have 1 or less coins
                if (user.balance <= 1) {
                    console.log(`⏭️  Skipped user ${user.id} (${user.email}): already has ${user.balance} coin(s)`);
                    skipped++;
                    continue;
                }
                
                const oldBalance = user.balance;
                
                // Set balance to 1
                await db.setUserBalance(user.id, 1);
                
                // Add transaction record for transparency
                await db.addTransaction(user.id, {
                    type: 'debit',
                    category: 'adjustment',
                    description: 'Free Tier Adjustment',
                    details: `Balance adjusted from ${oldBalance} to 1 coin due to new free tier limit (1 request per day). Premium users enjoy unlimited requests!`,
                    amount: oldBalance - 1,
                    status: 'completed'
                });
                
                console.log(`✅ Updated user ${user.id} (${user.email}): ${oldBalance} → 1 coin`);
                updated++;
            } catch (error) {
                console.error(`❌ Error updating user ${user.id}:`, error.message);
                errors++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📈 Migration Summary:');
        console.log('='.repeat(60));
        console.log(`✅ Updated: ${updated} users`);
        console.log(`⏭️  Skipped: ${skipped} users (already at 1 or below)`);
        console.log(`❌ Errors: ${errors} users`);
        console.log('='.repeat(60) + '\n');
        
        if (errors > 0) {
            console.log('⚠️  Some users failed to update. Please check the errors above.\n');
            process.exit(1);
        } else {
            console.log('✅ Migration completed successfully!\n');
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run the migration
resetFreeUserBalances();
