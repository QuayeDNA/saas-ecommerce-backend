import crypto from "crypto";
import Otp from "../models/Otp.js";
import logger from "../utils/logger.js";
import emailService from "./emailService.js";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

class OtpService {
  generateCode() {
    const min = Math.pow(10, OTP_LENGTH - 1);
    const max = Math.pow(10, OTP_LENGTH) - 1;
    const code = crypto.randomInt(min, max).toString();
    return code;
  }

  _maskEmail(email) {
    if (!email) return "";
    const [name, domain] = email.split("@");
    if (!domain) return email;
    const visible = name.slice(0, 2);
    return `${visible}***@${domain}`;
  }

  _maskPhone(phone) {
    if (!phone || phone.length < 6) return phone || "";
    return phone.slice(0, 3) + "***" + phone.slice(-3);
  }

  async sendOtpNotification(phone, code, email, channelOverride) {
    const provider = channelOverride || (process.env.SMS_PROVIDER || "log").toLowerCase();

    switch (provider) {
      case "vonage":
        await this._sendViaVonage(phone, code);
        break;
      case "twilio":
        await this._sendViaTwilio(phone, code);
        break;
      case "email":
        await this._sendViaEmail(email, code);
        break;
      case "phone":
      case "log":
      default:
        logger.info(`[OTP] Development mode. Code for ${phone}: ${code}`);
        break;
    }

    return provider === "phone" ? "log" : provider;
  }

  async _sendViaVonage(phone, code) {
    try {
      const { default: Vonage } = await import("@vonage/server-sdk");
      const vonage = new Vonage({
        apiKey: process.env.VONAGE_API_KEY,
        apiSecret: process.env.VONAGE_API_SECRET,
      });
      await vonage.sms.send({
        to: phone,
        from: process.env.SMS_FROM || "SaaSApp",
        text: `Your verification code is: ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      });
      logger.info(`[OTP] Sent via Vonage to ${phone}`);
    } catch (error) {
      logger.error(`[OTP] Vonage send failed: ${error.message}`);
      throw new Error("Failed to send OTP via SMS");
    }
  }

  async _sendViaTwilio(phone, code) {
    try {
      const { default: Twilio } = await import("twilio");
      const client = new Twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );
      await client.messages.create({
        body: `Your verification code is: ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER,
      });
      logger.info(`[OTP] Sent via Twilio to ${phone}`);
    } catch (error) {
      logger.error(`[OTP] Twilio send failed: ${error.message}`);
      throw new Error("Failed to send OTP via SMS");
    }
  }

  async _sendViaEmail(email, code) {
    if (!email) {
      logger.warn("[OTP] Email provider selected but no email provided");
      return;
    }
    try {
      await emailService.sendOtpEmail(email, code);
      logger.info(`[OTP] Sent via email to ${email}`);
    } catch (error) {
      logger.error(`[OTP] Email send failed: ${error.message}`);
      throw new Error("Failed to send OTP via email");
    }
  }

  async sendOtp(phone, email, channel) {
    const code = this.generateCode();

    await Otp.deleteMany({ phone, verified: false });

    await Otp.create({
      phone,
      code,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      maxAttempts: OTP_MAX_ATTEMPTS,
    });

    const actualProvider = await this.sendOtpNotification(phone, code, email, channel);

    const actualChannel = actualProvider === "email" ? "email" : "phone";
    const maskedContact =
      actualChannel === "email" ? this._maskEmail(email) : this._maskPhone(phone);

    logger.info(`[OTP] Code generated and sent via ${actualChannel} to ${maskedContact}`);
    return { success: true, channel: actualChannel, maskedContact };
  }

  async verifyOtp(phone, code) {
    const otpRecord = await Otp.findOne({
      phone,
      verified: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      logger.warn(`[OTP] No valid OTP found for ${phone}`);
      return { success: false, message: "No valid OTP found. Request a new code." };
    }

    if (otpRecord.isMaxAttemptsReached()) {
      logger.warn(`[OTP] Max attempts reached for ${phone}`);
      return { success: false, message: "Too many attempts. Request a new code." };
    }

    otpRecord.attempts += 1;

    if (otpRecord.code !== code) {
      await otpRecord.save();
      const remaining = otpRecord.maxAttempts - otpRecord.attempts;
      logger.warn(`[OTP] Invalid code for ${phone}. ${remaining} attempts left`);
      return { success: false, message: `Invalid code. ${remaining} attempt(s) remaining.` };
    }

    otpRecord.verified = true;
    await otpRecord.save();

    logger.info(`[OTP] Phone verified successfully: ${phone}`);
    return { success: true, message: "Phone number verified successfully." };
  }

  async isPhoneVerified(phone) {
    const record = await Otp.findOne({
      phone,
      verified: true,
    }).sort({ createdAt: -1 });

    return !!record;
  }
}

const otpService = new OtpService();
export default otpService;
