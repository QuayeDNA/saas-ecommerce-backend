import express from "express";
import { validationResult } from "express-validator";
import verificationRequestController from "../controllers/verificationRequestController.js";
import { verificationRequestValidation } from "../validators/verificationRequestValidator.js";
import { authenticate, authorize, authorizeBusinessUser } from "../middlewares/auth.js";

const router = express.Router();

const validate = (validations) => async (req, res, next) => {
  for (const v of validations) await v.run(req);
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ─── Public routes (no auth required) ─────────────────────────────────────
// Used by the public storefront to check phone status and submit requests
// without requiring customer authentication.

router.get(
  "/public/check",
  validate(verificationRequestValidation.checkPhone),
  verificationRequestController.checkPhoneStatus,
);

router.post(
  "/public/submit",
  validate(verificationRequestValidation.submitRequest),
  verificationRequestController.submitPublicRequest,
);

// ─── Authenticated routes ──────────────────────────────────────────────────

router.use(authenticate);

// Agent/business user routes
router.get(
  "/my",
  authorizeBusinessUser,
  verificationRequestController.listMyRequests,
);

router.post(
  "/",
  authorizeBusinessUser,
  validate(verificationRequestValidation.submitRequest),
  verificationRequestController.submitRequest,
);

router.get(
  "/check",
  authorizeBusinessUser,
  validate(verificationRequestValidation.checkPhone),
  verificationRequestController.checkPhoneStatus,
);

// Super admin routes
router.get(
  "/",
  authorize("super_admin"),
  validate(verificationRequestValidation.listRequests),
  verificationRequestController.listRequests,
);

router.get(
  "/stats",
  authorize("super_admin"),
  verificationRequestController.getRequestStats,
);

router.get(
  "/pending/phones",
  authorize("super_admin"),
  verificationRequestController.listPendingPhones,
);

router.patch(
  "/:id/approve",
  authorize("super_admin"),
  validate(verificationRequestValidation.approveRequest),
  verificationRequestController.approveRequest,
);

router.patch(
  "/:id/reject",
  authorize("super_admin"),
  validate(verificationRequestValidation.rejectRequest),
  verificationRequestController.rejectRequest,
);

router.post(
  "/bulk-approve",
  authorize("super_admin"),
  validate(verificationRequestValidation.bulkApprove),
  verificationRequestController.bulkApprove,
);

router.post(
  "/bulk-reject",
  authorize("super_admin"),
  validate(verificationRequestValidation.bulkReject),
  verificationRequestController.bulkReject,
);

router.post(
  "/approve-all-pending",
  authorize("super_admin"),
  verificationRequestController.approveAllPending,
);

// Known Numbers management
router.get(
  "/known-numbers",
  authorize("super_admin"),
  verificationRequestController.listKnownNumbers,
);

router.get(
  "/known-numbers/stats",
  authorize("super_admin"),
  verificationRequestController.getKnownNumberStats,
);

router.post(
  "/known-numbers",
  authorize("super_admin"),
  verificationRequestController.addKnownNumber,
);

router.delete(
  "/known-numbers/:id",
  authorize("super_admin"),
  verificationRequestController.deleteKnownNumber,
);

router.post(
  "/known-numbers/bulk-delete",
  authorize("super_admin"),
  verificationRequestController.bulkDeleteKnownNumbers,
);

export default router;
