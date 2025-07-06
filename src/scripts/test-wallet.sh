#!/bin/bash

# This script initializes the database with an agent user who has wallet balance
# It's useful for development/testing

# Set environment variables
API_URL="http://localhost:5050"

# Register an agent
echo "Registering a test agent..."
AGENT_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/register-agent" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test Agent",
    "email": "testagent@example.com",
    "phone": "+233201234567",
    "password": "Password123!",
    "businessName": "Test Business",
    "businessCategory": "services",
    "subscriptionPlan": "basic"
  }')

echo "Agent registration response: $AGENT_RESPONSE"

# Verify the agent (bypass email verification)
echo "Getting the latest agent..."
AGENT_ID=$(curl -s -X GET "$API_URL/api/users?userType=agent&limit=1" \
  -H "Authorization: Bearer ADMIN_TOKEN_HERE" | grep -o '"_id":"[^"]*' | sed 's/"_id":"//')

echo "Agent ID: $AGENT_ID"

echo "Verifying the agent..."
curl -s -X PUT "$API_URL/api/users/$AGENT_ID/verify" \
  -H "Authorization: Bearer ADMIN_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "isVerified": true
  }'

# Log in as the agent to get token
echo "Logging in as agent..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testagent@example.com",
    "password": "Password123!"
  }')

echo "Login response: $LOGIN_RESPONSE"
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | sed 's/"token":"//')

echo "Agent token: $TOKEN"

# Check wallet balance
echo "Checking wallet balance..."
WALLET_RESPONSE=$(curl -s -X GET "$API_URL/api/wallet/info" \
  -H "Authorization: Bearer $TOKEN")

echo "Wallet balance: $WALLET_RESPONSE"

# Create a test order
echo "Creating a test order..."
ORDER_RESPONSE=$(curl -s -X POST "$API_URL/api/orders/single" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "packageGroupId": "YOUR_PACKAGE_ID_HERE",
    "packageItemId": "YOUR_PACKAGE_ITEM_ID_HERE",
    "customerPhone": "+233201234567",
    "quantity": 1
  }')

echo "Order response: $ORDER_RESPONSE"

# Check wallet balance again
echo "Checking wallet balance after order..."
WALLET_RESPONSE=$(curl -s -X GET "$API_URL/api/wallet/info" \
  -H "Authorization: Bearer $TOKEN")

echo "Updated wallet balance: $WALLET_RESPONSE"

echo "Test script completed!"
