// src/routes/pushNotificationRoutes.js
import express from "express";
import pushNotificationService from "../services/pushNotificationService.js";
import { authenticate } from "../middlewares/auth.js";
import logger from "../utils/logger.js";
import User from "../models/User.js";

const router = express.Router();

// Register push subscription
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { subscription, userAgent, platform } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription object",
      });
    }

    const meta = { userAgent, platform };
    const success = await pushNotificationService.registerSubscription(
      userId,
      subscription,
      meta,
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
    const { endpoint } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Endpoint is required",
      });
    }

    const success =
      await pushNotificationService.unregisterSubscription(userId, endpoint);

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

// Get push notification preferences
router.get("/preferences", authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const user = await User.findById(userId).select(
      "pushNotificationPreferences",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      preferences: user.pushNotificationPreferences || {
        enabled: true,
        orderUpdates: true,
        walletUpdates: true,
        announcements: true,
      },
    });
  } catch (error) {
    logger.error("Error getting push notification preferences:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Update push notification preferences
router.put("/preferences", authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== "object") {
      return res.status(400).json({
        success: false,
        message: "Invalid preferences object",
      });
    }

    const updateData = {};
    const allowedFields = [
      "enabled",
      "orderUpdates",
      "walletUpdates",
      "announcements",
      "apiUpdates",
    ];

    for (const field of allowedFields) {
      if (preferences[field] !== undefined) {
        updateData[`pushNotificationPreferences.${field}`] = preferences[field];
      }
    }

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "Push notification preferences updated successfully",
      preferences: user.pushNotificationPreferences,
    });
  } catch (error) {
    logger.error("Error updating push notification preferences:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get registered devices
router.get("/devices", authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const devices = await pushNotificationService.getDevices(userId);

    res.json({
      success: true,
      devices,
    });
  } catch (error) {
    logger.error("Error getting devices:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Remove a device
router.delete("/devices/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const removed = await pushNotificationService.removeDevice(
      userId,
      req.params.id,
    );

    if (!removed) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    res.json({
      success: true,
      message: "Device removed successfully",
    });
  } catch (error) {
    logger.error("Error removing device:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Test push notification (for development)
router.post("/test", authenticate, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
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
