// src/routes/storefrontRoutes.js
import express from "express";
import {
  getStorefront,
  getStorefrontBundles,
  createStorefrontOrder,
  uploadPaymentProof,
  createStorefront,
  getAgentStorefront,
  updateStorefront,
  addPaymentMethod,
  updatePaymentMethod,
  setPricing,
  getPendingOrders,
  confirmPayment,
  getAllStorefronts,
  updateStorefrontStatus
} from "../controllers/storefrontController.js";
import { authenticate, authorize, authorizeBusinessUser } from "../middlewares/auth.js";
import { storefrontRateLimit, storefrontOrderRateLimit, storefrontUploadRateLimit } from "../middlewares/storefrontRateLimit.js";
import { validateStorefrontInput, validateOrderInput, validatePaymentConfirmation, sanitizeInput } from "../middlewares/storefrontValidation.js";
import { uploadPaymentProof as uploadMiddleware, handleUploadError, cleanupUploadedFile } from "../middlewares/storefrontUpload.js";

const router = express.Router();

// Public storefront routes (no authentication required)
router.get("/:businessName",
  storefrontRateLimit,
  sanitizeInput,
  getStorefront
);

router.get("/:businessName/bundles",
  storefrontRateLimit,
  sanitizeInput,
  getStorefrontBundles
);

router.post("/:businessName/orders",
  storefrontOrderRateLimit,
  sanitizeInput,
  validateOrderInput,
  createStorefrontOrder
);

// Public payment proof upload (can be done by customer or agent)
router.post("/orders/:orderId/payment-proof",
  storefrontUploadRateLimit,
  uploadMiddleware.single('paymentProof'),
  handleUploadError,
  cleanupUploadedFile,
  sanitizeInput,
  uploadPaymentProof
);

// All other routes require authentication
router.use(authenticate);

// Agent storefront management routes
router.post("/",
  authorizeBusinessUser,
  validateStorefrontInput,
  createStorefront
);

router.get("/",
  authorizeBusinessUser,
  getAgentStorefront
);

router.put("/:storefrontId",
  authorizeBusinessUser,
  validateStorefrontInput,
  updateStorefront
);

// Payment method management
router.post("/:storefrontId/payment-methods",
  authorizeBusinessUser,
  validateStorefrontInput,
  addPaymentMethod
);

router.put("/:storefrontId/payment-methods/:methodId",
  authorizeBusinessUser,
  validateStorefrontInput,
  updatePaymentMethod
);

// Pricing management
router.put("/:storefrontId/pricing",
  authorizeBusinessUser,
  validateStorefrontInput,
  setPricing
);

// Storefront status management
router.put("/:storefrontId/activate",
  authorizeBusinessUser,
  updateStorefrontStatus
);

router.put("/:storefrontId/deactivate",
  authorizeBusinessUser,
  updateStorefrontStatus
);

// Order management
router.get("/orders/pending",
  authorizeBusinessUser,
  getPendingOrders
);

router.put("/orders/:orderId/confirm",
  authorizeBusinessUser,
  uploadMiddleware.single('paymentProof'),
  handleUploadError,
  cleanupUploadedFile,
  validatePaymentConfirmation,
  confirmPayment
);

// Admin routes
router.get("/admin/all",
  authorize("super_admin", "super_dealer"),
  getAllStorefronts
);

router.put("/admin/:storefrontId/status",
  authorize("super_admin", "super_dealer"),
  updateStorefrontStatus
);

export default router;