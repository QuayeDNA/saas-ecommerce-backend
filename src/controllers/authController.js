// src/controllers/authController.js
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import emailService from "../services/emailService.js";
import logger from "../utils/logger.js";

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
      { expiresIn: "24h" } // Extended to 24 hours for better user experience
    );
  }

  // Generate refresh token (long-lived)
  generateRefreshToken(userId) {
    return jwt.sign(
      { userId, type: 'refresh' },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET,
      { expiresIn: "30d" } // Extended to 30 days for better user experience
    );
  }

  // Generate unique agent code
  generateAgentCode(businessName) {
    const prefix = businessName.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString().slice(-6);
    return `${prefix}${timestamp}`;
  }

  // Register new agent (multi-tenant admin)
  async registerAgent(req, res) {
    try {
      const {
        fullName,
        email,
        phone,
        password,
        businessName,
        businessCategory,
        subscriptionPlan = "basic",
      } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        logger.warn(`Agent registration attempt with existing email: ${email}`);
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      // Generate verification token (10 minute expiry)
      const verificationToken = jwt.sign({ email }, process.env.JWTSECRET, {
        expiresIn: "10m", // 10 minutes instead of 24 hours
      });

      // Create agent (they are their own tenant)
      const agent = new User({
        fullName,
        email,
        phone,
        password,
        userType: "agent",
        businessName,
        businessCategory,
        subscriptionPlan,
        subscriptionStatus: "active",
        verificationToken,
      });

      await agent.save();

      // Generate agent code for customer registration
      const agentCode = this.generateAgentCode(businessName);

      // Send verification email
      await emailService.sendAgentVerificationEmail(
        email,
        verificationToken,
        agentCode
      );

      logger.info(
        `Agent registered successfully: ${email} - Business: ${businessName}`
      );
      res.status(201).json({
        success: true,
        message:
          "Agent account created successfully. Please check your email to verify your account.",
        agentCode: agentCode,
      });
    } catch (error) {
      logger.error(`Agent registration error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Agent registration failed. Please try again.",
      });
    }
  }

  // Register new customer (associated with agent)
  async registerCustomer(req, res) {
    try {
      const { fullName, email, phone, password, agentCode } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        logger.warn(
          `Customer registration attempt with existing email: ${email}`
        );
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      let tenantId = null;

      // If agent code provided, find the agent
      if (agentCode) {
        // For now, we'll implement agent lookup by business name prefix
        // In production, you'd store agent codes in a separate collection
        const agent = await User.findOne({
          userType: "agent",
          businessName: new RegExp(`^${agentCode.substring(0, 3)}`, "i"),
        });

        if (!agent) {
          return res.status(400).json({
            success: false,
            message: "Invalid agent code provided",
          });
        }

        tenantId = agent._id;
      }

      // Generate verification token (10 minute expiry)
      const verificationToken = jwt.sign({ email }, process.env.JWTSECRET, {
        expiresIn: "10m", // 10 minutes instead of 24 hours
      });

      // Create customer
      const customer = new User({
        fullName,
        email,
        phone,
        password,
        userType: "customer",
        tenantId,
        verificationToken,
      });

      await customer.save();

      // Send verification email
      await emailService.sendVerificationEmail(email, verificationToken);

      logger.info(
        `Customer registered successfully: ${email} - Agent: ${
          tenantId || "None"
        }`
      );
      res.status(201).json({
        success: true,
        message:
          "Customer account created successfully. Please check your email to verify your account.",
      });
    } catch (error) {
      logger.error(`Customer registration error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Customer registration failed. Please try again.",
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

      // Check if account is verified
      if (!user.isVerified) {
        logger.warn(`Login attempt with unverified account: ${email}`);
        return res.status(401).json({
          success: false,
          message: "Please verify your account before logging in",
        });
      }

      // For agents, check subscription status
      if (user.userType === "agent" && user.subscriptionStatus !== "active") {
        logger.warn(`Login attempt with inactive subscription: ${email}`);
        return res.status(401).json({
          success: false,
          message: "Your subscription is inactive. Please contact support.",
        });
      }

      // Generate tokens
      const tenantId = user.userType === "agent" ? user._id : user.tenantId;
      const accessToken = this.generateAccessToken(user._id, user.userType, tenantId);
      const refreshToken = this.generateRefreshToken(user._id);

      // Store refresh token in user document (optional - for token invalidation)
      user.refreshToken = refreshToken;
      await user.save();

      // Set refresh token as httpOnly cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // 30 days or 7 days
      };

      res.cookie('refreshToken', refreshToken, cookieOptions);

      logger.info(`User logged in successfully: ${email} - Type: ${user.userType}`);
      
      // Check for first-time login for agents
      if (user.userType === "agent" && user.isFirstTime) {
        // Import wallet service dynamically to avoid circular dependency
        const walletService = (await import('../services/walletService.js')).default;
        
        // Initialize wallet with 100 GH₵
        try {
          await walletService.initializeAgentWallet(user._id);
          // Update first time flag
          user.isFirstTime = false;
          await user.save();
          logger.info(`Initialized agent wallet for first login: ${user.email}`);
        } catch (walletError) {
          logger.error(`Failed to initialize agent wallet: ${walletError.message}`);
          // Continue login process even if wallet initialization fails
        }
      }
      
      const userData = user.toJSON();
      
      res.json({
        success: true,
        user: userData,
        token: accessToken,
        refreshToken: refreshToken, // Also send in response for frontend storage
        dashboardUrl: user.userType === "agent" ? `/agent/dashboard` : `/customer/dashboard`,
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
      const agentId = req.user.userId;

      // Get agent's customers count
      const customerCount = await User.countDocuments({
        tenantId: agentId,
        userType: "customer",
      });

      // Get recent customers (last 10)
      const recentCustomers = await User.find({
        tenantId: agentId,
        userType: "customer",
      })
        .select("fullName email phone createdAt isVerified")
        .sort({ createdAt: -1 })
        .limit(10);

      const dashboardData = {
        totalCustomers: customerCount,
        recentCustomers,
        businessInfo: {
          businessName: req.user.businessName,
          businessCategory: req.user.businessCategory,
          subscriptionPlan: req.user.subscriptionPlan,
          subscriptionStatus: req.user.subscriptionStatus,
        },
      };

      res.json({
        success: true,
        data: dashboardData,
      });
    } catch (error) {
      logger.error(`Agent dashboard error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to load dashboard data",
      });
    }
  }

  // Verify account (fixed implementation with debugging)
  async verifyAccount(req, res) {
    try {
      const { token } = req.body;
      
      logger.info(`Verification attempt with token: ${token ? 'provided' : 'missing'}`);

      if (!token) {
        logger.warn('No token provided in request body');
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
        isVerified: false // Only allow verification if not already verified
      });

      if (!user) {
        // Additional debugging
        const userByEmail = await User.findOne({ email: decoded.email });
        if (!userByEmail) {
          logger.warn(`No user found with email: ${decoded.email}`);
        } else {
          logger.warn(`User found but verification failed - isVerified: ${userByEmail.isVerified}, hasVerificationToken: ${!!userByEmail.verificationToken}`);
        }
        
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token, or account already verified",
        });
      }

      // Mark user as verified and clear verification token
      user.isVerified = true;
      user.verificationToken = undefined;
      await user.save();

      logger.info(`Account verified successfully: ${user.email}`);
      res.json({
        success: true,
        message: "Account verified successfully. You can now log in.",
        userType: user.userType,
      });
    } catch (error) {
      logger.error(`Account verification error: ${error.message}`);
      
      // Handle JWT errors specifically
      if (error.name === 'JsonWebTokenError') {
        return res.status(400).json({
          success: false,
          message: "Invalid verification token format",
        });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(400).json({
          success: false,
          message: "Verification token has expired. Please request a new verification email.",
        });
      }
      
      res.status(400).json({
        success: false,
        message: "Invalid or expired verification token",
      });
    }
  }

  // Forgot password[1]
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        logger.warn(`Password reset request for non-existent user: ${email}`);
        return res.status(404).json({
          success: false,
          message: "User not found with this email",
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();

      // Send reset email
      await emailService.sendPasswordResetEmail(email, resetToken);

      logger.info(`Password reset email sent to: ${email}`);
      res.json({
        success: true,
        message: "Password reset email sent successfully",
      });
    } catch (error) {
      logger.error(`Forgot password error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to send password reset email",
      });
    }
  }

  // Reset password[1]
  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;

      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() },
      });

      if (!user) {
        logger.warn(`Invalid or expired reset token: ${token}`);
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      logger.info(`Password reset successfully for user: ${user.email}`);
      res.json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      logger.error(`Reset password error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to reset password",
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
          message: "Refresh token not provided"
        });
      }

      // Verify refresh token
      const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET);
      
      if (decoded.type !== 'refresh') {
        return res.status(401).json({
          success: false,
          message: "Invalid token type"
        });
      }

      // Find user and verify refresh token
      const user = await User.findById(decoded.userId);
      if (!user || user.refreshToken !== token) {
        return res.status(401).json({
          success: false,
          message: "Invalid refresh token"
        });
      }

      // Generate new tokens
      const tenantId = user.userType === "agent" ? user._id : user.tenantId;
      const newAccessToken = this.generateAccessToken(user._id, user.userType, tenantId);
      const newRefreshToken = this.generateRefreshToken(user._id);

      // Update stored refresh token
      user.refreshToken = newRefreshToken;
      await user.save();

      // Set new refresh token cookie
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      };

      res.cookie('refreshToken', newRefreshToken, cookieOptions);

      logger.info(`Token refreshed for user: ${user.email}`);
      
      res.json({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: user.toJSON()
      });
    } catch (error) {
      logger.error(`Token refresh error: ${error.message}`);
      res.status(401).json({
        success: false,
        message: "Invalid refresh token"
      });
    }
  }

  // Enhanced verify token
  async verifyToken(req, res) {
    try {
      // Token is already verified by middleware, just return user data
      const user = await User.findById(req.user.userId).select('-password -refreshToken');
      
      if (!user) {
        return res.status(401).json({
          success: false,
          valid: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        valid: true,
        user: user.toJSON(),
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
          $unset: { refreshToken: 1 } 
        });
      }

      // Clear refresh token cookie
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });

      logger.info(`User logged out: ${req.user?.email || 'Unknown'}`);
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
        logger.warn(`Verification resend attempt for non-existent user: ${email}`);
        return res.status(404).json({
          success: false,
          message: "No account found with this email address",
        });
      }
      
      // Check if account is already verified
      if (user.isVerified) {
        logger.warn(`Verification resend attempt for already verified account: ${email}`);
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
          message: "Verification email has already been resent. Please register again if you still cannot verify your account.",
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
      if (user.userType === 'agent') {
        // Generate agent code again
        const agentCode = this.generateAgentCode(user.businessName);
        await emailService.sendAgentVerificationEmail(email, verificationToken, agentCode);
      } else {
        await emailService.sendVerificationEmail(email, verificationToken);
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
        isFirstTime: false 
      });

      logger.info(`First-time flag updated for user: ${req.user.email}`);
      res.json({
        success: true,
        message: "User preferences updated successfully"
      });
    } catch (error) {
      logger.error(`Error updating first-time flag: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to update user preferences"
      });
    }
  }
}

const authController = new AuthController();
export default {
  registerAgent: authController.registerAgent.bind(authController),
  registerCustomer: authController.registerCustomer.bind(authController),
  login: authController.login.bind(authController),
  getAgentDashboard: authController.getAgentDashboard.bind(authController),
  verifyAccount: authController.verifyAccount.bind(authController),
  forgotPassword: authController.forgotPassword.bind(authController),
  resetPassword: authController.resetPassword.bind(authController),
  verifyToken: authController.verifyToken.bind(authController),
  logout: authController.logout.bind(authController),
  refreshToken: authController.refreshToken.bind(authController),
  resendVerification: authController.resendVerification.bind(authController),
  updateFirstTimeFlag: authController.updateFirstTimeFlag.bind(authController),
};
