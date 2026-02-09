import bcrypt from "bcrypt";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import logger from "../utils/logger.js";
import websocketService from "./websocketService.js";

// =============================================================================
// SETTINGS SERVICE
// =============================================================================

class SettingsService {
  // Site Management
  async getSiteSettings() {
    try {
      const settings = await Settings.getInstance();
      const result = {
        isSiteOpen: settings.isSiteOpen,
        customMessage: settings.customMessage,
      };

      return result;
    } catch (error) {
      logger.error(`Error getting site settings: ${error.message}`);
      throw error;
    }
  }

  async updateSiteSettings(settings) {
    const settingsDoc = await Settings.getInstance();
    settingsDoc.isSiteOpen = settings.isSiteOpen;
    settingsDoc.customMessage = settings.customMessage;
    await settingsDoc.save();

    logger.info("Site settings updated:", settings);
    return settings;
  }

  async toggleSiteStatus() {
    const settings = await Settings.getInstance();
    settings.isSiteOpen = !settings.isSiteOpen;
    await settings.save();

    const siteStatus = {
      isSiteOpen: settings.isSiteOpen,
      customMessage: settings.customMessage,
    };

    logger.info(
      `Site status toggled to: ${settings.isSiteOpen ? "open" : "closed"}`
    );

    // Broadcast the site status update to all connected clients
    websocketService.broadcastSiteStatusUpdate(siteStatus);

    return siteStatus;
  }

  async getSignupApprovalSetting() {
    try {
      const settings = await Settings.getInstance();
      return settings.requireApprovalForSignup;
    } catch (error) {
      logger.error(`Error getting signup approval setting: ${error.message}`);
      throw error;
    }
  }

  async updateSignupApprovalSetting(requireApproval) {
    try {
      const settings = await Settings.getInstance();
      settings.requireApprovalForSignup = requireApproval;
      await settings.save();

      logger.info(`Signup approval setting updated to: ${requireApproval}`);
      
      // Broadcast site status update to refresh frontend settings
      const siteStatus = {
        isSiteOpen: settings.isSiteOpen,
        customMessage: settings.customMessage,
      };
      websocketService.broadcastSiteStatusUpdate(siteStatus);
      
      return { requireApprovalForSignup: settings.requireApprovalForSignup };
    } catch (error) {
      logger.error(`Error updating signup approval setting: ${error.message}`);
      throw error;
    }
  }

  // Storefront auto-approval setting
  async getAutoApproveStorefronts() {
    try {
      const settings = await Settings.getInstance();
      return settings.autoApproveStorefronts;
    } catch (error) {
      logger.error(`Error getting auto-approve storefronts setting: ${error.message}`);
      throw error;
    }
  }

  async updateAutoApproveStorefronts(autoApprove) {
    try {
      const settings = await Settings.getInstance();
      settings.autoApproveStorefronts = autoApprove;
      await settings.save();

      logger.info(`Auto-approve storefronts setting updated to: ${autoApprove}`);
      return { autoApproveStorefronts: settings.autoApproveStorefronts };
    } catch (error) {
      logger.error(`Error updating auto-approve storefronts setting: ${error.message}`);
      throw error;
    }
  }

  // Get site status for middleware checks
  async isSiteOpen() {
    try {
      const settings = await Settings.getInstance();
      const isOpen = settings.isSiteOpen;

      return isOpen;
    } catch (error) {
      logger.error(`Error checking site status: ${error.message}`);
      // Return true as default to avoid blocking access during errors
      return true;
    }
  }

  // Commission Rates
  async getCommissionRates() {
    try {
      const settings = await Settings.getInstance();
      const result = {
        agentCommission: settings.agentCommission,
        superAgentCommission: settings.superAgentCommission,
        dealerCommission: settings.dealerCommission,
        superDealerCommission: settings.superDealerCommission,
        defaultCommissionRate: settings.defaultCommissionRate,
        customerCommission: settings.customerCommission,
      };

      return result;
    } catch (error) {
      logger.error(`Error getting commission rates: ${error.message}`);
      throw error;
    }
  }

  async updateCommissionRates(rates) {
    const settings = await Settings.getInstance();
    settings.agentCommission = rates.agentCommission;
    settings.superAgentCommission = rates.superAgentCommission;
    settings.dealerCommission = rates.dealerCommission;
    settings.superDealerCommission = rates.superDealerCommission;
    settings.defaultCommissionRate = rates.defaultCommissionRate;
    settings.customerCommission = rates.customerCommission;
    await settings.save();

    logger.info("Commission rates updated:", rates);
    return rates;
  }

  // API Settings
  async getApiSettings() {
    try {
      const settings = await Settings.getInstance();
      const result = {
        mtnApiKey: settings.mtnApiKey || process.env.MTN_API_KEY || "",
        telecelApiKey:
          settings.telecelApiKey || process.env.TELECEL_API_KEY || "",
        airtelTigoApiKey:
          settings.airtelTigoApiKey || process.env.AIRTELTIGO_API_KEY || "",
        apiEndpoint:
          settings.apiEndpoint ||
          process.env.API_ENDPOINT ||
          "https://api.telecomsaas.com",
      };

      return result;
    } catch (error) {
      logger.error(`Error getting API settings: ${error.message}`);
      throw error;
    }
  }

  async updateApiSettings(settings) {
    const settingsDoc = await Settings.getInstance();
    settingsDoc.mtnApiKey = settings.mtnApiKey;
    settingsDoc.telecelApiKey = settings.telecelApiKey;
    settingsDoc.airtelTigoApiKey = settings.airtelTigoApiKey;
    settingsDoc.apiEndpoint = settings.apiEndpoint;
    await settingsDoc.save();

    logger.info("API settings updated:", {
      ...settings,
      mtnApiKey: settings.mtnApiKey ? "[HIDDEN]" : "",
      telecelApiKey: settings.telecelApiKey ? "[HIDDEN]" : "",
      airtelTigoApiKey: settings.airtelTigoApiKey ? "[HIDDEN]" : "",
    });
    return settings;
  }

  // User Management
  async resetUserPassword(userId, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Hash the new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      user.password = hashedPassword;
      await user.save();

      logger.info(`Password reset for user: ${userId}`);
      return { message: "Password reset successfully" };
    } catch (error) {
      logger.error("Error resetting user password:", error);
      throw error;
    }
  }

  async changeUserRole(userId, newRole) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Validate role
      const validRoles = [
        "agent",
        "super_agent",
        "dealer",
        "super_dealer",
        "admin",
        "super_admin",
      ];
      if (!validRoles.includes(newRole)) {
        throw new Error("Invalid role");
      }

      // Update user role
      user.userType = newRole;
      await user.save();

      logger.info(`Role changed for user ${userId} to: ${newRole}`);
      return { message: "User role updated successfully" };
    } catch (error) {
      logger.error("Error changing user role:", error);
      throw error;
    }
  }

  // System Information
  async getSystemInfo() {
    try {
      // Get basic system information
      const info = {
        version: process.env.APP_VERSION || "1.0.0",
        lastUpdated: new Date().toISOString(),
        databaseStatus: "Connected", // TODO: Check actual DB connection
        apiStatus: "Healthy", // TODO: Check API health
        cacheStatus: "Active", // TODO: Check cache status
        sslStatus: "Valid", // TODO: Check SSL certificate
      };

      return info;
    } catch (error) {
      logger.error("Error getting system info:", error);
      throw error;
    }
  }

  // Admin Password Change
  async changeAdminPassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        currentPassword,
        user.password
      );
      if (!isCurrentPasswordValid) {
        throw new Error("Current password is incorrect");
      }

      // Hash the new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      user.password = hashedPassword;
      await user.save();

      logger.info(`Admin password changed for user: ${userId}`);
      return { message: "Admin password changed successfully" };
    } catch (error) {
      logger.error("Error changing admin password:", error);
      throw error;
    }
  }

  // Wallet Settings
  async getWalletSettings() {
    try {
      const settings = await Settings.getInstance();
      const result = {
        minimumTopUpAmounts: settings.minimumTopUpAmounts || {
          agent: 10.0,
          super_agent: 50.0,
          dealer: 100.0,
          super_dealer: 200.0,
          default: 10.0,
        },
      };

      return result;
    } catch (error) {
      logger.error(`Error getting wallet settings: ${error.message}`);
      throw error;
    }
  }

  async updateWalletSettings(walletSettings) {
    const settings = await Settings.getInstance();

    // Update individual user type minimums
    if (walletSettings.minimumTopUpAmounts) {
      settings.minimumTopUpAmounts = {
        agent:
          walletSettings.minimumTopUpAmounts.agent ||
          settings.minimumTopUpAmounts?.agent ||
          10.0,
        super_agent:
          walletSettings.minimumTopUpAmounts.super_agent ||
          settings.minimumTopUpAmounts?.super_agent ||
          50.0,
        dealer:
          walletSettings.minimumTopUpAmounts.dealer ||
          settings.minimumTopUpAmounts?.dealer ||
          100.0,
        super_dealer:
          walletSettings.minimumTopUpAmounts.super_dealer ||
          settings.minimumTopUpAmounts?.super_dealer ||
          200.0,
        default:
          walletSettings.minimumTopUpAmounts.default ||
          settings.minimumTopUpAmounts?.default ||
          10.0,
      };
    }

    await settings.save();

    logger.info("Wallet settings updated:", walletSettings);
    return { minimumTopUpAmounts: settings.minimumTopUpAmounts };
  }
}

export default new SettingsService();
