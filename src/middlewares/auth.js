// src/middlewares/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import logger from "../utils/logger.js";
import {
  isBusinessUser,
  canHaveWallet,
  isTenantUser,
  isAdminUser,
} from "../utils/userTypeHelpers.js";

export const authenticate = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      logger.warn("Authentication attempt without token");
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    // Verify access token
    const decoded = jwt.verify(token, process.env.JWTSECRET);
    const user = await User.findById(decoded.userId).select(
      "-password -refreshToken"
    );

    if (!user) {
      logger.warn(`Token valid but user not found: ${decoded.userId}`);
      return res.status(401).json({
        success: false,
        message: "Invalid token. User not found.",
      });
    }

    // Create user object without tenantId first
    const userObject = {
      userId: user._id.toString(),
      email: user.email,
      userType: user.userType,
      ...user.toJSON(), // Spread user data first
    };

    // Determine tenantId value
    let tenantIdValue;
    if (decoded.tenantId) {
      tenantIdValue = decoded.tenantId.toString();
    } else if (user.tenantId) {
      tenantIdValue = user.tenantId.toString();
    } else {
      tenantIdValue = user._id.toString();
    }

    // Then set tenantId to ensure it overrides any ObjectId from user.toJSON()
    userObject.tenantId = tenantIdValue;

    req.user = userObject;

    // Removed excessive debug logging
    // logger.debug(
    //   `Authenticated user: ${user.email}, tenantId: ${userObject.tenantId}`
    // );
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      logger.warn("Access token expired");
      return res.status(401).json({
        success: false,
        message: "Token expired",
        code: "TOKEN_EXPIRED",
      });
    }

    logger.error(`Token verification failed: ${err.message}`);
    res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    // Removed excessive debug logging
    // logger.debug(
    //   `Authorization check - User:`,
    //   req.user,
    //   `Required roles: [${roles.join(", ")}]`
    // );
    if (!roles.includes(req.user.userType)) {
      logger.warn(
        `Unauthorized access attempt by ${req.user.email} (userType: "${req.user.userType}") to ${req.originalUrl}`
      );
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
        user: req.user,
        requiredRoles: roles,
      });
    }
    next();
  };
};

// Authorization middleware for business users (agent, super_agent, dealer, super_dealer)
// Also allows super_admin for administrative access to agent commissions
export const authorizeBusinessUser = (req, res, next) => {
  // Removed excessive debug logging
  // logger.debug(
  //   `Business user authorization check - User: ${req.user.email} (${req.user.userType})`
  // );
  if (
    !isBusinessUser(req.user.userType) &&
    req.user.userType !== "super_admin"
  ) {
    logger.warn(
      `Unauthorized business access attempt by ${req.user.email} (userType: "${req.user.userType}") to ${req.originalUrl}`
    );
    return res.status(403).json({
      success: false,
      message: "Access denied. Business user privileges required.",
      userType: req.user.userType,
    });
  }
  next();
};

// Authorization middleware for wallet-enabled users
export const authorizeWalletUser = (req, res, next) => {
  // Removed excessive debug logging
  // logger.debug(
  //   `Wallet user authorization check - User: ${req.user.email} (${req.user.userType})`
  // );
  if (!canHaveWallet(req.user.userType)) {
    logger.warn(
      `Unauthorized wallet access attempt by ${req.user.email} (userType: "${req.user.userType}") to ${req.originalUrl}`
    );
    return res.status(403).json({
      success: false,
      message: "Access denied. Wallet privileges required.",
      userType: req.user.userType,
    });
  }
  next();
};

// Authorization middleware for tenant users (can manage others)
export const authorizeTenantUser = (req, res, next) => {
  // Removed excessive debug logging
  // logger.debug(
  //   `Tenant user authorization check - User: ${req.user.email} (${req.user.userType})`
  // );
  if (!isTenantUser(req.user.userType)) {
    logger.warn(
      `Unauthorized tenant access attempt by ${req.user.email} (userType: "${req.user.userType}") to ${req.originalUrl}`
    );
    return res.status(403).json({
      success: false,
      message: "Access denied. Tenant privileges required.",
      userType: req.user.userType,
    });
  }
  next();
};

// Authorization middleware for admin users
export const authorizeAdmin = (req, res, next) => {
  // Removed excessive debug logging
  // logger.debug(
  //   `Admin authorization check - User: ${req.user.email} (${req.user.userType})`
  // );
  if (!isAdminUser(req.user.userType)) {
    logger.warn(
      `Unauthorized admin access attempt by ${req.user.email} (userType: "${req.user.userType}") to ${req.originalUrl}`
    );
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
      userType: req.user.userType,
    });
  }
  next();
};
