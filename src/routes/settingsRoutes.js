import express from "express";
import settingsController from "../controllers/settingsController.js";
import { authenticate, authorize } from "../middlewares/auth.js";

const router = express.Router();

// =============================================================================
// SETTINGS ROUTES
// =============================================================================

// Public site status endpoint (no auth required)
router.get("/site/status", settingsController.getSiteStatus);

// Public signup approval setting (no auth required - needed for registration flow)
router.get("/signup-approval", settingsController.getSignupApprovalSetting);

// Wallet Settings - GET available to all authenticated users for validation
router.use(authenticate);
router.get("/wallet", settingsController.getWalletSettings);

// All other routes require super admin authorization
router.use(authorize("super_admin"));

// Site Management
router.get("/site", settingsController.getSiteSettings);
router.put("/site", settingsController.updateSiteSettings);
router.post("/site/toggle", settingsController.toggleSiteStatus);

// Signup Approval Setting - PUT requires super admin (GET is public above)
router.put("/signup-approval", settingsController.updateSignupApprovalSetting);

// Storefront Auto-Approval
router.get("/storefront-auto-approve", settingsController.getAutoApproveStorefronts);
router.put("/storefront-auto-approve", settingsController.updateAutoApproveStorefronts);

// Commission Rates
router.get("/commission", settingsController.getCommissionRates);
router.put("/commission", settingsController.updateCommissionRates);

// API Settings
router.get("/api", settingsController.getApiSettings);
router.put("/api", settingsController.updateApiSettings);

// User Management
router.post("/users/reset-password", settingsController.resetUserPassword);
router.post("/users/change-role", settingsController.changeUserRole);

// System Information
router.get("/system", settingsController.getSystemInfo);

// Admin Password Change
router.post("/admin/change-password", settingsController.changeAdminPassword);

// Wallet Settings - PUT requires super admin
router.put("/wallet", settingsController.updateWalletSettings);

export default router;
