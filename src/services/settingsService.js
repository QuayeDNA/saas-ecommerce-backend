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
        greetingText: settings.greetingText,
        welcomeMessage: settings.welcomeMessage,
        showGreetingIcon: settings.showGreetingIcon,
        storefrontsOpen: settings.storefrontsOpen ?? true,
        storefrontsClosedMessage: settings.storefrontsClosedMessage || "",
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
    if (settings.greetingText !== undefined) {
      settingsDoc.greetingText = settings.greetingText;
    }
    if (settings.welcomeMessage !== undefined) {
      settingsDoc.welcomeMessage = settings.welcomeMessage;
    }
    if (settings.showGreetingIcon !== undefined) {
      settingsDoc.showGreetingIcon = settings.showGreetingIcon;
    }
    if (settings.storefrontsOpen !== undefined) {
      settingsDoc.storefrontsOpen = settings.storefrontsOpen;
    }
    if (settings.storefrontsClosedMessage !== undefined) {
      settingsDoc.storefrontsClosedMessage = settings.storefrontsClosedMessage;
    }
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
      greetingText: settings.greetingText,
      welcomeMessage: settings.welcomeMessage,
      showGreetingIcon: settings.showGreetingIcon,
      storefrontsOpen: settings.storefrontsOpen ?? true,
      storefrontsClosedMessage: settings.storefrontsClosedMessage || "",
    };

    logger.info(
      `Site status toggled to: ${settings.isSiteOpen ? "open" : "closed"}`,
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
        greetingText: settings.greetingText,
        welcomeMessage: settings.welcomeMessage,
        showGreetingIcon: settings.showGreetingIcon,
        storefrontsOpen: settings.storefrontsOpen ?? true,
        storefrontsClosedMessage: settings.storefrontsClosedMessage || "",
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
      logger.error(
        `Error getting auto-approve storefronts setting: ${error.message}`,
      );
      throw error;
    }
  }

  async updateAutoApproveStorefronts(autoApprove) {
    try {
      const settings = await Settings.getInstance();
      settings.autoApproveStorefronts = autoApprove;
      await settings.save();

      logger.info(
        `Auto-approve storefronts setting updated to: ${autoApprove}`,
      );
      return { autoApproveStorefronts: settings.autoApproveStorefronts };
    } catch (error) {
      logger.error(
        `Error updating auto-approve storefronts setting: ${error.message}`,
      );
      throw error;
    }
  }

  async toggleStorefrontsAvailability() {
    const settings = await Settings.getInstance();
    const current = settings.storefrontsOpen ?? true;
    settings.storefrontsOpen = !current;
    await settings.save();

    const siteStatus = {
      isSiteOpen: settings.isSiteOpen,
      customMessage: settings.customMessage,
      greetingText: settings.greetingText,
      welcomeMessage: settings.welcomeMessage,
      showGreetingIcon: settings.showGreetingIcon,
      storefrontsOpen: settings.storefrontsOpen ?? true,
      storefrontsClosedMessage: settings.storefrontsClosedMessage || "",
    };

    logger.info(
      `Storefront availability toggled to: ${settings.storefrontsOpen ? "open" : "closed"}`,
    );

    websocketService.broadcastSiteStatusUpdate(siteStatus);

    return { storefrontsOpen: settings.storefrontsOpen };
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

  // API Settings
  async getApiSettings() {
    try {
      const settings = await Settings.getInstance();

      // Detect whether secret keys exist on the server (useful for admin UI)
      // We no longer store Paystack keys in the database; keys must be provided via env vars.
      const paystackTestSecretExists = Boolean(
        process.env.PAYSTACK_TEST_SECRET_KEY,
      );
      const paystackLiveSecretExists = Boolean(
        process.env.PAYSTACK_LIVE_SECRET_KEY,
      );

      // In production we must NOT return secret keys to the browser. Instead expose existence flags.
      const isProd = process.env.NODE_ENV === "production";

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
        // Paystack
        paystackEnabled:
          settings.paystackEnabled ||
          process.env.PAYSTACK_ENABLED === "true" ||
          false,
        paystackWalletTopUpEnabled:
          settings.paystackWalletTopUpEnabled ?? false,
        // MTN wallet top-up availability for frontend toggles
        mtnWalletTopUpEnabled: settings.mtnWalletTopUpEnabled ?? false,
        paystackStorefrontEnabled: settings.paystackStorefrontEnabled ?? false,
        paystackTestPublicKey: process.env.PAYSTACK_TEST_PUBLIC_KEY || "",
        paystackLivePublicKey: process.env.PAYSTACK_LIVE_PUBLIC_KEY || "",

        // SECRET KEYS: only include actual secret values when NOT in production.
        paystackTestSecretKey: isProd
          ? undefined
          : process.env.PAYSTACK_TEST_SECRET_KEY || "",
        paystackLiveSecretKey: isProd
          ? undefined
          : process.env.PAYSTACK_LIVE_SECRET_KEY || "",

        // provide boolean flags so the UI can indicate whether a secret exists without exposing it
        paystackTestSecretExists,
        paystackLiveSecretExists,
      };

      return result;
    } catch (error) {
      logger.error(`Error getting API settings: ${error.message}`);
      throw error;
    }
  }

  async updateApiSettings(settings) {
    const settingsDoc = await Settings.getInstance();
    if (settings.mtnApiKey !== undefined)
      settingsDoc.mtnApiKey = settings.mtnApiKey;
    if (settings.telecelApiKey !== undefined)
      settingsDoc.telecelApiKey = settings.telecelApiKey;
    if (settings.airtelTigoApiKey !== undefined)
      settingsDoc.airtelTigoApiKey = settings.airtelTigoApiKey;
    if (settings.apiEndpoint !== undefined)
      settingsDoc.apiEndpoint = settings.apiEndpoint;

    // Paystack settings (optional)
    if (settings.paystackEnabled !== undefined)
      settingsDoc.paystackEnabled = settings.paystackEnabled;
    if (settings.paystackWalletTopUpEnabled !== undefined)
      settingsDoc.paystackWalletTopUpEnabled =
        settings.paystackWalletTopUpEnabled;
    if (settings.paystackStorefrontEnabled !== undefined)
      settingsDoc.paystackStorefrontEnabled =
        settings.paystackStorefrontEnabled;
    // MTN wallet top-up toggle
    if (settings.mtnWalletTopUpEnabled !== undefined)
      settingsDoc.mtnWalletTopUpEnabled = settings.mtnWalletTopUpEnabled;
    // Paystack key configuration is managed via environment variables for security.
    // We no longer persist Paystack keys in the database.

    await settingsDoc.save();

    logger.info("API settings updated:", {
      ...settings,
      mtnApiKey: settings.mtnApiKey ? "[HIDDEN]" : "",
      telecelApiKey: settings.telecelApiKey ? "[HIDDEN]" : "",
      airtelTigoApiKey: settings.airtelTigoApiKey ? "[HIDDEN]" : "",
      paystackTestSecretKey: settings.paystackTestSecretKey ? "[HIDDEN]" : "",
      paystackLiveSecretKey: settings.paystackLiveSecretKey ? "[HIDDEN]" : "",
      mtnWalletTopUpEnabled: settings.mtnWalletTopUpEnabled,
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
        user.password,
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
        paystackMinimumTopUpAmount: settings.paystackMinimumTopUpAmount || 0.0,
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

    // Update the global paystack top-up minimum if provided
    if (walletSettings.paystackMinimumTopUpAmount !== undefined) {
      settings.paystackMinimumTopUpAmount =
        walletSettings.paystackMinimumTopUpAmount || 0.0;
    }

    await settings.save();

    logger.info("Wallet settings updated:", walletSettings);
    return {
      minimumTopUpAmounts: settings.minimumTopUpAmounts,
      paystackMinimumTopUpAmount: settings.paystackMinimumTopUpAmount,
    };
  }

  // ---------------------------------------------------------------------------
  // Payout Settings
  // ---------------------------------------------------------------------------

  async getPayoutSettings() {
    try {
      const settings = await Settings.getInstance();
      const result = {
        minimumPayoutAmounts: settings.minimumPayoutAmounts || {
          mobile_money: 1.0,
          bank_account: 50.0,
        },
        autoPayoutEnabled: settings.autoPayoutEnabled ?? false,
      };

      return result;
    } catch (error) {
      logger.error(`Error getting payout settings: ${error.message}`);
      throw error;
    }
  }

  async updatePayoutSettings(payoutSettings) {
    const settings = await Settings.getInstance();
    if (payoutSettings.minimumPayoutAmounts) {
      settings.minimumPayoutAmounts = {
        mobile_money:
          payoutSettings.minimumPayoutAmounts.mobile_money ||
          settings.minimumPayoutAmounts?.mobile_money ||
          1.0,
        bank_account:
          payoutSettings.minimumPayoutAmounts.bank_account ||
          settings.minimumPayoutAmounts?.bank_account ||
          50.0,
      };
    }

    await settings.save();

    logger.info("Payout settings updated:", payoutSettings);
    return { minimumPayoutAmounts: settings.minimumPayoutAmounts };
  }

  // ---------------------------------------------------------------------------
  // Transaction Fee Settings
  // ---------------------------------------------------------------------------

  async getFeeSettings() {
    try {
      const settings = await Settings.getInstance();
      return {
        paystackCollectionFeePercent:
          settings.paystackCollectionFeePercent ?? 1.95,
        platformFeePercent: settings.platformFeePercent ?? 0,
        delegateFeesToCustomer: settings.delegateFeesToCustomer ?? true,
        walletTopUpCollectionFeePercent:
          settings.walletTopUpCollectionFeePercent ?? 1.95,
        walletTopUpPlatformFeePercent:
          settings.walletTopUpPlatformFeePercent ?? 0,
        walletTopUpDelegateFeesToCustomer:
          settings.walletTopUpDelegateFeesToCustomer ?? true,
        paystackTransferFees: {
          mobile_money: settings.paystackTransferFees?.mobile_money ?? 1.0,
          bank_account: settings.paystackTransferFees?.bank_account ?? 8.0,
        },
        payoutFeeBearer: settings.payoutFeeBearer ?? "agent",
        platformPayoutFeePercent: settings.platformPayoutFeePercent ?? 0,
        autoPayoutEnabled: settings.autoPayoutEnabled ?? false,
        minimumPayoutAmounts: {
          mobile_money: settings.minimumPayoutAmounts?.mobile_money ?? 1.0,
          bank_account: settings.minimumPayoutAmounts?.bank_account ?? 50.0,
        },
      };
    } catch (error) {
      logger.error(`Error getting fee settings: ${error.message}`);
      throw error;
    }
  }

  async updateFeeSettings(feeSettings) {
    const settings = await Settings.getInstance();

    if (feeSettings.paystackCollectionFeePercent !== undefined) {
      settings.paystackCollectionFeePercent = Number(
        feeSettings.paystackCollectionFeePercent,
      );
    }
    if (feeSettings.platformFeePercent !== undefined) {
      settings.platformFeePercent = Number(feeSettings.platformFeePercent);
    }
    if (feeSettings.delegateFeesToCustomer !== undefined) {
      settings.delegateFeesToCustomer = Boolean(
        feeSettings.delegateFeesToCustomer,
      );
    }
    if (feeSettings.walletTopUpCollectionFeePercent !== undefined) {
      settings.walletTopUpCollectionFeePercent = Number(
        feeSettings.walletTopUpCollectionFeePercent,
      );
    }
    if (feeSettings.walletTopUpPlatformFeePercent !== undefined) {
      settings.walletTopUpPlatformFeePercent = Number(
        feeSettings.walletTopUpPlatformFeePercent,
      );
    }
    if (feeSettings.walletTopUpDelegateFeesToCustomer !== undefined) {
      settings.walletTopUpDelegateFeesToCustomer = Boolean(
        feeSettings.walletTopUpDelegateFeesToCustomer,
      );
    }
    if (feeSettings.paystackTransferFees) {
      settings.paystackTransferFees = {
        mobile_money:
          feeSettings.paystackTransferFees.mobile_money ??
          settings.paystackTransferFees?.mobile_money ??
          1.0,
        bank_account:
          feeSettings.paystackTransferFees.bank_account ??
          settings.paystackTransferFees?.bank_account ??
          8.0,
      };
    }
    if (feeSettings.payoutFeeBearer !== undefined) {
      settings.payoutFeeBearer = feeSettings.payoutFeeBearer;
    }
    if (feeSettings.platformPayoutFeePercent !== undefined) {
      settings.platformPayoutFeePercent = Number(
        feeSettings.platformPayoutFeePercent,
      );
    }
    if (feeSettings.autoPayoutEnabled !== undefined) {
      settings.autoPayoutEnabled = Boolean(feeSettings.autoPayoutEnabled);
    }
    if (feeSettings.minimumPayoutAmounts) {
      settings.minimumPayoutAmounts = {
        mobile_money:
          feeSettings.minimumPayoutAmounts.mobile_money != null
            ? Number(feeSettings.minimumPayoutAmounts.mobile_money)
            : (settings.minimumPayoutAmounts?.mobile_money ?? 1.0),
        bank_account:
          feeSettings.minimumPayoutAmounts.bank_account != null
            ? Number(feeSettings.minimumPayoutAmounts.bank_account)
            : (settings.minimumPayoutAmounts?.bank_account ?? 50.0),
      };
    }

    await settings.save();
    logger.info("Fee settings updated:", feeSettings);
    return this.getFeeSettings();
  }

  // ---------------------------------------------------------------------------
  // Referral & Commission Settings
  // ---------------------------------------------------------------------------

  async getReferralSettings() {
    try {
      const settings = await Settings.getInstance();
      return {
        referralCommissionPercent:
          settings.referralCommissionPercent ?? 5.0,
        referralProgramEnabled:
          settings.referralProgramEnabled ?? true,
        referralCommissionCap:
          settings.referralCommissionCap ?? 0,
        minOrderAmountForCommission:
          settings.minOrderAmountForCommission ?? 0,
      };
    } catch (error) {
      logger.error(`Error getting referral settings: ${error.message}`);
      throw error;
    }
  }

  async updateReferralSettings(referralSettings) {
    try {
      const settings = await Settings.getInstance();

      if (referralSettings.referralCommissionPercent !== undefined) {
        settings.referralCommissionPercent = Number(
          referralSettings.referralCommissionPercent,
        );
      }
      if (referralSettings.referralProgramEnabled !== undefined) {
        settings.referralProgramEnabled = Boolean(
          referralSettings.referralProgramEnabled,
        );
      }
      if (referralSettings.referralCommissionCap !== undefined) {
        settings.referralCommissionCap = Number(
          referralSettings.referralCommissionCap,
        );
      }
      if (referralSettings.minOrderAmountForCommission !== undefined) {
        settings.minOrderAmountForCommission = Number(
          referralSettings.minOrderAmountForCommission,
        );
      }

      await settings.save();
      logger.info("Referral settings updated:", referralSettings);
      return this.getReferralSettings();
    } catch (error) {
      logger.error(`Error updating referral settings: ${error.message}`);
      throw error;
    }
  }
}

export default new SettingsService();
