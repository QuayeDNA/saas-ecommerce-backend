// src/controllers/authController.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authService from "../services/authService.js";
import logger from "../utils/logger.js";
import { BUSINESS_ROLES } from "../constants/roles.js";
import { isBusinessUser, getTenantId } from "../utils/userTypeHelpers.js";
import userService from "../services/userService.js";

class AuthController {
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

  // Register new agent (multi-tenant admin)
  async registerAgent(req, res) {
    try {
      const result = await userService.registerAgent(req.body, req.appContext);
      res.status(201).json({
        success: true,
        message:
          result.userStatus === "pending"
            ? `${result.userType} account created successfully. Your account is pending approval by a super admin.`
            : `${result.userType} account created successfully. You can now log in.`,
        agentCode: result.agentCode,
        userType: result.userType,
      });
    } catch (error) {
      logger.error(`Agent registration error: ${error.message}`);
      res.status(error.statusCode || 500).json({
        success: false,
        message:
          error.message || "Agent registration failed. Please try again.",
      });
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
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // Check password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        logger.warn(`Invalid password for user: ${email}`);
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      // Email verification is no longer required - all users are auto-verified
      // The check is removed to allow immediate login after registration

      // Block login if user is not active
      if (user.status !== "active" || user.isActive === false) {
        logger.warn(
          `Login attempt for user with status '${user.status}' or inactive: ${email}`,
        );
        return res.status(401).json({
          success: false,
          message:
            user.isActive === false
              ? "Your account has been deactivated by an administrator."
              : user.status === "pending"
                ? "Your account is pending approval by a super admin."
                : "Your account has been rejected. Please contact support.",
        });
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
      res.status(500).json({
        success: false,
        message: "Login failed. Please try again.",
      });
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
      res
        .status(500)
        .json({
          success: false,
          message: error.message || "Failed to load dashboard data",
        });
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
        return res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
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

      res.json({
        success: true,
        message,
        userType: user.userType,
        status: user.status,
      });
    } catch (error) {
      logger.error(`Account verification error: ${error.message}`);

      // Handle JWT errors specifically
      if (error.name === "JsonWebTokenError") {
        return res.status(400).json({
          success: false,
          message: "Invalid verification token format",
        });
      } else if (error.name === "TokenExpiredError") {
        return res.status(400).json({
          success: false,
          message:
            "Verification token has expired. Please request a new verification email.",
        });
      }

      res.status(400).json({
        success: false,
        message: "Invalid or expired verification token",
      });
    }
  }
  // Set up security PIN
  async setupPin(req, res) {
    try {
      const { pin } = req.body;
      const userId = req.user._id;

      await authService.setupPin(userId, pin);

      logger.info(`Security PIN setup successfully for user: ${userId}`);
      res.json({
        success: true,
        message: "Security PIN configured successfully",
      });
    } catch (error) {
      logger.error(`Setup PIN error: ${error.message}`);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to setup Security PIN",
      });
    }
  }

  // Forgot password via PIN
  async forgotPassword(req, res) {
    try {
      const { identifier, pin } = req.body;
      if (!identifier || !pin) {
        return res
          .status(400)
          .json({ success: false, message: "Identifier and PIN are required" });
      }

      const result = await authService.forgotPasswordWithPin(identifier, pin);

      logger.info(`Password reset token generated via PIN for: ${identifier}`);
      res.json({
        success: true,
        resetToken: result.resetToken,
        message: result.message,
      });
    } catch (error) {
      logger.error(`Forgot password via PIN error: ${error.message}`);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to process password reset",
      });
    }
  }

  // Reset password
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;

      await authService.resetPasswordWithToken(token, password);

      logger.info(`Password reset successfully via token`);
      res.json({
        success: true,
        message:
          "Password reset successfully. Please login with your new password.",
      });
    } catch (error) {
      logger.error(`Reset password error: ${error.message}`);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to reset password",
      });
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
        return res.status(401).json({
          success: false,
          message: "Refresh token not provided",
        });
      }

      // Verify refresh token
      const decoded = jwt.verify(
        token,
        process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET,
      );

      if (decoded.type !== "refresh") {
        return res.status(401).json({
          success: false,
          message: "Invalid token type",
        });
      }

      // Find user and verify refresh token
      const user = await User.findById(decoded.userId);
      if (!user || user.refreshToken !== token) {
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token",
        });
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
      res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
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
      res.status(401).json({
        success: false,
        valid: false,
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
      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error(`Logout error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Logout failed",
      });
    }
  }

  // Resend verification token (limited to one resend)
  async resendVerification(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      // Find user by email
      const user = await User.findOne({ email });

      if (!user) {
        logger.warn(
          `Verification resend attempt for non-existent user: ${email}`,
        );
        return res.status(404).json({
          success: false,
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
          message: "This account is already verified",
        });
      }

      // Check if this is the first resend attempt
      if (user.verificationResent) {
        logger.warn(`Multiple verification resend attempts for: ${email}`);
        return res.status(400).json({
          success: false,
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
      res.status(500).json({
        success: false,
        message: "Failed to resend verification email. Please try again.",
      });
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
      res.json({
        success: true,
        message: "User preferences updated successfully",
      });
    } catch (error) {
      logger.error(`Error updating first-time flag: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update user preferences",
      });
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
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
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
      res.status(500).json({
        success: false,
        message: "Super admin registration failed. Please try again.",
      });
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
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to fetch users",
        });
    }
  }

  // Approve or reject agent (super admin only)
  async updateAgentStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updated = await userService.updateUserStatus(id, { status });
      res.json({
        success: true,
        message: `Agent status updated to ${updated.status}`,
      });
    } catch (error) {
      logger.error(`Update agent status failed: ${error.message}`);
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to update agent status",
        });
    }
  }

  // Get single user by ID (super admin only)
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      if (!user)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      res.json({ success: true, user });
    } catch (error) {
      logger.error(`Get user by ID failed: ${error.message}`);
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to fetch user",
        });
    }
  }

  // Update user info (super admin only)
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updated = await userService.updateUser(id, req.body);
      res.json({ success: true, user: updated });
    } catch (error) {
      logger.error(`Update user failed: ${error.message}`);
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to update user",
        });
    }
  }

  // Super admin: Reset user password
  async resetUserPassword(req, res) {
    try {
      const { id } = req.params;
      await userService.resetUserPassword(id, req.body.newPassword);
      res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      logger.error(`Reset user password failed: ${error.message}`);
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to reset password",
        });
    }
  }

  // Super admin: Delete user
  async deleteUser(req, res) {
    try {
      const { id } = req.params;
      await userService.deleteUser(id);
      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      logger.error(`Delete user failed: ${error.message}`);
      res
        .status(error.statusCode || 500)
        .json({
          success: false,
          message: error.message || "Failed to delete user",
        });
    }
  }

  // Super admin: Impersonate user (return JWT for that user)
  async impersonateUser(req, res) {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // Only allow impersonation of non-super_admin users
      if (user.userType === "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Cannot impersonate another super admin",
        });
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
      res.json({
        success: true,
        token: accessToken,
        refreshToken,
        user,
      });
    } catch (error) {
      logger.error(`Impersonate user failed: ${error.message}`);
      res
        .status(500)
        .json({ success: false, message: "Failed to impersonate user" });
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
      res.status(500).json({
        success: false,
        message: "Debug failed",
      });
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
  listUsers: authController.listUsers.bind(authController),
  updateAgentStatus: authController.updateAgentStatus.bind(authController),
  getUserById: authController.getUserById.bind(authController),
  updateUser: authController.updateUser.bind(authController),
  resetUserPassword: authController.resetUserPassword.bind(authController),
  deleteUser: authController.deleteUser.bind(authController),
  impersonateUser: authController.impersonateUser.bind(authController),
  debugUser: authController.debugUser.bind(authController),
};
