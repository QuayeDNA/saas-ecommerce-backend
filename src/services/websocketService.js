// src/services/websocketService.js
import { WebSocketServer } from 'ws';
import logger from '../utils/logger.js';

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of userId -> WebSocket connection
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server });
    
    this.wss.on('connection', (ws, req) => {
      logger.info('WebSocket client connected');
      
      // Extract user ID from query params or headers
      const url = new URL(req.url, 'http://localhost');
      const userId = url.searchParams.get('userId');
      
      if (userId) {
        this.clients.set(userId, ws);
        logger.info(`WebSocket client registered for user: ${userId}`);
      }
      
      ws.on('close', () => {
        // Remove client when connection closes
        for (const [clientUserId, clientWs] of this.clients.entries()) {
          if (clientWs === ws) {
            this.clients.delete(clientUserId);
            logger.info(`WebSocket client disconnected for user: ${clientUserId}`);
            break;
          }
        }
      });
      
      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });
    });
    
    logger.info('WebSocket server initialized');
  }

  // Send notification to specific user
  sendNotificationToUser(userId, notification) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      try {
        ws.send(JSON.stringify({
          type: 'notification',
          data: notification
        }));
        logger.info(`Notification sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(`Failed to send WebSocket notification to user ${userId}:`, error);
      }
    }
  }

  // Send wallet update to specific user
  sendWalletUpdateToUser(userId, walletData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      try {
        ws.send(JSON.stringify({
          type: 'wallet_update',
          userId: userId,
          balance: walletData.balance,
          recentTransactions: walletData.recentTransactions
        }));
        logger.info(`Wallet update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(`Failed to send WebSocket wallet update to user ${userId}:`, error);
      }
    }
  }

  // Send wallet update with message to specific user
  sendToUser(userId, walletUpdateData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      try {
        ws.send(JSON.stringify(walletUpdateData));
        logger.info(`Wallet update with message sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(`Failed to send WebSocket wallet update to user ${userId}:`, error);
      }
    }
  }

  // Send order update to specific user
  sendOrderUpdateToUser(userId, orderData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      try {
        ws.send(JSON.stringify({
          type: 'order_update',
          data: orderData
        }));
        logger.info(`Order update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(`Failed to send WebSocket order update to user ${userId}:`, error);
      }
    }
  }

  // Send transaction update to specific user
  sendTransactionUpdateToUser(userId, transactionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      try {
        ws.send(JSON.stringify({
          type: 'transaction_update',
          data: transactionData
        }));
        logger.info(`Transaction update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(`Failed to send WebSocket transaction update to user ${userId}:`, error);
      }
    }
  }

  // Send notification to multiple users
  sendNotificationToUsers(userIds, notification) {
    userIds.forEach(userId => {
      this.sendNotificationToUser(userId, notification);
    });
  }

  // Broadcast to all connected clients
  broadcast(notification) {
    this.clients.forEach((ws, userId) => {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({
            type: 'notification',
            data: notification
          }));
        } catch (error) {
          logger.error(`Failed to broadcast to user ${userId}:`, error);
        }
      }
    });
  }

  // Get connected clients count
  getConnectedClientsCount() {
    return this.clients.size;
  }
}

export default new WebSocketService(); 