// scripts/setupMtnSandbox.js
// Run this script to set up your MTN MoMo sandbox environment
// Usage: node scripts/setupMtnSandbox.js

import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const SANDBOX_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY;

if (!SUBSCRIPTION_KEY) {
  console.error('❌ MTN_SUBSCRIPTION_KEY not found in .env file');
  process.exit(1);
}

async function setupMtnSandbox() {
  console.log('🚀 Starting MTN MoMo Sandbox Setup...\n');

  try {
    // Step 1: Generate API User UUID
    const apiUserId = crypto.randomUUID();
    console.log('📝 Step 1: Creating API User');
    console.log(`   API User ID: ${apiUserId}`);

    try {
      await axios.post(
        `${SANDBOX_BASE_URL}/v1_0/apiuser`,
        {
          providerCallbackHost: 'webhook.site' // Use a public callback host for sandbox
        },
        {
          headers: {
            'X-Reference-Id': apiUserId,
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('   ✅ API User created successfully\n');
    } catch (error) {
      if (error.response?.status === 409) {
        console.log('   ℹ️  API User already exists (409) - continuing...\n');
      } else {
        throw error;
      }
    }

    // Step 2: Create API Key
    console.log('📝 Step 2: Creating API Key');
    const apiKeyResponse = await axios.post(
      `${SANDBOX_BASE_URL}/v1_0/apiuser/${apiUserId}/apikey`,
      {},
      {
        headers: {
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        }
      }
    );

    const apiKey = apiKeyResponse.data.apiKey;
    console.log(`   API Key: ${apiKey}`);
    console.log('   ✅ API Key created successfully\n');

    // Step 3: Test Authentication
    console.log('📝 Step 3: Testing Authentication');
    const auth = Buffer.from(`${apiUserId}:${apiKey}`).toString('base64');
    
    const tokenResponse = await axios.post(
      `${SANDBOX_BASE_URL}/collection/token/`,
      {},
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
        }
      }
    );

    console.log('   ✅ Authentication successful!');
    console.log(`   Access Token: ${tokenResponse.data.access_token.substring(0, 20)}...`);
    console.log(`   Token Type: ${tokenResponse.data.token_type}`);
    console.log(`   Expires In: ${tokenResponse.data.expires_in} seconds\n`);

    // Step 4: Display .env configuration
    console.log('🎉 Setup Complete! Add these to your .env file:\n');
    console.log('─'.repeat(60));
    console.log('# MTN MoMo Configuration (Sandbox)');
    console.log(`MTN_BASE_URL_SANDBOX=${SANDBOX_BASE_URL}`);
    console.log(`MTN_SUBSCRIPTION_KEY=${SUBSCRIPTION_KEY}`);
    console.log(`MTN_API_USER=${apiUserId}`);
    console.log(`MTN_API_KEY=${apiKey}`);
    console.log('MTN_CALLBACK_URL_SANDBOX=https://your-ngrok-url.ngrok.io/api/wallet/mtn-webhook');
    console.log('─'.repeat(60));
    console.log('\n📌 Important Notes:');
    console.log('   1. Use MTN test phone numbers: 46733123450 - 46733123459');
    console.log('   2. Sandbox currency is EUR (not GHS)');
    console.log('   3. Set up ngrok or a public URL for webhook callbacks');
    console.log('   4. Test amounts: Use small values like 100 EUR for testing');
    console.log('\n📞 Test the instant topup with this curl command:');
    console.log('─'.repeat(60));
    console.log('curl -X POST http://localhost:5050/api/wallet/instant-topup \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\');
    console.log('  -d \'{"phoneNumber": "46733123450", "amount": 100}\'');
    console.log('─'.repeat(60));

  } catch (error) {
    console.error('\n❌ Setup failed:');
    console.error('   Status:', error.response?.status);
    console.error('   Message:', error.response?.data || error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Verify your Subscription Key is for Collections product');
    console.error('   2. Check MTN Developer Portal: https://momodeveloper.mtn.com');
    console.error('   3. Ensure you have subscribed to Collections API');
    console.error('   4. Verify your account is active');
    process.exit(1);
  }
}

setupMtnSandbox();