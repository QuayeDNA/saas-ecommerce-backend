# Notification System Setup Guide

## Overview
This notification system provides both in-app notifications and WhatsApp integration for real-time updates on wallet top-ups and order status changes.

## Features
- ✅ **In-App Notifications**: Real-time notifications in the dashboard
- ✅ **WhatsApp Integration**: External notifications via WhatsApp Business API
- ✅ **Auto-refresh**: Notifications update every 30 seconds
- ✅ **Read/Unread Management**: Mark individual or all notifications as read
- ✅ **Badge Count**: Shows unread notification count in header

## Environment Variables Required

Add these to your `.env` file:

```env
# WhatsApp Business API Configuration
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_TOKEN=your-whatsapp-business-api-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
```

## WhatsApp Business API Setup

1. **Create WhatsApp Business Account**:
   - Go to [Meta for Developers](https://developers.facebook.com/)
   - Create a new app or use existing app
   - Add WhatsApp Business API product

2. **Get Access Token**:
   - In your app dashboard, go to WhatsApp > Getting Started
   - Generate a permanent access token
   - Copy the token to `WHATSAPP_TOKEN`

3. **Get Phone Number ID**:
   - Add a phone number to your WhatsApp Business account
   - Note the Phone Number ID from the dashboard
   - Copy to `WHATSAPP_PHONE_NUMBER_ID`

4. **Test WhatsApp Integration**:
   - Send a test message using the API
   - Verify message delivery

## Notification Types

### Wallet Notifications
- **Top-up Approved**: When admin approves wallet top-up request
- **Top-up Rejected**: When admin rejects wallet top-up request
- **Balance Updates**: When wallet balance changes

### Order Notifications
- **Status Updates**: Order status changes (confirmed, processing, completed, failed)
- **Bulk Order Progress**: Progress updates for bulk orders (25%, 50%, 75%, 100%)
- **Processing Started**: When order processing begins
- **Completion**: When order is fully completed

## API Endpoints

### GET /api/notifications/unread
Get user's unread notifications
```json
{
  "success": true,
  "notifications": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "skip": 0
  }
}
```

### PATCH /api/notifications/:id/read
Mark specific notification as read
```json
{
  "success": true,
  "notification": {...}
}
```

### PATCH /api/notifications/read-all
Mark all notifications as read
```json
{
  "success": true,
  "message": "All notifications marked as read"
}
```

### GET /api/notifications/count
Get unread notification count
```json
{
  "success": true,
  "count": 5
}
```

## Frontend Integration

The notification system is automatically integrated into the header with:
- Notification bell icon with badge count
- Dropdown with notification list
- Mark as read functionality
- Auto-refresh every 30 seconds

## Testing

1. **Test Wallet Notifications**:
   - Create a wallet top-up request
   - Approve/reject as admin
   - Check for notifications

2. **Test Order Notifications**:
   - Create an order
   - Update order status
   - Check for notifications

3. **Test WhatsApp**:
   - Ensure phone number is in user profile
   - Trigger notifications
   - Check WhatsApp delivery

## Troubleshooting

### WhatsApp Not Working
- Verify environment variables are set
- Check WhatsApp Business API credentials
- Ensure phone numbers are in correct format (+233...)
- Check API rate limits

### In-App Notifications Not Showing
- Check browser console for errors
- Verify API endpoints are accessible
- Check authentication token is valid

### Auto-refresh Not Working
- Check network connectivity
- Verify user is authenticated
- Check for JavaScript errors

## Security Considerations

1. **WhatsApp Token**: Keep your WhatsApp token secure
2. **Rate Limiting**: WhatsApp has rate limits - monitor usage
3. **Phone Numbers**: Validate phone numbers before sending
4. **User Privacy**: Only send notifications to authenticated users

## Performance Optimization

1. **Database Indexes**: Already configured for fast queries
2. **Caching**: Consider Redis for high-traffic scenarios
3. **Batch Processing**: For bulk notifications
4. **WebSocket**: For real-time updates (future enhancement) 