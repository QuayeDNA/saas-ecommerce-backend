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

// MoMo Bridge — GET available to all authenticated users (agents need it for checkout)
router.get("/momobridge", settingsController.getMomoBridgeSettings);

// MTN Restriction — GET available to all authenticated users (agents need it to know if restriction is active)
router.get("/mtn-restriction", settingsController.getMtnRestrictionSettings);

// Cross-App Wallet Transfer — GET available to all authenticated users (agents need it for the transfer dialog)
router.get("/wallet-transfer", settingsController.getCrossAppTransferSettings);

// All other routes require super admin authorization
router.use(authorize("super_admin"));

// Connected Apps
router.get("/connected-apps", settingsController.getConnectedApps);
router.post("/connected-apps", settingsController.addConnectedApp);
router.put("/connected-apps/:appId", settingsController.updateConnectedApp);
router.delete("/connected-apps/:appId", settingsController.removeConnectedApp);
router.post("/connected-apps/:appId/test", settingsController.testConnectedApp);

// Integration Key
router.get("/integration-key", settingsController.getIntegrationKey);
router.post("/integration-key/regenerate", settingsController.regenerateIntegrationKey);

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

// MoMo Bridge — Mobile Money Payment Verification Settings (PUT only)
router.put("/momobridge", settingsController.updateMomoBridgeSettings);

// Cross-App Wallet Transfer — Settings (PUT only, super_admin)
router.put("/wallet-transfer", settingsController.updateCrossAppTransferSettings);

// MTN Order Restriction
router.put("/mtn-restriction", settingsController.updateMtnRestrictionSettings);
router.post("/mtn-numbers/import", settingsController.importMtnNumbers);
router.get("/mtn-numbers/stats", settingsController.getMtnNumberStats);

// Known Number CRUD
router.get("/mtn-numbers", settingsController.listMtnNumbers);
router.post("/mtn-numbers", settingsController.addMtnNumber);
router.delete("/mtn-numbers/:id", settingsController.deleteMtnNumber);
router.post("/mtn-numbers/bulk-delete", settingsController.bulkDeleteMtnNumbers);

export default router;
