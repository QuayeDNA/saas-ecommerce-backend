// src/routes/publicRoutes.js
import express from "express";
import packageController from "../controllers/packageController.js";
import bundleController from "../controllers/bundleController.js";
import { buildManifestForApp } from "../utils/appContextResolver.js";

const router = express.Router();

// Dynamic PWA manifest route
router.get("/manifest", (req, res) => {
  const { theme = "#142850" } = req.query;

  res.setHeader("Content-Type", "application/manifest+json");
  res.json(buildManifestForApp({ appId: req.appContext?.appId, theme }));
});

// Public package routes (no authentication required)
router.get("/packages", packageController.getPackages);
router.get("/packages/:id", packageController.getPackage);
router.get(
  "/packages/provider/:provider",
  packageController.getPackagesByProvider,
);
router.get(
  "/packages/category/:category",
  packageController.getPackagesByCategory,
);

// Public bundle routes (no authentication required)
router.get("/bundles", bundleController.getAllBundles);
router.get("/bundles/:id", bundleController.getBundleById);
router.get(
  "/bundles/provider/:providerId",
  bundleController.getBundlesByProvider,
);
router.get("/bundles/package/:packageId", bundleController.getBundlesByPackage);

// Public provider routes (no authentication required)
router.get("/providers", (req, res) => {
  // Simple provider list for public access
  const providers = [
    { code: "MTN", name: "MTN Ghana" },
    { code: "TELECEL", name: "Telecel Ghana" },
    { code: "AT", name: "AirtelTigo" },
  ];
  res.json({ success: true, providers });
});

export default router;
