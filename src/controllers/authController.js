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
      expiresIn: "7d",
    });
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

      // Generate verification token
      const verificationToken = jwt.sign({ email }, process.env.JWTSECRET, {
        expiresIn: "24h",
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

      // Generate verification token
      const verificationToken = jwt.sign({ email }, process.env.JWTSECRET, {
        expiresIn: "24h",
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

      // Generate token with tenant context
      const tokenExpiry = rememberMe ? "30d" : "7d";
      const tenantId = user.userType === "agent" ? user._id : user.tenantId;

      const token = jwt.sign(
        { userId: user._id, userType: user.userType, tenantId },
        process.env.JWTSECRET,
        { expiresIn: tokenExpiry }
      );

      logger.info(
        `User logged in successfully: ${email} - Type: ${user.userType}`
      );
      res.json({
        success: true,
        user: user.toJSON(),
        token,
        dashboardUrl:
          user.userType === "agent"
            ? `/agent/dashboard`
            : `/customer/dashboard`,
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

  // Verify account (same as before)
  async verifyAccount(req, res) {
    try {
      const { token } = req.body;

      const decoded = jwt.verify(token, process.env.JWTSECRET);
      const user = await User.findOne({
        email: decoded.email,
        verificationToken: token,
      });

      if (!user) {
        logger.warn(`Invalid verification token: ${token}`);
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token",
        });
      }

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

  // Verify token[1]
  async verifyToken(req, res) {
    try {
      // If we reach here, the token is valid (middleware already verified it)
      res.json({
        success: true,
        valid: true,
        user: req.user.toJSON(),
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

  // Logout[1]
  async logout(req, res) {
    try {
      // In a stateless JWT system, logout is handled client-side
      // You could implement token blacklisting here if needed
      logger.info(`User logged out: ${req.user.email}`);
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
};
