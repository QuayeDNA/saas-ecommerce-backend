// src/controllers/authController.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authService from "../services/authService.js";
import otpService from "../services/otpService.js";
import logger from "../utils/logger.js";
import { BUSINESS_ROLES } from "../constants/roles.js";
import { isBusinessUser, getTenantId } from "../utils/userTypeHelpers.js";
import userService from "../services/userService.js";
import emailService from "../services/emailService.js";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
} from "../constants/audit.js";

const AUTH_STATUS_CODE_FALLBACK = {
  400: "AUTH_BAD_REQUEST",
  401: "AUTH_UNAUTHORIZED",
  403: "AUTH_FORBIDDEN",
  404: "AUTH_NOT_FOUND",
  409: "AUTH_CONFLICT",
  429: "AUTH_RATE_LIMITED",
  500: "AUTH_INTERNAL_ERROR",
};

class AuthController {
  sendAuthError(
    res,
    error,
    fallbackCode,
    fallbackMessage,
    fallbackStatus = 500,
  ) {
    const status = error?.statusCode || fallbackStatus;
    const code =
      error?.code ||
      fallbackCode ||
      AUTH_STATUS_CODE_FALLBACK[status] ||
      AUTH_STATUS_CODE_FALLBACK[500];
    const message = error?.message || fallbackMessage;

    return res.status(status).json({
      success: false,
      code,
      message,
    });
  }

  sendAuthErrorByCode(res, status, code, message) {
    return res.status(status).json({
      success: false,
      code,
      message,
    });
  }

  // Generate JWT token with tenant info
  generateToken(userId, userType, tenantId = null) {
    return jwt.sign({ userId, userType, tenantId }, process.env.JWTSECRET, {
      expiresIn: "30d",
    });
  }

  // Generate access token (short-lived)
  generateAccessToken(userId, userType, tenantId = null) {
    return jwt.sign(
      { userId, userType, tenantId },
      process.env.JWTSECRET,
      { expiresIn: "24h" }, // Extended to 24 hours for better user experience
    );
  }

  // Generate refresh token (long-lived)
  generateRefreshToken(userId) {
    return jwt.sign(
      { userId, type: "refresh" },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET,
      { expiresIn: "30d" }, // Extended to 30 days for better user experience
    );
  }

  // Generate unique agent code using randomized format: BLA-XXXX
  async generateAgentCode(appId = null) {
    // Import the agent code generator
    const { generateUniqueAgentCode } =
      await import("../utils/agentCodeGenerator.js");
    return await generateUniqueAgentCode(appId);
  }

  async logAudit(req, payload) {
    try {
      if (!req?.logAuditAction) return;
      await req.logAuditAction(payload);
    } catch (error) {
      logger.warn(`Audit logging failed: ${error.message}`);
    }
  }

  // Send OTP verification code
  async sendOtp(req, res) {
    try {
      const { phone, email, channel } = req.body;

      const existingUser = await User.findOne({ phone });
      if (existingUser) {
        return this.sendAuthErrorByCode(
          res,
          409,
          "AUTH_PHONE_ALREADY_REGISTERED",
          "This phone number is already registered.",
        );
      }

      const result = await otpService.sendOtp(phone, email, channel, req.appContext);

      res.json({
        success: true,
        message: "Verification code sent successfully.",
        channel: result.channel,
        maskedContact: result.maskedContact,
      });
    } catch (error) {
      logger.error(`Send OTP error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_SEND_OTP_FAILED",
        "Failed to send verification code. Please try again.",
      );
    }
  }

  // Verify OTP code
  async verifyOtp(req, res) {
    try {
      const { phone, code } = req.body;

      const result = await otpService.verifyOtp(phone, code);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          code: "AUTH_OTP_VERIFICATION_FAILED",
          message: result.message,
        });
      }

      res.json({
        success: true,
        message: "Phone number verified successfully.",
      });
    } catch (error) {
      logger.error(`Verify OTP error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_VERIFY_OTP_FAILED",
        "Failed to verify code. Please try again.",
      );
    }
  }

  // Register new agent (multi-tenant admin)
  async registerAgent(req, res) {
    try {
      const result = await userService.registerAgent(req.body, req.appContext);

      await this.logAudit(req, {
        userId: req.user?.userId || null,
        userType: req.user?.userType || null,
        action: AUDIT_ACTIONS.AUTH_REGISTER,
        category: AUDIT_CATEGORIES.AUTH,
        resource: {
          createdUserId: result.agent?._id,
          createdUserType: result.userType,
        },
        metadata: {
          email: result.agent?.email,
          agentCode: result.agentCode,
          registrationStatus: result.userStatus,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      await this.logAudit(req, {
        userId: req.user?.userId || result.agent?._id || null,
        userType: req.user?.userType || result.userType,
        action: AUDIT_ACTIONS.USER_CREATED,
        category: AUDIT_CATEGORIES.USER,
        resource: {
          userId: result.agent?._id,
        },
        changes: {
          before: null,
          after: {
            email: result.agent?.email,
            userType: result.userType,
            agentCode: result.agentCode,
            referralCode: result.referralCode,
            status: result.userStatus,
            referredBy: result.agent?.referredBy,
          },
        },
        metadata: {
          source: "auth.registerAgent",
          referralCode: result.referralCode,
          referredBy: result.agent?.referredBy,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.status(201).json({
        success: true,
        message:
          result.userStatus === "pending"
            ? `${result.userType} account created successfully. Your account is pending approval by a super admin.`
            : `${result.userType} account created successfully. You can now log in.`,
        agentCode: result.agentCode,
        referralCode: result.referralCode,
        userType: result.userType,
      });
    } catch (error) {
      logger.error(`Agent registration error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_REGISTER_AGENT_FAILED",
        "Agent registration failed. Please try again.",
      );
    }
  }

  // Enhanced login with tenant context
  async login(req, res) {
    try {
      const { email, password, rememberMe } = req.body;

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        logger.warn(`Login attempt for non-existent user: ${email}`);
        await this.logAudit(req, {
          action: AUDIT_ACTIONS.AUTH_FAILED_LOGIN,
          category: AUDIT_CATEGORIES.AUTH,
          resource: { email },
          metadata: { reason: "user_not_found" },
          severity: AUDIT_SEVERITIES.WARNING,
        });
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_INVALID_CREDENTIALS",
          "Invalid email or password",
        );
      }

      // Check password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        logger.warn(`Invalid password for user: ${email}`);
        await this.logAudit(req, {
          userId: user._id,
          userType: user.userType,
          action: AUDIT_ACTIONS.AUTH_FAILED_LOGIN,
          category: AUDIT_CATEGORIES.AUTH,
          resource: { userId: user._id, email },
          metadata: { reason: "invalid_password" },
          severity: AUDIT_SEVERITIES.WARNING,
        });
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_INVALID_CREDENTIALS",
          "Invalid email or password",
        );
      }

      // Email verification is no longer required - all users are auto-verified
      // The check is removed to allow immediate login after registration

      // Block login if user is not active
      if (user.status !== "active" || user.isActive === false) {
        logger.warn(
          `Login attempt for user with status '${user.status}' or inactive: ${email}`,
        );
        const message =
          user.isActive === false
            ? "Your account has been deactivated by an administrator."
            : user.status === "pending"
              ? "Your account is pending approval by a super admin."
              : "Your account has been rejected. Please contact support.";
        const code =
          user.isActive === false
            ? "AUTH_ACCOUNT_DEACTIVATED"
            : user.status === "pending"
              ? "AUTH_ACCOUNT_PENDING_APPROVAL"
              : "AUTH_ACCOUNT_REJECTED";
        await this.logAudit(req, {
          userId: user._id,
          userType: user.userType,
          action: AUDIT_ACTIONS.AUTH_FAILED_LOGIN,
          category: AUDIT_CATEGORIES.AUTH,
          resource: { userId: user._id, email },
          metadata: {
            reason: "account_not_active",
            status: user.status,
            isActive: user.isActive,
          },
          severity: AUDIT_SEVERITIES.WARNING,
        });
        return this.sendAuthErrorByCode(res, 401, code, message);
      }

      // Generate tokens
      const tenantId = getTenantId(user);
      const accessToken = this.generateAccessToken(
        user._id,
        user.userType,
        tenantId,
      );
      const refreshToken = this.generateRefreshToken(user._id);

      // Store refresh token in user document (optional - for token invalidation)
      user.refreshToken = refreshToken;

      // Ensure tenantId is set for agent-type users before saving
      if (BUSINESS_ROLES.includes(user.userType) && !user.tenantId) {
        // For agents, they are their own tenant. For others, use their own ID as fallback
        user.tenantId = user._id;
      }

      await user.save();

      // Set refresh token as httpOnly cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000, // 30 days or 7 days
      };

      res.cookie("refreshToken", refreshToken, cookieOptions);

      logger.info(
        `User logged in successfully: ${email} - Type: ${user.userType}`,
      );

      await this.logAudit(req, {
        userId: user._id,
        userType: user.userType,
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { userId: user._id, email },
        metadata: {
          rememberMe: Boolean(rememberMe),
          requiresPinSetup: user.requiresPinSetup,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      // Check for first-time login for business users
      if (isBusinessUser(user.userType) && user.isFirstTime) {
        // Import wallet service dynamically to avoid circular dependency
        const walletService = (await import("../services/walletService.js"))
          .default;

        // Initialize wallet with 100 GH₵
        try {
          await walletService.initializeAgentWallet(user._id);
          // Update first time flag
          user.isFirstTime = false;
          await user.save();
          logger.info(
            `Initialized agent wallet for first login: ${user.email}`,
          );
        } catch (walletError) {
          logger.error(
            `Failed to initialize agent wallet: ${walletError.message}`,
          );
          // Continue login process even if wallet initialization fails
        }
      }

      const userData = user.toJSON();

      res.json({
        success: true,
        user: userData,
        requiresPinSetup: user.requiresPinSetup,
        token: accessToken,
        refreshToken: refreshToken, // Also send in response for frontend storage
        dashboardUrl:
          user.userType === "super_admin" ? "/superadmin" : "/agent/dashboard",
      });
    } catch (error) {
      logger.error(`Login error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_LOGIN_FAILED",
        "Login failed. Please try again.",
      );
    }
  }

  // Get agent dashboard data
  async getAgentDashboard(req, res) {
    try {
      const data = await userService.getAgentDashboard(
        req.user.userId,
        req.user,
      );
      res.json({ success: true, data });
    } catch (error) {
      logger.error(`Agent dashboard error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_DASHBOARD_LOAD_FAILED",
        "Failed to load dashboard data",
      );
    }
  }

  // Verify account (fixed implementation with debugging)
  async verifyAccount(req, res) {
    try {
      const { token } = req.body;

      logger.info(
        `Verification attempt with token: ${token ? "provided" : "missing"}`,
      );

      if (!token) {
        logger.warn("No token provided in request body");
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_VERIFY_TOKEN_REQUIRED",
          "Verification token is required",
        );
      }

      // Verify the JWT token
      const decoded = jwt.verify(token, process.env.JWTSECRET);
      logger.info(`Token decoded successfully for email: ${decoded.email}`);

      // Find user by email and check if the verification token matches
      const user = await User.findOne({
        email: decoded.email,
        verificationToken: token,
        isVerified: false, // Only allow verification if not already verified
      });

      if (!user) {
        // Additional debugging
        const userByEmail = await User.findOne({ email: decoded.email });
        if (!userByEmail) {
          logger.warn(`No user found with email: ${decoded.email}`);
        } else {
          logger.warn(
            `User found but verification failed - isVerified: ${
              userByEmail.isVerified
            }, hasVerificationToken: ${!!userByEmail.verificationToken}`,
          );
        }

        return res.status(400).json({
          success: false,
          code: "AUTH_VERIFY_TOKEN_INVALID",
          message:
            "Invalid or expired verification token, or account already verified",
        });
      }

      // Mark user as verified and clear verification token
      user.isVerified = true;
      user.verificationToken = undefined;

      // For business users, keep status as pending until super admin approval
      // For customers, set status to active
      if (isBusinessUser(user.userType)) {
        user.status = "pending"; // Ensure business user remains pending
        logger.info(
          `Business user account verified but pending approval: ${user.email}`,
        );
      } else {
        user.status = "active"; // Customers can be active immediately
      }

      await user.save();

      logger.info(
        `Account verified successfully: ${user.email} - Status: ${user.status}`,
      );

      // Return appropriate message based on user type
      const message = isBusinessUser(user.userType)
        ? "Account verified successfully. Your account is pending approval by a super admin. You will be notified once approved."
        : "Account verified successfully. You can now log in.";

      // Fetch updated user to return to client for state refresh
      const updatedUser = await User.findById(user._id).select(
        "-password -refreshToken",
      );

      res.json({
        success: true,
        message,
        userType: user.userType,
        status: user.status,
        user: updatedUser,
      });
    } catch (error) {
      logger.error(`Account verification error: ${error.message}`);

      // Handle JWT errors specifically
      if (error.name === "JsonWebTokenError") {
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_VERIFY_TOKEN_FORMAT_INVALID",
          "Invalid verification token format",
        );
      } else if (error.name === "TokenExpiredError") {
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_VERIFY_TOKEN_EXPIRED",
          "Verification token has expired. Please request a new verification email.",
        );
      }

      return this.sendAuthErrorByCode(
        res,
        400,
        "AUTH_VERIFY_TOKEN_INVALID",
        "Invalid or expired verification token",
      );
    }
  }
  // Set up security PIN
  async setupPin(req, res) {
    try {
      const { pin } = req.body;
      const userId = req.user._id;

      await authService.setupPin(userId, pin);

      logger.info(`Security PIN setup successfully for user: ${userId}`);
      await this.logAudit(req, {
        userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.AUTH_PIN_SETUP,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { userId },
        metadata: { source: "auth.setupPin" },
        severity: AUDIT_SEVERITIES.INFO,
      });
      // Fetch updated user data to return to client so frontends can refresh their cached user
      const updatedUser = await User.findById(userId).select(
        "-password -refreshToken",
      );

      res.json({
        success: true,
        message: "Security PIN configured successfully",
        user: updatedUser,
      });
    } catch (error) {
      logger.error(`Setup PIN error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_SETUP_PIN_FAILED",
        "Failed to setup Security PIN",
      );
    }
  }

  // Forgot password via PIN
  async forgotPassword(req, res) {
    try {
      const { identifier, pin } = req.body;
      if (!identifier || !pin) {
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_IDENTIFIER_PIN_REQUIRED",
          "Identifier and PIN are required",
        );
      }

      const result = await authService.forgotPasswordWithPin(identifier, pin);

      await this.logAudit(req, {
        userId: req.user?.userId || null,
        userType: req.user?.userType || null,
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { identifier },
        metadata: {
          stage: "initiated",
          message: result.message,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      logger.info(`Password reset token generated via PIN for: ${identifier}`);
      res.json({
        success: true,
        resetToken: result.resetToken,
        message: result.message,
      });
    } catch (error) {
      logger.error(`Forgot password via PIN error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_FORGOT_PASSWORD_FAILED",
        "Failed to process password reset",
      );
    }
  }

  // Reset password
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;

      await authService.resetPasswordWithToken(token, password);

      await this.logAudit(req, {
        userId: req.user?.userId || null,
        userType: req.user?.userType || null,
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { tokenProvided: Boolean(token) },
        metadata: {
          stage: "completed",
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      logger.info(`Password reset successfully via token`);
      res.json({
        success: true,
        message:
          "Password reset successfully. Please login with your new password.",
      });
    } catch (error) {
      logger.error(`Reset password error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_RESET_PASSWORD_FAILED",
        "Failed to reset password",
      );
    }
  }

  // Refresh token endpoint
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      const cookieRefreshToken = req.cookies?.refreshToken;

      // Use refresh token from body or cookie
      const token = refreshToken || cookieRefreshToken;

      if (!token) {
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_REFRESH_TOKEN_REQUIRED",
          "Refresh token not provided",
        );
      }

      // Verify refresh token
      const decoded = jwt.verify(
        token,
        process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET,
      );

      if (decoded.type !== "refresh") {
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_REFRESH_TOKEN_TYPE_INVALID",
          "Invalid token type",
        );
      }

      // Find user and verify refresh token
      const user = await User.findById(decoded.userId);
      if (!user || user.refreshToken !== token) {
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_REFRESH_TOKEN_INVALID",
          "Invalid refresh token",
        );
      }

      if (
        user.passwordChangedAt &&
        decoded.iat &&
        decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime()
      ) {
        return this.sendAuthErrorByCode(
          res,
          401,
          "AUTH_SESSION_EXPIRED",
          "Session expired. Please log in again.",
        );
      }

      // Generate new tokens
      const tenantId = getTenantId(user);
      const newAccessToken = this.generateAccessToken(
        user._id,
        user.userType,
        tenantId,
      );
      const newRefreshToken = this.generateRefreshToken(user._id);

      // Update stored refresh token
      user.refreshToken = newRefreshToken;
      await user.save();

      // Set new refresh token cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      };

      res.cookie("refreshToken", newRefreshToken, cookieOptions);

      logger.info(`Token refreshed for user: ${user.email}`);

      res.json({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: user.toJSON(),
        requiresPinSetup: user.requiresPinSetup,
      });
    } catch (error) {
      logger.error(`Token refresh error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_REFRESH_TOKEN_INVALID",
        "Invalid refresh token",
        401,
      );
    }
  }

  // Enhanced verify token
  async verifyToken(req, res) {
    try {
      // Token is already verified by middleware, just return user data
      const user = await User.findById(req.user.userId).select(
        "-password -refreshToken",
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          valid: false,
          code: "AUTH_USER_NOT_FOUND",
          message: "User not found",
        });
      }

      res.json({
        success: true,
        valid: true,
        user: user.toJSON(),
        requiresPinSetup: user.requiresPinSetup,
      });
    } catch (error) {
      logger.error(`Token verification error: ${error.message}`);
      return res.status(401).json({
        success: false,
        valid: false,
        code: error?.code || "AUTH_TOKEN_INVALID",
        message: "Invalid token",
      });
    }
  }

  // Enhanced logout
  async logout(req, res) {
    try {
      // Clear refresh token from database
      if (req.user?.userId) {
        await User.findByIdAndUpdate(req.user.userId, {
          $unset: { refreshToken: 1 },
        });
      }

      // Clear refresh token cookie
      res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
      });

      logger.info(`User logged out: ${req.user?.email || "Unknown"}`);
      await this.logAudit(req, {
        userId: req.user?.userId || null,
        userType: req.user?.userType || null,
        action: AUDIT_ACTIONS.AUTH_LOGOUT,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { userId: req.user?.userId || null },
        metadata: { email: req.user?.email || null },
        severity: AUDIT_SEVERITIES.INFO,
      });
      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error(`Logout error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_LOGOUT_FAILED",
        "Logout failed",
      );
    }
  }

  // Resend verification token (limited to one resend)
  async resendVerification(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_EMAIL_REQUIRED",
          "Email is required",
        );
      }

      // Find user by email
      const user = await User.findOne({ email });

      if (!user) {
        logger.warn(
          `Verification resend attempt for non-existent user: ${email}`,
        );
        return res.status(404).json({
          success: false,
          code: "AUTH_EMAIL_NOT_FOUND",
          message: "No account found with this email address",
        });
      }

      // Check if account is already verified
      if (user.isVerified) {
        logger.warn(
          `Verification resend attempt for already verified account: ${email}`,
        );
        return res.status(400).json({
          success: false,
          code: "AUTH_ACCOUNT_ALREADY_VERIFIED",
          message: "This account is already verified",
        });
      }

      // Check if this is the first resend attempt
      if (user.verificationResent) {
        logger.warn(`Multiple verification resend attempts for: ${email}`);
        return res.status(400).json({
          success: false,
          code: "AUTH_VERIFICATION_RESEND_LIMIT_REACHED",
          message:
            "Verification email has already been resent. Please register again if you still cannot verify your account.",
        });
      }

      // Generate new verification token
      const verificationToken = jwt.sign({ email }, process.env.JWTSECRET, {
        expiresIn: "10m", // 10 minutes
      });

      // Update user with new token and mark as resent
      user.verificationToken = verificationToken;
      user.verificationResent = true;
      await user.save();

      // Send verification email
      if (isBusinessUser(user.userType)) {
        /* await emailService.sendAgentVerificationEmail purged */
      } else {
        /* await // emailService.sendVerificationEmail(email, verificationToken); // Email purged */
      }

      logger.info(`Verification email resent to: ${email}`);
      res.json({
        success: true,
        message: "Verification email has been resent. Please check your inbox.",
      });
    } catch (error) {
      logger.error(`Resend verification error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_RESEND_VERIFICATION_FAILED",
        "Failed to resend verification email. Please try again.",
      );
    }
  }

  // Update user's first-time flag
  async updateFirstTimeFlag(req, res) {
    try {
      const userId = req.user.userId;

      // Update the user's isFirstTime flag
      await User.findByIdAndUpdate(userId, {
        isFirstTime: false,
      });

      logger.info(`First-time flag updated for user: ${req.user.email}`);

      // Fetch updated user data to return to client for state refresh
      const updatedUser = await User.findById(userId).select(
        "-password -refreshToken",
      );

      res.json({
        success: true,
        message: "User preferences updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      logger.error(`Error updating first-time flag: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_UPDATE_PREFERENCES_FAILED",
        "Failed to update user preferences",
      );
    }
  }

  // Register super admin (system use only)
  async registerSuperAdmin(req, res) {
    try {
      const { fullName, email, phone, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        logger.warn(
          `Super admin registration attempt with existing email: ${email}`,
        );
        return this.sendAuthErrorByCode(
          res,
          400,
          "AUTH_EMAIL_ALREADY_EXISTS",
          "User already exists with this email",
        );
      }

      // Create super admin user
      const superAdmin = new User({
        fullName,
        email,
        phone,
        password,
        userType: "super_admin",
        isVerified: true, // Auto-verify super admin
        isFirstTime: false,
      });

      await superAdmin.save();

      // Generate tokens
      const accessToken = this.generateAccessToken(
        superAdmin._id,
        "super_admin",
      );
      const refreshToken = this.generateRefreshToken(superAdmin._id);

      // Store refresh token
      superAdmin.refreshToken = refreshToken;
      await superAdmin.save();

      logger.info(`Super admin registered successfully: ${email}`);
      res.status(201).json({
        success: true,
        message: "Super admin account created successfully",
        user: {
          id: superAdmin._id,
          fullName: superAdmin.fullName,
          email: superAdmin.email,
          userType: superAdmin.userType,
        },
        accessToken,
        refreshToken,
      });
    } catch (error) {
      logger.error(`Super admin registration error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_REGISTER_SUPER_ADMIN_FAILED",
        "Super admin registration failed. Please try again.",
      );
    }
  }

  // List all users (super admin only)
  async listUsers(req, res) {
    try {
      const filters = {
        status: req.query.status,
        userType: req.query.userType,
        search: req.query.search,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await userService.getUsers(
        filters,
        pagination,
        req.user.userType,
        req.user.userId,
      );
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`List users failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_LIST_USERS_FAILED",
        "Failed to fetch users",
      );
    }
  }

  // Approve or reject agent (super admin only)
  async updateAgentStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const beforeUser = await userService.getUserById(id);
      const updated = await userService.updateUserStatus(id, { status });

      await this.logAudit(req, {
        userId: req.user?.userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
        category: AUDIT_CATEGORIES.USER,
        resource: { userId: id },
        changes: {
          before: beforeUser
            ? {
                status: beforeUser.status,
                userType: beforeUser.userType,
              }
            : null,
          after: {
            status: updated.status,
            userType: updated.userType,
          },
        },
        metadata: {
          changedBy: req.user?.userId,
          source: "auth.updateAgentStatus",
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      if (status === "active" || status === "rejected") {
        emailService.sendAccountStatusEmail(
          updated.email,
          updated.fullName,
          status,
          updated.businessName,
          req.appContext,
        );
      }

      res.json({
        success: true,
        message: `Agent status updated to ${updated.status}`,
      });
    } catch (error) {
      logger.error(`Update agent status failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_UPDATE_AGENT_STATUS_FAILED",
        "Failed to update agent status",
      );
    }
  }

  // Get single user by ID (super admin only)
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      if (!user)
        return this.sendAuthErrorByCode(
          res,
          404,
          "AUTH_USER_NOT_FOUND",
          "User not found",
        );
      res.json({ success: true, user });
    } catch (error) {
      logger.error(`Get user by ID failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_GET_USER_FAILED",
        "Failed to fetch user",
      );
    }
  }

  // Update user info (super admin only)
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const beforeUser = await userService.getUserById(id);
      const updated = await userService.updateUser(id, req.body);

      await this.logAudit(req, {
        userId: req.user?.userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.USER_UPDATED,
        category: AUDIT_CATEGORIES.USER,
        resource: { userId: id },
        changes: {
          before: beforeUser,
          after: updated,
        },
        metadata: {
          changedFields: Object.keys(req.body || {}),
          changedBy: req.user?.userId,
        },
        severity: AUDIT_SEVERITIES.INFO,
      });

      res.json({ success: true, user: updated });
    } catch (error) {
      logger.error(`Update user failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_UPDATE_USER_FAILED",
        "Failed to update user",
      );
    }
  }

  // Super admin: Reset user password
  async resetUserPassword(req, res) {
    try {
      const { id } = req.params;
      await userService.resetUserPassword(id, req.body.newPassword);

      await this.logAudit(req, {
        userId: req.user?.userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
        category: AUDIT_CATEGORIES.AUTH,
        resource: { userId: id },
        metadata: {
          changedByAdmin: true,
          changedBy: req.user?.userId,
        },
        severity: AUDIT_SEVERITIES.WARNING,
      });

      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      logger.error(`Reset user password failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_RESET_USER_PASSWORD_FAILED",
        "Failed to reset password",
      );
    }
  }

  // Super admin: Delete user
  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const targetUser = await userService.getUserById(id);
      await userService.deleteUser(id);

      await this.logAudit(req, {
        userId: req.user?.userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.USER_DELETED,
        category: AUDIT_CATEGORIES.USER,
        resource: { userId: id },
        changes: {
          before: targetUser,
          after: null,
        },
        metadata: {
          deletedBy: req.user?.userId,
        },
        severity: AUDIT_SEVERITIES.WARNING,
      });

      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      logger.error(`Delete user failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_DELETE_USER_FAILED",
        "Failed to delete user",
      );
    }
  }

  // Super admin: Impersonate user (return JWT for that user)
  async impersonateUser(req, res) {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user) {
        return this.sendAuthErrorByCode(
          res,
          404,
          "AUTH_USER_NOT_FOUND",
          "User not found",
        );
      }

      // Only allow impersonation of non-super_admin users
      if (user.userType === "super_admin") {
        return this.sendAuthErrorByCode(
          res,
          403,
          "AUTH_IMPERSONATION_FORBIDDEN",
          "Cannot impersonate another super admin",
        );
      }

      // Generate short-lived access token for impersonated user
      const accessToken = this.generateAccessToken(user._id, user.userType);

      // Generate a refresh token for the impersonated session and persist it
      const refreshToken = this.generateRefreshToken(user._id);
      user.refreshToken = refreshToken; // store so /refresh endpoint will accept it
      await user.save();

      // Set refresh token cookie for the impersonated session (same options as login)
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (impersonation should be short-lived)
      };
      res.cookie("refreshToken", refreshToken, cookieOptions);

      // Return both tokens so frontend can persist admin tokens and set impersonated cookies
      await this.logAudit(req, {
        userId: req.user?.userId,
        userType: req.user?.userType,
        action: AUDIT_ACTIONS.USER_IMPERSONATED,
        category: AUDIT_CATEGORIES.USER,
        resource: {
          impersonatedUserId: user._id,
        },
        metadata: {
          impersonatedUserType: user.userType,
          impersonatedBy: req.user?.userId,
        },
        severity: AUDIT_SEVERITIES.CRITICAL,
      });

      res.json({
        success: true,
        token: accessToken,
        refreshToken,
        user,
      });
    } catch (error) {
      logger.error(`Impersonate user failed: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_IMPERSONATION_FAILED",
        "Failed to impersonate user",
      );
    }
  }

  // Debug endpoint to check current user info
  async debugUser(req, res) {
    try {
      logger.debug(
        `Debug user request - User: ${req.user.email}, UserType: "${req.user.userType}", Full user object:`,
        req.user,
      );

      res.json({
        success: true,
        user: {
          id: req.user.userId,
          email: req.user.email,
          userType: req.user.userType,
          fullName: req.user.fullName,
        },
      });
    } catch (error) {
      logger.error(`Debug user error: ${error.message}`);
      return this.sendAuthError(
        res,
        error,
        "AUTH_DEBUG_FAILED",
        "Debug failed",
      );
    }
  }
}

const authController = new AuthController();
export default {
  registerAgent: authController.registerAgent.bind(authController),
  login: authController.login.bind(authController),
  getAgentDashboard: authController.getAgentDashboard.bind(authController),
  verifyAccount: authController.verifyAccount.bind(authController),
  forgotPassword: authController.forgotPassword.bind(authController),
  resetPassword: authController.resetPassword.bind(authController),
  setupPin: authController.setupPin.bind(authController),
  verifyToken: authController.verifyToken.bind(authController),
  logout: authController.logout.bind(authController),
  refreshToken: authController.refreshToken.bind(authController),
  resendVerification: authController.resendVerification.bind(authController),
  updateFirstTimeFlag: authController.updateFirstTimeFlag.bind(authController),
  registerSuperAdmin: authController.registerSuperAdmin.bind(authController),
  sendOtp: authController.sendOtp.bind(authController),
  verifyOtp: authController.verifyOtp.bind(authController),
  listUsers: authController.listUsers.bind(authController),
  updateAgentStatus: authController.updateAgentStatus.bind(authController),
  getUserById: authController.getUserById.bind(authController),
  updateUser: authController.updateUser.bind(authController),
  resetUserPassword: authController.resetUserPassword.bind(authController),
  deleteUser: authController.deleteUser.bind(authController),
  impersonateUser: authController.impersonateUser.bind(authController),
  debugUser: authController.debugUser.bind(authController),
};
