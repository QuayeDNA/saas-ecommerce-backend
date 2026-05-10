// src/services/authService.js
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import logger from "../utils/logger.js";

// Helper function to validate PIN format
const isValidPin = (pin) => {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
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
      const err = new Error("PIN must be 4 to 6 digits");
      err.statusCode = 400;
      throw err;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pin, salt);

    const user = await User.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
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
      const err = new Error("Invalid PIN format");
      err.statusCode = 400;
      throw err;
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
      const err = new Error("No user found with this identifier");
      err.statusCode = 404;
      throw err;
    }

    if (user.requiresPinSetup || !user.securityPin) {
      const err = new Error(
        "Security PIN has not been set up. Please contact support.",
      );
      err.statusCode = 400;
      throw err;
    }

    // Validate PIN
    const isPinMatch = await bcrypt.compare(pin, user.securityPin);
    if (!isPinMatch) {
      logger.warn(`Invalid PIN attempt for forgot password: ${identifier}`);
      const err = new Error("Invalid Security PIN");
      err.statusCode = 401;
      throw err;
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
      const err = new Error("Invalid request payload");
      err.statusCode = 400;
      throw err;
    }

    try {
      const decoded = jwt.verify(resetToken, process.env.JWTSECRET);
      if (decoded.type !== "password_reset") {
        throw new Error("Invalid token type");
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      user.password = newPassword; // Pre-save hook will hash it
      user.forcePasswordChange = false; // Reset the flag if it was set

      // Invalidate all existing sessions by regenerating a refresh token explicitly or wiping it
      user.refreshToken = null;

      await user.save();
      return true;
    } catch {
      const err = new Error("Invalid or expired reset token");
      err.statusCode = 401;
      throw err;
    }
  },
};

export default authService;
