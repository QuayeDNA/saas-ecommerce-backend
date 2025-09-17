import bcrypt from "bcrypt";
import User from "../models/User.js";
import Settings from "../models/Settings.js";
import logger from "../utils/logger.js";
import redisService from "./redisService.js";

// =============================================================================
// SETTINGS SERVICE
// =============================================================================

class SettingsService {
  // Site Management
  async getSiteSettings() {
    try {
      const cacheKey = "settings:site";

      // Try to get from cache first
      const cachedSettings = await redisService.get(cacheKey);
      if (cachedSettings) {
        logger.debug("Site settings cache hit");
        return cachedSettings;
      }

      const settings = await Settings.getInstance();
      const result = {
        isSiteOpen: settings.isSiteOpen,
        customMessage: settings.customMessage,
      };

      // Cache for 5 minutes (300 seconds) since site settings change infrequently
      await redisService.set(cacheKey, result, 300);
      logger.debug("Site settings cached");

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

    // Invalidate site settings cache
    await this.invalidateSiteSettingsCache();

    logger.info("Site settings updated:", settings);
    return settings;
  }

  async toggleSiteStatus() {
    const settings = await Settings.getInstance();
    settings.isSiteOpen = !settings.isSiteOpen;
    await settings.save();

    // Invalidate site settings cache
    await this.invalidateSiteSettingsCache();

    logger.info(
      `Site status toggled to: ${settings.isSiteOpen ? "open" : "closed"}`
    );

    return { isSiteOpen: settings.isSiteOpen };
  }

  // Get site status for middleware checks
  async isSiteOpen() {
    try {
      const cacheKey = "settings:site:status";

      // Try to get from cache first (very short TTL for status checks)
      const cachedStatus = await redisService.get(cacheKey);
      if (cachedStatus !== null) {
        logger.debug("Site status cache hit");
        return cachedStatus;
      }

      const settings = await Settings.getInstance();
      const isOpen = settings.isSiteOpen;

      // Cache for 30 seconds (30 seconds) since status is checked frequently
      await redisService.set(cacheKey, isOpen, 30);
      logger.debug("Site status cached");

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
      const cacheKey = "settings:commission_rates";

      // Try to get from cache first
      const cachedRates = await redisService.get(cacheKey);
      if (cachedRates) {
        logger.debug("Commission rates cache hit");
        return cachedRates;
      }

      const settings = await Settings.getInstance();
      const result = {
        agentCommission: settings.agentCommission,
        customerCommission: settings.customerCommission,
      };

      // Cache for 10 minutes (600 seconds) since commission rates change moderately
      await redisService.set(cacheKey, result, 600);
      logger.debug("Commission rates cached");

      return result;
    } catch (error) {
      logger.error(`Error getting commission rates: ${error.message}`);
      throw error;
    }
  }

  async updateCommissionRates(rates) {
    const settings = await Settings.getInstance();
    settings.agentCommission = rates.agentCommission;
    settings.customerCommission = rates.customerCommission;
    await settings.save();

    // Invalidate commission rates cache
    await this.invalidateCommissionRatesCache();

    logger.info("Commission rates updated:", rates);
    return rates;
  }

  // API Settings
  async getApiSettings() {
    try {
      const cacheKey = "settings:api";

      // Try to get from cache first
      const cachedSettings = await redisService.get(cacheKey);
      if (cachedSettings) {
        logger.debug("API settings cache hit");
        return cachedSettings;
      }

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

      // Cache for 30 minutes (1800 seconds) since API settings change infrequently
      await redisService.set(cacheKey, result, 1800);
      logger.debug("API settings cached");

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

    // Invalidate API settings cache
    await this.invalidateApiSettingsCache();

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

  // Cache Invalidation Methods
  async invalidateSiteSettingsCache() {
    try {
      await redisService.del(["settings:site", "settings:site:status"]);
      logger.debug("Site settings cache invalidated");
    } catch (error) {
      logger.error(
        `Failed to invalidate site settings cache: ${error.message}`
      );
    }
  }

  async invalidateCommissionRatesCache() {
    try {
      await redisService.del(["settings:commission_rates"]);
      logger.debug("Commission rates cache invalidated");
    } catch (error) {
      logger.error(
        `Failed to invalidate commission rates cache: ${error.message}`
      );
    }
  }

  async invalidateApiSettingsCache() {
    try {
      await redisService.del(["settings:api"]);
      logger.debug("API settings cache invalidated");
    } catch (error) {
      logger.error(`Failed to invalidate API settings cache: ${error.message}`);
    }
  }

  async invalidateAllSettingsCache() {
    try {
      await redisService.del([
        "settings:site",
        "settings:site:status",
        "settings:commission_rates",
        "settings:api",
      ]);
      logger.debug("All settings cache invalidated");
    } catch (error) {
      logger.error(`Failed to invalidate all settings cache: ${error.message}`);
    }
  }
}

export default new SettingsService();
