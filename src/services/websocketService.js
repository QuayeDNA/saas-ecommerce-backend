// src/services/websocketService.js
import { WebSocketServer } from "ws";
import logger from "../utils/logger.js";

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of userId -> WebSocket connection
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws, req) => {
      logger.info("WebSocket client connected");

      // Extract user ID from query params or headers
      const url = new URL(req.url, "http://localhost");
      const userId = url.searchParams.get("userId");

      if (userId) {
        this.clients.set(userId, ws);
        logger.info(`WebSocket client registered for user: ${userId}`);
        console.log(
          `📡 WebSocket registered: userId=${userId}, Total clients: ${this.clients.size}`
        );
      } else {
        logger.warn("WebSocket connection without userId");
      }

      ws.on("close", () => {
        // Remove client when connection closes
        for (const [clientUserId, clientWs] of this.clients.entries()) {
          if (clientWs === ws) {
            this.clients.delete(clientUserId);
            logger.info(
              `WebSocket client disconnected for user: ${clientUserId}`
            );
            console.log(
              `📡 WebSocket disconnected: userId=${clientUserId}, Total clients: ${this.clients.size}`
            );
            break;
          }
        }
      });

      ws.on("error", (error) => {
        logger.error("WebSocket error:", error);
      });
    });

    logger.info("WebSocket server initialized");
  }

  // Send notification to specific user
  sendNotificationToUser(userId, notification) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "notification",
            data: notification,
          })
        );
        logger.info(`Notification sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(
          `Failed to send WebSocket notification to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send wallet update to specific user
  sendWalletUpdateToUser(userId, walletData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "wallet_update",
            userId: userId,
            balance: walletData.balance,
            recentTransactions: walletData.recentTransactions,
          })
        );
        logger.info(`Wallet update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(
          `Failed to send WebSocket wallet update to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send wallet update with message to specific user
  sendToUser(userId, walletUpdateData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(JSON.stringify(walletUpdateData));
        logger.info(
          `Wallet update with message sent to user ${userId} via WebSocket`
        );
      } catch (error) {
        logger.error(
          `Failed to send WebSocket wallet update to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send order update to specific user
  sendOrderUpdateToUser(userId, orderData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "order_update",
            data: orderData,
          })
        );
        logger.info(`Order update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(
          `Failed to send WebSocket order update to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send commission update to specific user
  sendCommissionUpdateToUser(userId, commissionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "commission_update",
            commission: commissionData,
          })
        );
        logger.info(`Commission update sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(
          `Failed to send WebSocket commission update to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send commission creation notification to agent
  sendCommissionCreatedToUser(userId, commissionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "commission_created",
            commission: commissionData,
          })
        );
        logger.info(
          `Commission created notification sent to user ${userId} via WebSocket`
        );
      } catch (error) {
        logger.error(
          `Failed to send WebSocket commission created to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send commission payment notification to agent
  sendCommissionPaidToUser(userId, commissionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      try {
        ws.send(
          JSON.stringify({
            type: "commission_paid",
            commission: commissionData,
          })
        );
        logger.info(
          `Commission paid notification sent to user ${userId} via WebSocket`
        );
      } catch (error) {
        logger.error(
          `Failed to send WebSocket commission paid to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send commission real-time update notification (for accumulating commissions)
  sendCommissionUpdatedToUser(userId, commissionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(
          JSON.stringify({
            type: "commission_updated",
            commission: commissionData,
          })
        );
        logger.info(
          `Commission updated notification sent to user ${userId} via WebSocket`
        );
      } catch (error) {
        logger.error(
          `Failed to send WebSocket commission updated to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send commission finalization notification (month-end)
  sendCommissionFinalizedToUser(userId, commissionData) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(
          JSON.stringify({
            type: "commission_finalized",
            commission: commissionData,
          })
        );
        logger.info(
          `Commission finalized notification sent to user ${userId} via WebSocket`
        );
      } catch (error) {
        logger.error(
          `Failed to send WebSocket commission finalized to user ${userId}:`,
          error
        );
      }
    }
  }

  // Send notification to multiple users
  sendNotificationToUsers(userIds, notification) {
    userIds.forEach((userId) => {
      this.sendNotificationToUser(userId, notification);
    });
  }

  // Broadcast to all connected clients
  broadcast(notification) {
    this.clients.forEach((ws, userId) => {
      if (ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "notification",
              data: notification,
            })
          );
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

  // Send announcement to specific user
  sendAnnouncementToUser(userId, announcement) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(
          JSON.stringify({
            type: "announcement",
            data: announcement,
          })
        );
        logger.info(`Announcement sent to user ${userId} via WebSocket`);
      } catch (error) {
        logger.error(
          `Failed to send WebSocket announcement to user ${userId}:`,
          error
        );
      }
    }
  }

  // Broadcast announcement to specific list of users
  broadcastAnnouncementToAll(announcement, userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      logger.warn("No user IDs provided for announcement broadcast");
      return;
    }

    console.log(`Broadcasting announcement to ${userIds.length} users`);
    console.log(`Current WebSocket clients connected: ${this.clients.size}`);
    console.log(`Connected user IDs:`, Array.from(this.clients.keys()));

    let successCount = 0;
    let failCount = 0;

    userIds.forEach((userId) => {
      const ws = this.clients.get(userId.toString());
      console.log(
        `Checking WebSocket for user ${userId}: ${
          ws ? "FOUND" : "NOT FOUND"
        }, readyState: ${ws?.readyState}`
      );

      if (ws && ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "announcement",
              data: announcement,
            })
          );
          console.log(`✅ Announcement sent to user ${userId}`);
          successCount++;
        } catch (error) {
          console.error(
            `❌ Failed to send announcement to user ${userId}:`,
            error
          );
          failCount++;
        }
      } else {
        console.log(`⚠️ No active WebSocket connection for user ${userId}`);
        failCount++;
      }
    });

    logger.info(
      `Announcement broadcast completed: ${successCount} successful, ${failCount} failed out of ${userIds.length} target users`
    );
  }

  // Broadcast new order to all super admins
  broadcastOrderCreatedToAdmins(orderData, superAdminIds) {
    if (!Array.isArray(superAdminIds) || superAdminIds.length === 0) {
      logger.warn("No super admin IDs provided for order broadcast");
      return;
    }

    let successCount = 0;
    superAdminIds.forEach((adminId) => {
      const ws = this.clients.get(adminId.toString());
      if (ws && ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "order_created",
              data: orderData,
            })
          );
          successCount++;
        } catch (error) {
          logger.error(
            `Failed to send order creation to admin ${adminId}:`,
            error
          );
        }
      }
    });

    logger.info(
      `Order creation broadcast to ${successCount} of ${superAdminIds.length} admins`
    );
  }

  // Send order status update to user and all super admins
  broadcastOrderStatusUpdate(orderData, userId, superAdminIds = []) {
    // Send to order creator
    this.sendOrderUpdateToUser(userId.toString(), orderData);

    // Send to all super admins
    superAdminIds.forEach((adminId) => {
      const ws = this.clients.get(adminId.toString());
      if (ws && ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "order_status_updated",
              data: orderData,
            })
          );
        } catch (error) {
          logger.error(
            `Failed to send order status update to admin ${adminId}:`,
            error
          );
        }
      }
    });

    logger.info(
      `Order status update sent to user ${userId} and ${superAdminIds.length} admins`
    );
  }

  // Broadcast site status update to all connected clients
  broadcastSiteStatusUpdate(siteStatus) {
    this.clients.forEach((ws, userId) => {
      if (ws.readyState === 1) {
        try {
          ws.send(
            JSON.stringify({
              type: "site_status_update",
              data: siteStatus,
            })
          );
        } catch (error) {
          logger.error(`Failed to broadcast site status to user ${userId}:`, error);
        }
      }
    });

    logger.info(`Site status update broadcasted to all connected clients:`, siteStatus);
  }
}

export default new WebSocketService();
