import nodemailer from "nodemailer";
import logger from "../utils/logger.js";
import { resolveEmailTheme, buildEmailStyles, buildEmailLayout } from "../utils/emailThemeProvider.js";

class EmailService {
  constructor() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      const missingVars = [];
      if (!process.env.EMAIL_USER) missingVars.push("EMAIL_USER");
      if (!process.env.EMAIL_PASSWORD) missingVars.push("EMAIL_PASSWORD");

      logger.warn(
        `Gmail configuration missing. Email features disabled. Missing environment variables: ${missingVars.join(", ")}`,
      );
      this.enabled = false;
      this.transporter = null;
      return;
    }

    const transportOptions = {
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    };

    this.transporter = nodemailer.createTransport(transportOptions);
    this.enabled = true;
  }

  async verifyConnection() {
    if (!this.enabled) {
      logger.warn("Email transporter not configured; skipping verification");
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info("Email transporter connection verified successfully");
      return true;
    } catch (error) {
      logger.error(`Email transporter verification failed: ${error.message}`);
      return false;
    }
  }

  async sendAgentVerificationEmail(email, token, agentCode, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;

    const subject = `Welcome to ${theme.brandName} - Verify Your Agent Account`;

    if (!this.enabled) {
      logger.warn(
        `[EMAIL_DISABLED] Skipping agent verification email to ${email}`,
      );
      logger.info(
        `[EMAIL_DISABLED] Verification Link (simulated): ${verificationUrl}`,
      );
      logger.info(`[EMAIL_DISABLED] Agent Code: ${agentCode}`);
      return;
    }

    const contentHtml = `
      <p style="${s.text}">Your agent account has been created successfully.</p>
      <p style="${s.text}"><strong>Your Agent Code:</strong> <code style="background: ${theme.bodyBg}; padding: 4px 8px; border-radius: 4px; color: ${theme.primary};">${agentCode}</code></p>
      <p style="${s.textSecondary}">Share this code with customers so they can register under your business.</p>
      <p style="${s.textSecondary}">Please click the button below to verify your account:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" style="${s.button}">Verify Agent Account</a>
      </div>
      <p style="${s.textSecondary}">This link will expire in 10 minutes.</p>
      <p style="${s.textMuted}">Keep your agent code secure and only share it with legitimate customers.</p>
    `;

    const html = buildEmailLayout({ title: "Verify Your Account", contentHtml, theme, logoUrl: theme.logoUrl });

    if (process.env.NODE_ENV === "development") {
      logger.info(`[DEV] Simulated agent verification email to ${email}`);
      logger.info(`[DEV] Verification Link: ${verificationUrl}`);
      logger.info(`[DEV] Agent Code: ${agentCode}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`Agent verification email sent to ${email}`);
    } catch (error) {
      logger.error(`Failed to send agent verification email: ${error.message}`);
      throw new Error("Failed to send verification email");
    }
  }

  async sendVerificationEmail(email, token, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;

    const subject = `Verify Your Account - ${theme.brandName}`;

    if (!this.enabled) {
      logger.warn(
        `[EMAIL_DISABLED] Skipping customer verification email to ${email}`,
      );
      logger.info(
        `[EMAIL_DISABLED] Verification Link (simulated): ${verificationUrl}`,
      );
      return;
    }

    const contentHtml = `
      <p style="${s.text}">Welcome to ${theme.brandName}!</p>
      <p style="${s.textSecondary}">Please click the button below to verify your account:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" style="${s.button}">Verify Account</a>
      </div>
      <p style="${s.textSecondary}">This link will expire in 10 minutes.</p>
    `;

    const html = buildEmailLayout({ title: "Welcome!", contentHtml, theme, logoUrl: theme.logoUrl });

    if (process.env.NODE_ENV === "development") {
      logger.info(`[DEV] Simulated customer verification email to ${email}`);
      logger.info(`[DEV] Verification Link: ${verificationUrl}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`Customer verification email sent to ${email}`);
    } catch (error) {
      logger.error(
        `Failed to send customer verification email: ${error.message}`,
      );
      throw new Error("Failed to send verification email");
    }
  }

  async sendPasswordResetEmail(email, token, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    const subject = `Password Reset Request - ${theme.brandName}`;

    if (!this.enabled) {
      logger.warn(`[EMAIL_DISABLED] Skipping password reset email to ${email}`);
      logger.info(
        `[EMAIL_DISABLED] Reset Link (simulated): ${resetUrl}`,
      );
      return;
    }

    const contentHtml = `
      <p style="${s.text}">You requested to reset your password. Click the button below to proceed:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="${s.button}">Reset Password</a>
      </div>
      <p style="${s.textSecondary}">This link will expire in 1 hour.</p>
      <p style="${s.textMuted}">If you didn't request this password reset, please ignore this email.</p>
    `;

    const html = buildEmailLayout({ title: "Password Reset", contentHtml, theme, logoUrl: theme.logoUrl });

    if (process.env.NODE_ENV === "development") {
      logger.info(
        `[DEV] Simulated password reset email to ${email}:`,
        { subject },
      );
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`Password reset email sent to ${email}`, {
        messageId: info.messageId,
      });
      return info;
    } catch (error) {
      logger.error(
        `Failed to send password reset email to ${email}: ${error.message}`,
      );
      throw new Error("Failed to send password reset email");
    }
  }

  async sendOtpEmail(email, code, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);

    const isDev = process.env.NODE_ENV === "development";
    const subject = `Your Verification Code - ${theme.brandName}`;

    if (!this.enabled) {
      logger.info(`[DEV] OTP code for ${email}: ${code}`);
      return { simulated: true, code };
    }

    if (isDev) {
      logger.info(`[DEV] OTP code for ${email}: ${code}`);
    }

    const contentHtml = `
      <p style="${s.text}">Your verification code is:</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="${s.otpCode}">${code}</span>
      </div>
      <p style="${s.textSecondary}">This code will expire in 10 minutes.</p>
      <p style="${s.textMuted}">If you didn't request this code, please ignore this email.</p>
    `;

    const html = buildEmailLayout({ title: "Email Verification", contentHtml, theme, logoUrl: theme.logoUrl });

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`OTP email sent to ${email}`, {
        messageId: info.messageId,
      });
      return info;
    } catch (error) {
      logger.error(`Failed to send OTP email to ${email}: ${error.message}`);
      if (isDev) {
        logger.info(`[DEV] Email send failed — using simulated code: ${code}`);
        return { simulated: true, code };
      }
      throw new Error("Failed to send OTP email");
    }
  }

  async sendAccountStatusEmail(email, fullName, status, businessName, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);
    const isApproved = status === "active";

    const subject = isApproved
      ? `Your Account Has Been Approved! - ${theme.brandName}`
      : `Your Account Has Been Declined - ${theme.brandName}`;

    const headerGradient = isApproved
      ? `linear-gradient(135deg, ${theme.success}, ${theme.accent})`
      : `linear-gradient(135deg, ${theme.error}, #e74c3c)`;

    const contentHtml = `
      <p style="${s.text}">Dear ${fullName},</p>
      ${isApproved
        ? `
        <p style="${s.text}">
          Congratulations! Your account${businessName ? ` for <strong>${businessName}</strong>` : ""} has been approved.
        </p>
        <p style="${s.text}">
          You can now log in and start using all the features of our platform.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/login"
             style="${s.button}">
            Log In to Your Account
          </a>
        </div>
        `
        : `
        <p style="${s.text}">
          We regret to inform you that your account${businessName ? ` for <strong>${businessName}</strong>` : ""} has been declined.
        </p>
        <p style="${s.textSecondary}">
          If you believe this is an error or would like more information, please contact our support team.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/contact"
             style="${s.buttonSecondary}">
            Contact Support
          </a>
        </div>
        `
      }
    `;

    const html = buildEmailLayout({
      title: `Account ${isApproved ? "Approved" : "Declined"}`,
      contentHtml,
      theme: { ...theme, headerGradient },
      logoUrl: theme.logoUrl,
    });

    if (process.env.NODE_ENV === "development") {
      logger.info(`[DEV] Account status email to ${email}: ${subject}`);
      if (!this.enabled) return;
    }

    if (!this.enabled) {
      logger.warn(`[EMAIL_DISABLED] Skipping account status email to ${email}`);
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`Account status email sent to ${email}`, { messageId: info.messageId });
      return info;
    } catch (error) {
      logger.error(`Failed to send account status email to ${email}: ${error.message}`);
    }
  }

  async sendWelcomeEmail(email, userName, appContext) {
    const theme = resolveEmailTheme(appContext);
    const s = buildEmailStyles(theme);

    const subject = `Welcome to ${theme.brandName}!`;

    if (!this.enabled) {
      logger.warn(`[EMAIL_DISABLED] Skipping welcome email to ${email}`);
      return;
    }

    const contentHtml = `
      <p style="${s.text}">Welcome ${userName}!</p>
      <p style="${s.textSecondary}">Thank you for joining ${theme.brandName}. We're excited to have you on board!</p>
      <p style="${s.textSecondary}">You can now start exploring our platform and building your online store.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL}/dashboard" style="${s.button}">Get Started</a>
      </div>
      <p style="${s.textMuted}">If you have any questions, feel free to contact our support team.</p>
    `;

    const html = buildEmailLayout({ title: `Welcome to ${theme.brandName}`, contentHtml, theme, logoUrl: theme.logoUrl });

    if (process.env.NODE_ENV === "development") {
      logger.info(`[DEV] Simulated welcome email to ${email}:`, { subject });
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html,
      });
      logger.info(`Welcome email sent to ${email}`, {
        messageId: info.messageId,
      });
      return info;
    } catch (error) {
      logger.error(
        `Failed to send welcome email to ${email}: ${error.message}`,
      );
      throw new Error("Failed to send welcome email");
    }
  }
}

export default new EmailService();
