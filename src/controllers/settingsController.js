import settingsService from "../services/settingsService.js";
import logger from "../utils/logger.js";
import { cleanupAllTestUserData } from "../jobs/testUserCleanup.js";

// =============================================================================
// SETTINGS CONTROLLER
// =============================================================================

class SettingsController {
  // Site Management
  async getSiteSettings(req, res) {
    try {
      const settings = await settingsService.getSiteSettings();
      res.json(settings);
    } catch (error) {
      logger.error("Error getting site settings:", error);
      res.status(500).json({ error: "Failed to get site settings" });
    }
  }

  async updateSiteSettings(req, res) {
    try {
      const { isSiteOpen, customMessage } = req.body;
      const settings = await settingsService.updateSiteSettings({
        isSiteOpen,
        customMessage,
      });
      res.json(settings);
    } catch (error) {
      logger.error("Error updating site settings:", error);
      res.status(500).json({ error: "Failed to update site settings" });
    }
  }

  async toggleSiteStatus(req, res) {
    try {
      const result = await settingsService.toggleSiteStatus();
      res.json(result);
    } catch (error) {
      logger.error("Error toggling site status:", error);
      res.status(500).json({ error: "Failed to toggle site status" });
    }
  }

  // Commission Rates
  async getCommissionRates(req, res) {
    try {
      const rates = await settingsService.getCommissionRates();
      res.json(rates);
    } catch (error) {
      logger.error("Error getting commission rates:", error);
      res.status(500).json({ error: "Failed to get commission rates" });
    }
  }

  async updateCommissionRates(req, res) {
    try {
      const {
        agentCommission,
        superAgentCommission,
        dealerCommission,
        superDealerCommission,
        defaultCommissionRate,
        customerCommission,
      } = req.body;
      const rates = await settingsService.updateCommissionRates({
        agentCommission,
        superAgentCommission,
        dealerCommission,
        superDealerCommission,
        defaultCommissionRate,
        customerCommission,
      });
      res.json(rates);
    } catch (error) {
      logger.error("Error updating commission rates:", error);
      res.status(500).json({ error: "Failed to update commission rates" });
    }
  }

  // API Settings
  async getApiSettings(req, res) {
    try {
      const settings = await settingsService.getApiSettings();
      res.json(settings);
    } catch (error) {
      logger.error("Error getting API settings:", error);
      res.status(500).json({ error: "Failed to get API settings" });
    }
  }

  async updateApiSettings(req, res) {
    try {
      const { mtnApiKey, telecelApiKey, airtelTigoApiKey, apiEndpoint } =
        req.body;
      const settings = await settingsService.updateApiSettings({
        mtnApiKey,
        telecelApiKey,
        airtelTigoApiKey,
        apiEndpoint,
      });
      res.json(settings);
    } catch (error) {
      logger.error("Error updating API settings:", error);
      res.status(500).json({ error: "Failed to update API settings" });
    }
  }

  // User Management
  async resetUserPassword(req, res) {
    try {
      const { userId, newPassword } = req.body;
      const result = await settingsService.resetUserPassword(
        userId,
        newPassword
      );
      res.json(result);
    } catch (error) {
      logger.error("Error resetting user password:", error);
      res.status(500).json({ error: "Failed to reset user password" });
    }
  }

  async changeUserRole(req, res) {
    try {
      const { userId, newRole } = req.body;
      const result = await settingsService.changeUserRole(userId, newRole);
      res.json(result);
    } catch (error) {
      logger.error("Error changing user role:", error);
      res.status(500).json({ error: "Failed to change user role" });
    }
  }

  // System Information
  async getSystemInfo(req, res) {
    try {
      const info = await settingsService.getSystemInfo();
      res.json(info);
    } catch (error) {
      logger.error("Error getting system info:", error);
      res.status(500).json({ error: "Failed to get system info" });
    }
  }

  // Get site status (public endpoint)
  async getSiteStatus(req, res) {
    try {
      const siteSettings = await settingsService.getSiteSettings();
      res.json({
        isSiteOpen: siteSettings.isSiteOpen,
        customMessage: siteSettings.customMessage,
      });
    } catch (error) {
      logger.error("Error getting site status:", error);
      res.status(500).json({ error: "Failed to get site status" });
    }
  }

  // Admin Password Change
  async changeAdminPassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id; // Get current admin's ID
      const result = await settingsService.changeAdminPassword(
        userId,
        currentPassword,
        newPassword
      );
      res.json(result);
    } catch (error) {
      logger.error("Error changing admin password:", error);
      res.status(500).json({ error: "Failed to change admin password" });
    }
  }

  // Wallet Settings
  async getWalletSettings(req, res) {
    try {
      const settings = await settingsService.getWalletSettings();
      res.json(settings);
    } catch (error) {
      logger.error("Error getting wallet settings:", error);
      res.status(500).json({ error: "Failed to get wallet settings" });
    }
  }

  async updateWalletSettings(req, res) {
    try {
      const { minimumTopUpAmounts } = req.body;
      const settings = await settingsService.updateWalletSettings({
        minimumTopUpAmounts,
      });
      res.json(settings);
    } catch (error) {
      logger.error("Error updating wallet settings:", error);
      res.status(500).json({ error: "Failed to update wallet settings" });
    }
  }

  // Test User Cleanup
  async cleanupTestUser(req, res) {
    try {
      const TEST_USER_ID = "689bae9e81b90ad7c5ad66d4";
      const userId = req.user.id || req.user._id;
      const isSuperAdmin = req.user.userType === "super_admin";
      const isTestUser = userId.toString() === TEST_USER_ID;

      // Only allow test user or super admin
      if (!isTestUser && !isSuperAdmin) {
        logger.warn(
          `Unauthorized cleanup attempt by ${req.user.email} (userType: "${req.user.userType}")`
        );
        return res.status(403).json({
          success: false,
          error: "Only the test user or super admin can trigger this cleanup",
        });
      }

      logger.info(
        `Manual test user cleanup triggered by ${req.user.email} (${
          isTestUser ? "test user" : "super admin"
        })`
      );
      const result = await cleanupAllTestUserData();
      res.json({
        success: true,
        message: "Test user data cleaned up successfully",
        ...result,
      });
    } catch (error) {
      logger.error("Error cleaning up test user data:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to cleanup test user data" });
    }
  }
}

export default new SettingsController();
