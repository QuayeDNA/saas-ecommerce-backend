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

// Payout Settings - also visible to any authenticated user to know minimums
router.get("/payout", settingsController.getPayoutSettings);

// Fee Settings - visible to any authenticated user (agents need it for storefront pricing)
router.get("/fees", settingsController.getFeeSettings);

// Allow authenticated users to read API settings (paystack toggles etc)
// This is useful for frontend components like TopUpRequestModal which need to
// know whether paystack is enabled without requiring super_admin role.
router.get("/api", settingsController.getApiSettings);

// BryteLinks — GET available to all authenticated users (agents need to check payment gate)
router.get("/brytelinks", settingsController.getBryteLinksSettings);

// All other routes require super admin authorization
router.use(authorize("super_admin"));

// Super‑admin may update wallet or payout settings
router.put("/wallet", settingsController.updateWalletSettings);
router.put("/payout", settingsController.updatePayoutSettings);
router.put("/fees", settingsController.updateFeeSettings);

// Site Management
router.get("/site", settingsController.getSiteSettings);
router.put("/site", settingsController.updateSiteSettings);
router.post("/site/toggle", settingsController.toggleSiteStatus);

// Signup Approval Setting - PUT requires super admin (GET is public above)
router.put("/signup-approval", settingsController.updateSignupApprovalSetting);

// Storefront Auto-Approval
router.get(
  "/storefront-auto-approve",
  settingsController.getAutoApproveStorefronts,
);
router.put(
  "/storefront-auto-approve",
  settingsController.updateAutoApproveStorefronts,
);

// Storefront Availability (global)
router.post(
  "/storefronts/toggle",
  settingsController.toggleStorefrontsAvailability,
);

// API Settings (PUT remains protected)
router.put("/api", settingsController.updateApiSettings);

// User Management
router.post("/users/reset-password", settingsController.resetUserPassword);
router.post("/users/change-role", settingsController.changeUserRole);

// System Information
router.get("/system", settingsController.getSystemInfo);

// Admin Password Change
router.post("/admin/change-password", settingsController.changeAdminPassword);

// Referral & Commission Settings — super_admin only
router.get("/referral", settingsController.getReferralSettings);
router.put("/referral", settingsController.updateReferralSettings);

// BryteLinks — Storefront Payment Gate & Auto-Suspend Settings (PUT only)
router.put("/brytelinks", settingsController.updateBryteLinksSettings);

export default router;
