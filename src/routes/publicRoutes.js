// src/routes/publicRoutes.js
import express from "express";
import packageController from "../controllers/packageController.js";
import bundleController from "../controllers/bundleController.js";

const router = express.Router();

// Dynamic PWA manifest route
router.get("/manifest", (req, res) => {
  const { theme = "#142850" } = req.query;

  const manifest = {
    name: "BryteLinks - Telecom Solutions",
    short_name: "BryteLinks",
    description:
      "A modern SaaS platform for telecommunication services. Purchase airtime for MTN, Vodafone, and AirtelTigo networks in Ghana.",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
      {
        src: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/logo-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/logo-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    theme_color: theme,
    background_color: theme,
    display: "standalone",
    start_url: "/",
    orientation: "portrait-primary",
    categories: ["business", "finance", "utilities"],
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.json(manifest);
});

// Public package routes (no authentication required)
router.get("/packages", packageController.getPackages);
router.get("/packages/:id", packageController.getPackage);
router.get(
  "/packages/provider/:provider",
  packageController.getPackagesByProvider
);
router.get(
  "/packages/category/:category",
  packageController.getPackagesByCategory
);

// Public bundle routes (no authentication required)
router.get("/bundles", bundleController.getAllBundles);
router.get("/bundles/:id", bundleController.getBundleById);
router.get(
  "/bundles/provider/:providerId",
  bundleController.getBundlesByProvider
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
