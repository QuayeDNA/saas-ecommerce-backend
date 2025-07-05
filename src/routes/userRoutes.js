// src/routes/userRoutes.js
import express from 'express';
import userController from '../controllers/userController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import validate from '../middlewares/validate.js';
import { userValidation } from '../validators/userValidator.js';

const router = express.Router();

// Profile management (all authenticated users)
router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, validate(userValidation.updateProfile), userController.updateProfile);
router.post('/change-password', authenticate, validate(userValidation.changePassword), userController.changePassword);

// AFA Registration (all authenticated users)
router.post('/afa-registration', authenticate, validate(userValidation.afaRegistration), userController.afaRegistration);
router.get('/afa-registration', authenticate, userController.getAfaRegistration);

// User management (Agents can view their customers, Super admin can view all)
router.get('/', authenticate, authorize('agent', 'super_admin'), userController.getUsers);
router.get('/stats', authenticate, authorize('agent', 'super_admin'), userController.getUserStats);
router.get('/:id', authenticate, userController.getUserById);

// Admin only routes
router.put('/:id/status', authenticate, authorize('super_admin'), validate(userValidation.updateUserStatus), userController.updateUserStatus);
router.delete('/:id', authenticate, authorize('super_admin'), userController.deleteUser);

export default router;
