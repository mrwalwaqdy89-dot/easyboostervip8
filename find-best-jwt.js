const fetch = require('node-fetch');

// JWT tokens from server.js
const jwtTokens = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MTAxM2FjNDVkZTZhNzM0YWUyNTgxYyIsImlhdCI6MTc2MzkxMTcwMCwiZXhwIjoxNzY0NTE2NTAwfQ.LemcJxuc8fmXytsZ5xT1Wa26pCBBm6cljkJtZTHAYiU',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MTI0YTQ3MTJhOTExMWY5ODI3OGVjMyIsImlhdCI6MTc2MzkxMTU1MSwiZXhwIjoxNzY0NTE2MzUxfQ.Fgy6dU0kS1azor11g_6R63KnOHuBKMkYyFyIlIwPLjQ',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MTEzN2EzMTJhOTExMWY5ODI3NmVjNiIsImlhdCI6MTc2MzkxMTI2MiwiZXhwIjoxNzY0NTE2MDYyfQ.9JyfIw847lSpdVQGClLsrFtA8M4xklh-qnle2zEaskE',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MjMyNWQ4MmQ2ZjZlMDMyMDkyMjJiYSIsImlhdCI6MTc2MzkxMTEyOCwiZXhwIjoxNzY0NTE1OTI4fQ.QSjBJCso39inWxqYxT0SxrEiJGrRwGda_-XC5tB9w9M',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5MjMyNDFhMmQ2ZjZlMDMyMDkyMjIzNSIsImlhdCI6MTc2MzkxMDc1MCwiZXhwIjoxNzY0NTE1NTUwfQ.BMHpzOrQv0meXXJOS6TkrJkQlt1N88EgoMNNK05-8aw'
];

// Function to test a single JWT token
async function testToken(token, index) {
    const backendUrl = 'https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/channel/react-to-post';
    const channelLink = 'https://whatsapp.com/channel/0029VaZeJYPHQbS6E7WOCs2H/21001';
    const emojis = ['❤️'];

    console.log(`\n🔍 Testing JWT #${index + 1}...`);
    console.log(`🔑 Token (last 15 chars): ...${token.substring(token.length - 15)}`);

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'authority': 'foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app',
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'ar-AE,ar;q=0.9,fr-MA;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
                'content-type': 'application/json',
                'cookie': `jwt=${token}`,
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
            body: JSON.stringify({
                post_link: channelLink,
                reacts: emojis
            })
        });

        const data = await response.json();

        if (response.status === 402) {
            console.log(`❌ JWT #${index + 1}: Insufficient coins`);
            console.log(`   Message: ${data.message}`);
            return { index, token, status: 'insufficient_coins', hasCoins: false };
        } else if (response.ok) {
            console.log(`✅ JWT #${index + 1}: SUCCESS! Has coins and working!`);
            console.log(`   Response: ${JSON.stringify(data)}`);
            return { index, token, status: 'success', hasCoins: true };
        } else {
            console.log(`⚠️  JWT #${index + 1}: Error ${response.status}`);
            console.log(`   Message: ${data.message || 'Unknown error'}`);
            return { index, token, status: 'error', hasCoins: false };
        }

    } catch (error) {
        console.log(`💥 JWT #${index + 1}: Failed - ${error.message}`);
        return { index, token, status: 'failed', hasCoins: false };
    }
}

// Test all tokens
async function testAllTokens() {
    console.log('🚀 Testing all JWT tokens...\n');
    console.log('=' .repeat(60));

    const results = [];
    
    for (let i = 0; i < jwtTokens.length; i++) {
        const result = await testToken(jwtTokens[i], i);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between tests
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 SUMMARY:\n');

    const workingTokens = results.filter(r => r.hasCoins);
    
    if (workingTokens.length > 0) {
        console.log(`✅ Found ${workingTokens.length} working token(s) with coins:\n`);
        workingTokens.forEach(t => {
            console.log(`   JWT #${t.index + 1}: ...${t.token.substring(t.token.length - 15)}`);
        });
        
        console.log('\n🎯 BEST JWT TOKEN TO USE:');
        console.log(`\n'${workingTokens[0].token}'\n`);
        
        return workingTokens[0].token;
    } else {
        console.log('❌ No working tokens with coins found!');
        console.log('\n💡 All tokens have insufficient coins. You may need to:');
        console.log('   1. Get new JWT tokens from accounts with coins');
        console.log('   2. Add coins to existing accounts');
        return null;
    }
}

// Run the test
testAllTokens()
    .then((bestToken) => {
        if (bestToken) {
            console.log('✨ Testing complete! Use the token shown above.');
        }
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Error:', error);
        process.exit(1);
    });
