import bcrypt from "bcrypt";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import logger from "../utils/logger.js";

// =============================================================================
// SETTINGS SERVICE
// =============================================================================

class SettingsService {
  // Site Management
  async getSiteSettings() {
    const settings = await Settings.getInstance();
    return {
      isSiteOpen: settings.isSiteOpen,
      customMessage: settings.customMessage,
    };
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

    logger.info(
      `Site status toggled to: ${settings.isSiteOpen ? "open" : "closed"}`
    );

    return { isSiteOpen: settings.isSiteOpen };
  }

  // Get site status for middleware checks
  async isSiteOpen() {
    const settings = await Settings.getInstance();
    return settings.isSiteOpen;
  }

  // Commission Rates
  async getCommissionRates() {
    const settings = await Settings.getInstance();
    return {
      agentCommission: settings.agentCommission,
      customerCommission: settings.customerCommission,
    };
  }

  async updateCommissionRates(rates) {
    const settings = await Settings.getInstance();
    settings.agentCommission = rates.agentCommission;
    settings.customerCommission = rates.customerCommission;
    await settings.save();

    logger.info("Commission rates updated:", rates);
    return rates;
  }

  // API Settings
  async getApiSettings() {
    const settings = await Settings.getInstance();
    return {
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
}

export default new SettingsService();
