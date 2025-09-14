// src/services/emailService.js
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

class EmailService {
  constructor() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      const missingVars = [];
      if (!process.env.EMAIL_USER) missingVars.push('EMAIL_USER');
      if (!process.env.EMAIL_PASSWORD) missingVars.push('EMAIL_PASSWORD');
      
      throw new Error(`Gmail configuration missing. Required environment variables: ${missingVars.join(', ')}`);
    }

    // Gmail SMTP configuration
    const transportOptions = {
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    };
    
    this.transporter = nodemailer.createTransport(transportOptions);
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      logger.info('Email transporter connection verified successfully');
      return true;
    } catch (error) {
      logger.error(`Email transporter verification failed: ${error.message}`);
      return false;
    }
  }

   async sendAgentVerificationEmail(email, token, agentCode) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to SaaS E-commerce - Verify Your Agent Account',
      html: `
        <h2>Welcome to SaaS E-commerce Platform!</h2>
        <p>Your agent account has been created successfully.</p>
        <p><strong>Your Agent Code:</strong> <code>${agentCode}</code></p>
        <p>Share this code with customers so they can register under your business.</p>
        <p>Please click the link below to verify your account:</p>
        <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Agent Account</a>
        <p>This link will expire in 10 minutes.</p>
        <hr>
        <p><small>Keep your agent code secure and only share it with legitimate customers.</small></p>
      `
    };

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV] Simulated agent verification email to ${email}`);
      logger.info(`[DEV] Verification Link: ${verificationUrl}`);
      logger.info(`[DEV] Agent Code: ${agentCode}`);
      return;
    }

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Agent verification email sent to ${email}`);
    } catch (error) {
      logger.error(`Failed to send agent verification email: ${error.message}`);
      throw new Error('Failed to send verification email');
    }
  }

  async sendVerificationEmail(email, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your Customer Account',
      html: `
        <h2>Welcome to SaaS E-commerce!</h2>
        <p>Please click the link below to verify your customer account:</p>
        <a href="${verificationUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Account</a>
        <p>This link will expire in 10 minutes.</p>
      `
    };

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV] Simulated customer verification email to ${email}`);
      logger.info(`[DEV] Verification Link: ${verificationUrl}`);
      return;
    }

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Customer verification email sent to ${email}`);
    } catch (error) {
      logger.error(`Failed to send customer verification email: ${error.message}`);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>You requested to reset your password. Click the button below to proceed:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #dc3545; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 1 hour.
          </p>
          <p style="color: #666; font-size: 12px;">
            If you didn't request this password reset, please ignore this email.
          </p>
        </div>
      `
    };

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV] Simulated password reset email to ${email}:`, mailOptions);
      return;
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}`, { messageId: info.messageId });
      return info;
    } catch (error) {
      logger.error(`Failed to send password reset email to ${email}: ${error.message}`);
      throw new Error('Failed to send password reset email');
    }
  }

  async sendWelcomeEmail(email, userName) {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to SaaS E-commerce!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome ${userName}!</h2>
          <p>Thank you for joining SaaS E-commerce. We're excited to have you on board!</p>
          <p>You can now start exploring our platform and building your online store.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/dashboard" 
               style="background-color: #28a745; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Get Started
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            If you have any questions, feel free to contact our support team.
          </p>
        </div>
      `
    };

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV] Simulated welcome email to ${email}:`, mailOptions);
      return;
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Welcome email sent to ${email}`, { messageId: info.messageId });
      return info;
    } catch (error) {
      logger.error(`Failed to send welcome email to ${email}: ${error.message}`);
      throw new Error('Failed to send welcome email');
    }
  }
}

export default new EmailService();