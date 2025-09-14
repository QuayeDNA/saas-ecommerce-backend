// src/routes/pushNotificationRoutes.js
import express from "express";
import pushNotificationService from "../services/pushNotificationService.js";
import { authenticate } from "../middlewares/auth.js";
import logger from "../utils/logger.js";

const router = express.Router();

// Register push subscription
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    const userId = req.user.id;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription object",
      });
    }

    const success = await pushNotificationService.registerSubscription(
      userId,
      subscription
    );

    if (success) {
      res.json({
        success: true,
        message: "Push subscription registered successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to register push subscription",
      });
    }
  } catch (error) {
    logger.error("Error registering push subscription:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Unregister push subscription
router.post("/unsubscribe", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const success = await pushNotificationService.unregisterSubscription(
      userId
    );

    if (success) {
      res.json({
        success: true,
        message: "Push subscription unregistered successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to unregister push subscription",
      });
    }
  } catch (error) {
    logger.error("Error unregistering push subscription:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get VAPID public key (needed for frontend subscription)
router.get("/vapid-public-key", (req, res) => {
  try {
    if (!process.env.VAPID_PUBLIC_KEY) {
      return res.status(500).json({
        success: false,
        message: "VAPID keys not configured",
      });
    }

    res.json({
      success: true,
      publicKey: process.env.VAPID_PUBLIC_KEY,
    });
  } catch (error) {
    logger.error("Error getting VAPID public key:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Test push notification (for development)
router.post("/test", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title = "Test Notification",
      body = "This is a test push notification",
    } = req.body;

    const success = await pushNotificationService.sendToUser(userId, {
      title,
      body,
      url: "/dashboard",
    });

    res.json({
      success,
      message: success
        ? "Test notification sent"
        : "Failed to send test notification",
    });
  } catch (error) {
    logger.error("Error sending test notification:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
