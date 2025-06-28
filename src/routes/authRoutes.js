// src/routes/authRoutes.js
import express from 'express';
import authController from '../controllers/authController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import {
  registerAgentValidation,
  registerCustomerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation
} from '../validators/authValidator.js';

const router = express.Router();

// Create validation middlewares (same pattern as product routes)
const validateRegisterAgent = validate(registerAgentValidation);
const validateRegisterCustomer = validate(registerCustomerValidation);
const validateLogin = validate(loginValidation);
const validateForgotPassword = validate(forgotPasswordValidation);
const validateResetPassword = validate(resetPasswordValidation);

// Public routes
router.post('/register/agent', validateRegisterAgent, authController.registerAgent);
router.post('/register/customer', validateRegisterCustomer, authController.registerCustomer);
router.post('/login', validateLogin, authController.login);
router.post('/verify-account', authController.verifyAccount);
router.post('/forgot-password', validateForgotPassword, authController.forgotPassword);
router.post('/reset-password', validateResetPassword, authController.resetPassword);

// Protected routes
router.post('/verify-token', authenticate, authController.verifyToken);
router.post('/logout', authenticate, authController.logout);

// Agent-specific routes
router.get('/agent/dashboard', authenticate, authorize('agent'), authController.getAgentDashboard);

export default router;