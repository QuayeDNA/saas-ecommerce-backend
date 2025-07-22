// src/routes/authRoutes.js
import express from 'express';
import authController from '../controllers/authController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import {
  registerAgentValidation,
  registerCustomerValidation,
  registerSuperAdminValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation
} from '../validators/authValidator.js';

const router = express.Router();

// Create validation middlewares (same pattern as product routes)
const validateRegisterAgent = validate(registerAgentValidation);
const validateRegisterCustomer = validate(registerCustomerValidation);
const validateRegisterSuperAdmin = validate(registerSuperAdminValidation);
const validateLogin = validate(loginValidation);
const validateForgotPassword = validate(forgotPasswordValidation);
const validateResetPassword = validate(resetPasswordValidation);

// Public routes
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/register/agent', authController.registerAgent);
router.post('/register/customer', authController.registerCustomer);
router.post('/register/super-admin', validateRegisterSuperAdmin, authController.registerSuperAdmin);
router.post('/verify-account', authController.verifyAccount);
router.post('/resend-verification', authController.resendVerification);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.post('/verify-token', authenticate, authController.verifyToken);
router.post('/logout', authenticate, authController.logout);
router.post('/update-first-time', authenticate, authController.updateFirstTimeFlag);

// Super admin user management routes
router.get('/users', authenticate, authorize('super_admin'), authController.listUsers);
router.get('/users/:id', authenticate, authorize('super_admin'), authController.getUserById);
router.patch('/users/:id/status', authenticate, authorize('super_admin'), authController.updateAgentStatus);

// Agent-specific routes
router.get('/agent/dashboard', authenticate, authorize('agent'), authController.getAgentDashboard);

export default router;