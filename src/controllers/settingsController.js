import settingsService from "../services/settingsService.js";
import logger from "../utils/logger.js";

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
      const {
        isSiteOpen,
        customMessage,
        greetingText,
        welcomeMessage,
        showGreetingIcon,
      } = req.body;
      const settings = await settingsService.updateSiteSettings({
        isSiteOpen,
        customMessage,
        greetingText,
        welcomeMessage,
        showGreetingIcon,
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

  async getSignupApprovalSetting(req, res) {
    try {
      const requireApproval = await settingsService.getSignupApprovalSetting();
      res.json({ requireApprovalForSignup: requireApproval });
    } catch (error) {
      logger.error("Error getting signup approval setting:", error);
      res.status(500).json({ error: "Failed to get signup approval setting" });
    }
  }

  async updateSignupApprovalSetting(req, res) {
    try {
      const { requireApprovalForSignup } = req.body;
      const result = await settingsService.updateSignupApprovalSetting(
        requireApprovalForSignup,
      );
      res.json(result);
    } catch (error) {
      logger.error("Error updating signup approval setting:", error);
      res
        .status(500)
        .json({ error: "Failed to update signup approval setting" });
    }
  }

  // Storefront Auto-Approval
  async getAutoApproveStorefronts(req, res) {
    try {
      const autoApprove = await settingsService.getAutoApproveStorefronts();
      res.json({ autoApproveStorefronts: autoApprove });
    } catch (error) {
      logger.error("Error getting auto-approve storefronts setting:", error);
      res
        .status(500)
        .json({ error: "Failed to get auto-approve storefronts setting" });
    }
  }

  async updateAutoApproveStorefronts(req, res) {
    try {
      const { autoApproveStorefronts } = req.body;
      const result = await settingsService.updateAutoApproveStorefronts(
        autoApproveStorefronts,
      );
      res.json(result);
    } catch (error) {
      logger.error("Error updating auto-approve storefronts setting:", error);
      res
        .status(500)
        .json({ error: "Failed to update auto-approve storefronts setting" });
    }
  }

  async toggleStorefrontsAvailability(req, res) {
    try {
      const result = await settingsService.toggleStorefrontsAvailability();
      res.json(result);
    } catch (error) {
      logger.error("Error toggling storefront availability:", error);
      res
        .status(500)
        .json({ error: "Failed to toggle storefront availability" });
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
      const {
        telecelApiKey,
        airtelTigoApiKey,
        apiEndpoint,
        // Paystack
        paystackEnabled,
        paystackWalletTopUpEnabled,
        paystackStorefrontEnabled,
      } = req.body;

      const settings = await settingsService.updateApiSettings({
        telecelApiKey,
        airtelTigoApiKey,
        apiEndpoint,
        // Paystack
        paystackEnabled,
        paystackWalletTopUpEnabled,
        paystackStorefrontEnabled,
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
        newPassword,
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
        greetingText: siteSettings.greetingText,
        welcomeMessage: siteSettings.welcomeMessage,
        showGreetingIcon: siteSettings.showGreetingIcon,
        storefrontsOpen: siteSettings.storefrontsOpen,
        storefrontsClosedMessage: siteSettings.storefrontsClosedMessage,
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
      const userId = req.user?.userId || req.user?.id; // Get current admin's ID
      const result = await settingsService.changeAdminPassword(
        userId,
        currentPassword,
        newPassword,
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
      const { minimumTopUpAmounts, paystackMinimumTopUpAmount } = req.body;
      const settings = await settingsService.updateWalletSettings({
        minimumTopUpAmounts,
        paystackMinimumTopUpAmount,
      });
      res.json(settings);
    } catch (error) {
      logger.error("Error updating wallet settings:", error);
      res.status(500).json({ error: "Failed to update wallet settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // Payout Settings
  // ---------------------------------------------------------------------------
  async getPayoutSettings(req, res) {
    try {
      const settings = await settingsService.getPayoutSettings();
      res.json(settings);
    } catch (error) {
      logger.error("Error getting payout settings:", error);
      res.status(500).json({ error: "Failed to get payout settings" });
    }
  }

  async updatePayoutSettings(req, res) {
    try {
      const { minimumPayoutAmounts } = req.body;
      const settings = await settingsService.updatePayoutSettings({
        minimumPayoutAmounts,
      });
      res.json(settings);
    } catch (error) {
      logger.error("Error updating payout settings:", error);
      res.status(500).json({ error: "Failed to update payout settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // Transaction Fee Settings
  // ---------------------------------------------------------------------------
  async getFeeSettings(req, res) {
    try {
      const settings = await settingsService.getFeeSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting fee settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get fee settings" });
    }
  }

  async updateFeeSettings(req, res) {
    try {
      const settings = await settingsService.updateFeeSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating fee settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update fee settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // Referral & Commission Settings
  // ---------------------------------------------------------------------------
  async getReferralSettings(req, res) {
    try {
      const settings = await settingsService.getReferralSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting referral settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get referral settings" });
    }
  }

  async updateReferralSettings(req, res) {
    try {
      const settings = await settingsService.updateReferralSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating referral settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update referral settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // BryteLinks — Storefront Payment Gate & Auto-Suspend Settings
  // ---------------------------------------------------------------------------
  async getBryteLinksSettings(req, res) {
    try {
      const settings = await settingsService.getBryteLinksSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting BryteLinks settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get BryteLinks settings" });
    }
  }

  async updateBryteLinksSettings(req, res) {
    try {
      const settings = await settingsService.updateBryteLinksSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating BryteLinks settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update BryteLinks settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // MoMo Bridge — Mobile Money Payment Verification
  // ---------------------------------------------------------------------------
  async getMomoBridgeSettings(req, res) {
    try {
      const settings = await settingsService.getMomoBridgeSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting MoMo Bridge settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get MoMo Bridge settings" });
    }
  }

  async updateMomoBridgeSettings(req, res) {
    try {
      const settings = await settingsService.updateMomoBridgeSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating MoMo Bridge settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update MoMo Bridge settings" });
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-App Wallet Transfer — Agent Self-Service
  // ---------------------------------------------------------------------------
  async getCrossAppTransferSettings(req, res) {
    try {
      const settings = await settingsService.getCrossAppTransferSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting cross-app wallet transfer settings:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get cross-app wallet transfer settings",
      });
    }
  }

  async updateCrossAppTransferSettings(req, res) {
    try {
      const settings =
        await settingsService.updateCrossAppTransferSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating cross-app wallet transfer settings:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update cross-app wallet transfer settings",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // MTN Order Restriction
  // ---------------------------------------------------------------------------
  async getMtnRestrictionSettings(req, res) {
    try {
      const settings = await settingsService.getMtnRestrictionSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error getting MTN restriction settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get MTN restriction settings" });
    }
  }

  async updateMtnRestrictionSettings(req, res) {
    try {
      const settings = await settingsService.updateMtnRestrictionSettings(req.body);
      res.json({ success: true, data: settings });
    } catch (error) {
      logger.error("Error updating MTN restriction settings:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to update MTN restriction settings" });
    }
  }

  async importMtnNumbers(req, res) {
    try {
      const result = await settingsService.importMtnNumbers(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error("Error importing MTN numbers:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to import MTN numbers" });
    }
  }

  async getMtnNumberStats(req, res) {
    try {
      const data = await settingsService.getMtnNumberStats();
      res.json({ success: true, data });
    } catch (error) {
      logger.error("Error getting MTN number stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to get MTN number stats" });
    }
  }

  async listMtnNumbers(req, res) {
    try {
      const { page = 1, limit = 20, search = "" } = req.query;
      const result = await settingsService.listMtnNumbers(
        parseInt(page, 10),
        parseInt(limit, 10),
        search,
      );
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async addMtnNumber(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
      }
      const result = await settingsService.addMtnNumber(phone);
      res.status(201).json({ success: true, number: result });
    } catch (error) {
      const status = error.message.includes("Invalid") ? 400 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async deleteMtnNumber(req, res) {
    try {
      const { id } = req.params;
      await settingsService.deleteMtnNumber(id);
      res.json({ success: true, message: "Number removed from known list" });
    } catch (error) {
      const status = error.message === "Known number not found" ? 404 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async bulkDeleteMtnNumbers(req, res) {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "IDs array is required" });
      }
      const result = await settingsService.bulkDeleteMtnNumbers(ids);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Integration Key — Cross-App API Authentication
  // ---------------------------------------------------------------------------

  async getIntegrationKey(req, res) {
    try {
      const result = await settingsService.getIntegrationKey();
      res.json(result || { keyPreview: null });
    } catch (error) {
      logger.error("Error getting integration key:", error);
      res.status(500).json({ error: "Failed to get integration key" });
    }
  }

  async regenerateIntegrationKey(req, res) {
    try {
      const rawKey = await settingsService.generateIntegrationKey();
      res.json({
        key: rawKey,
        message: "Save this key — it will not be shown again",
      });
    } catch (error) {
      logger.error("Error regenerating integration key:", error);
      res.status(500).json({ error: "Failed to regenerate integration key" });
    }
  }

  // ---------------------------------------------------------------------------
  // Connected Apps — Cross-App Connections
  // ---------------------------------------------------------------------------

  async getConnectedApps(req, res) {
    try {
      const apps = await settingsService.getConnectedApps();
      res.json({ success: true, data: apps });
    } catch (error) {
      logger.error("Error getting connected apps:", error);
      res.status(500).json({ error: "Failed to get connected apps" });
    }
  }

  async addConnectedApp(req, res) {
    try {
      const newApp = await settingsService.addConnectedApp(req.body);
      res.json({ success: true, data: newApp, message: "Connected app added" });
    } catch (error) {
      logger.error("Error adding connected app:", error);
      res.status(500).json({ error: "Failed to add connected app" });
    }
  }

  async updateConnectedApp(req, res) {
    try {
      const updatedApp = await settingsService.updateConnectedApp(
        req.params.appId,
        req.body,
      );
      res.json({ success: true, data: updatedApp });
    } catch (error) {
      logger.error("Error updating connected app:", error);
      res.status(500).json({ error: "Failed to update connected app" });
    }
  }

  async removeConnectedApp(req, res) {
    try {
      await settingsService.removeConnectedApp(req.params.appId);
      res.json({ success: true, message: "Connected app removed" });
    } catch (error) {
      logger.error("Error removing connected app:", error);
      res.status(500).json({ error: "Failed to remove connected app" });
    }
  }

  async testConnectedApp(req, res) {
    try {
      const result = await settingsService.testConnectedApp(req.params.appId);
      res.json(result);
    } catch (error) {
      logger.error("Error testing connected app:", error);
      res.status(500).json({ error: "Failed to test connected app" });
    }
  }
}

export default new SettingsController();
