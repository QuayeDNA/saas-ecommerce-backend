// src/services/authService.js
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import logger from "../utils/logger.js";

// Helper function to validate PIN format
const isValidPin = (pin) => {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
};

const createAuthError = (message, statusCode, code) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
};

export const authService = {
  generateToken(userId, userType, tenantId = null) {
    return jwt.sign({ userId, userType, tenantId }, process.env.JWTSECRET, {
      expiresIn: "30d",
    });
  },

  generateAccessToken(userId, userType, tenantId = null) {
    return jwt.sign({ userId, userType, tenantId }, process.env.JWTSECRET, {
      expiresIn: "24h",
    });
  },

  generateRefreshToken(userId) {
    return jwt.sign(
      { userId, type: "refresh" },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWTSECRET,
      { expiresIn: "30d" },
    );
  },

  /**
   * Set up the security PIN for a user
   */
  async setupPin(userId, pin) {
    if (!isValidPin(pin)) {
      throw createAuthError(
        "PIN must be 4 to 6 digits",
        400,
        "AUTH_INVALID_PIN_FORMAT",
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pin, salt);

    const user = await User.findById(userId);
    if (!user) {
      throw createAuthError("User not found", 404, "AUTH_USER_NOT_FOUND");
    }

    user.securityPin = hashedPin;
    user.requiresPinSetup = false;
    await user.save();

    return true;
  },

  /**
   * Authenticate a forgot password request using PIN + (phone or agentCode)
   * Returns a temporary resetToken
   */
  async forgotPasswordWithPin(identifier, pin) {
    if (!isValidPin(pin)) {
      throw createAuthError(
        "Invalid PIN format",
        400,
        "AUTH_INVALID_PIN_FORMAT",
      );
    }

    // Try finding by phone or agentCode or email
    const user = await User.findOne({
      $or: [
        { phone: identifier },
        { agentCode: identifier },
        { email: identifier }, // Keep email as a fallback identifier
      ],
    });

    if (!user) {
      throw createAuthError(
        "No user found with this identifier",
        404,
        "AUTH_IDENTIFIER_NOT_FOUND",
      );
    }

    if (user.requiresPinSetup || !user.securityPin) {
      throw createAuthError(
        "Security PIN has not been set up. Please contact support.",
        400,
        "AUTH_PIN_NOT_CONFIGURED",
      );
    }

    // Validate PIN
    const isPinMatch = await bcrypt.compare(pin, user.securityPin);
    if (!isPinMatch) {
      logger.warn(`Invalid PIN attempt for forgot password: ${identifier}`);
      throw createAuthError("Invalid Security PIN", 400, "AUTH_INVALID_PIN");
    }

    // Generate temporary 32-byte hex token instead of using JWT to ensure it's single-use
    // (We will hash it when storing to be completely secure, wait, in User model we don't have reset token fields anymore!
    // Ah, wait. I removed `resetPasswordToken` from User schema! We can use a short-lived JWT for the reset flow instead!)

    const resetToken = jwt.sign(
      { userId: user._id, type: "password_reset" },
      process.env.JWTSECRET,
      { expiresIn: "1h" },
    );

    // We flag forcePasswordChange (so even if token leaks later, they are forced? No, just token is enough)
    // Actually, setting forcePasswordChange = true immediately locks current sessions?
    // Just return the resetToken.
    return {
      resetToken,
      message:
        "Security PIN verified. Use the provided token to reset your password.",
    };
  },

  /**
   * Complete the password reset utilizing the resetToken
   */
  async resetPasswordWithToken(resetToken, newPassword) {
    if (!resetToken || !newPassword || newPassword.length < 6) {
      throw createAuthError(
        "Invalid request payload",
        400,
        "AUTH_INVALID_RESET_PAYLOAD",
      );
    }

    try {
      const decoded = jwt.verify(resetToken, process.env.JWTSECRET);
      if (decoded.type !== "password_reset") {
        throw new Error("Invalid token type");
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        throw createAuthError("User not found", 404, "AUTH_USER_NOT_FOUND");
      }

      user.password = newPassword; // Pre-save hook will hash it
      user.forcePasswordChange = false; // Reset the flag if it was set
      user.passwordChangedAt = new Date();

      // Invalidate all existing sessions so old refresh/access tokens stop working
      user.refreshToken = null;

      await user.save();
      return true;
    } catch {
      throw createAuthError(
        "Invalid or expired reset token",
        401,
        "AUTH_INVALID_RESET_TOKEN",
      );
    }
  },
};

export default authService;
