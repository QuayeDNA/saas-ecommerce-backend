// src/routes/storefrontRoutes.js
import express from "express";
import storefrontController from "../controllers/storefrontController.js";
import {
  authenticate,
  authorize,
  authorizeBusinessUser,
} from "../middlewares/auth.js";
import validate from "../middlewares/validate.js";
import { storefrontValidation } from "../validators/storefrontValidator.js";

const router = express.Router();

// Business user routes (protected)
router.post(
  "/",
  authenticate,
  authorizeBusinessUser,
  validate(storefrontValidation.create),
  storefrontController.createStorefront
);

router.put(
  "/",
  authenticate,
  authorizeBusinessUser,
  validate(storefrontValidation.update),
  storefrontController.updateStorefront
);

router.get(
  "/my-storefront",
  authenticate,
  authorizeBusinessUser,
  storefrontController.getStorefront
);

router.get(
  "/analytics",
  authenticate,
  authorizeBusinessUser,
  storefrontController.getStorefrontAnalytics
);

router.get(
  "/check-slug/:slug",
  authenticate,
  authorizeBusinessUser,
  storefrontController.checkSlugAvailability
);

router.patch(
  "/toggle-status",
  authenticate,
  authorizeBusinessUser,
  storefrontController.toggleStorefrontStatus
);

// Public routes (no authentication required)
router.get("/public/:slug", storefrontController.getPublicStorefront);

router.get(
  "/public/:slug/products",
  storefrontController.getStorefrontProducts
);

router.post(
  "/public/:slug/orders",
  validate(storefrontValidation.createOrder),
  storefrontController.createStorefrontOrder
);

export default router;
