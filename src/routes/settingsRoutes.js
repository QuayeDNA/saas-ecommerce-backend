import express from 'express';
import settingsController from '../controllers/settingsController.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const router = express.Router();

// =============================================================================
// SETTINGS ROUTES
// =============================================================================

// Public site status endpoint (no auth required)
router.get('/site/status', settingsController.getSiteStatus);

// All other routes require authentication and super admin authorization
router.use(authenticate);
router.use(authorize('super_admin'));

// Site Management
router.get('/site', settingsController.getSiteSettings);
router.put('/site', settingsController.updateSiteSettings);
router.post('/site/toggle', settingsController.toggleSiteStatus);

// Commission Rates
router.get('/commission', settingsController.getCommissionRates);
router.put('/commission', settingsController.updateCommissionRates);

// API Settings
router.get('/api', settingsController.getApiSettings);
router.put('/api', settingsController.updateApiSettings);

// User Management
router.post('/users/reset-password', settingsController.resetUserPassword);
router.post('/users/change-role', settingsController.changeUserRole);

// System Information
router.get('/system', settingsController.getSystemInfo);

// Admin Password Change
router.post('/admin/change-password', settingsController.changeAdminPassword);

export default router; 