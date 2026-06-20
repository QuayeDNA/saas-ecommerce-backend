// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import connectDB from "./src/config/db.js";
import logger from "./src/utils/logger.js";
import websocketService from "./src/services/websocketService.js";
import { scheduleNotificationCleanup } from "./src/jobs/clearOldNotifications.js";
import { initializeReportedOrdersCleanupJob } from "./src/jobs/reportedOrdersCleanup.js";
import { initializeCancelledStorefrontOrdersCleanupJob } from "./src/jobs/cancelledStorefrontOrdersCleanup.js";
import announcementExpirationJob from "./src/jobs/announcementExpiration.js";
import { initializePendingPaymentExpiryJob } from "./src/jobs/pendingPaymentExpiry.js";
import { schedulePaystackVerificationRetryJob } from "./src/jobs/paystackVerificationRetry.js";
import { schedulePayoutReconciliationJob } from "./src/jobs/payoutReconciliationJob.js";

import { scheduleInactiveStoreSuspension } from "./src/jobs/inactiveStoreSuspension.js";
import authRoutes from "./src/routes/authRoutes.js";
import orderRouter from "./src/routes/orderRoutes.js";
import packageRoutes from "./src/routes/packageRoutes.js";
import bundleRoutes from "./src/routes/bundleRoutes.js";
import publicRoutes from "./src/routes/publicRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import providerRoutes from "./src/routes/providerRoutes.js";
import walletRoutes from "./src/routes/walletRoutes.js";
import settingsRoutes from "./src/routes/settingsRoutes.js";
import notificationRoutes from "./src/routes/notificationRoutes.js";
import analyticsRoutes from "./src/routes/analyticsRoutes.js";
import pushNotificationRoutes from "./src/routes/pushNotificationRoutes.js";
import announcementRoutes from "./src/routes/announcementRoutes.js";
import storefrontRoutes from "./src/routes/storefrontRoutes.js";
import paystackRoutes from "./src/routes/paystackRoutes.js";
import auditLogRoutes from "./src/routes/auditLogRoutes.js";
import commissionRoutes from "./src/routes/commissionRoutes.js";
import referralRoutes from "./src/routes/referralRoutes.js";
import assetRoutes from "./src/routes/assetRoutes.js";
import marketplaceRoutes from "./src/routes/marketplaceRoutes.js";
import adminMarketplaceRoutes from "./src/routes/adminMarketplaceRoutes.js";
import appContextMiddleware from "./src/middlewares/appContext.js";
import requestContextMiddleware from "./src/middlewares/requestContext.js";
import auditLogger from "./src/middlewares/auditLogger.js";
import { buildManifestForApp } from "./src/utils/appContextResolver.js";

// ─── App & Server ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app); // single HTTP server — WebSocket attaches here
const PORT = process.env.PORT || 5050;

// ─── Startup ──────────────────────────────────────────────────────────────────

logger.info("Starting SaaS E-Commerce backend...");

// Ensure DB connected and perform one-off startup tasks
(async () => {
  try {
    await connectDB();

    // ─── Background Jobs ───────────────────────────────────────────────────────
    scheduleNotificationCleanup();
    initializeReportedOrdersCleanupJob();
    initializePendingPaymentExpiryJob();
    initializeCancelledStorefrontOrdersCleanupJob();
    announcementExpirationJob();
    // Retry background Paystack verification for storefront orders and wallet top-ups
    schedulePaystackVerificationRetryJob();
    // Reconcile payouts stuck in 'processing' where the webhook never arrived
    schedulePayoutReconciliationJob();
    scheduleInactiveStoreSuspension();
  } catch (e) {
    logger.error(`Startup initialization failed: ${e.message}`);
    process.exit(1);
  }
})();

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Gather allowed origins from env + hardcoded
      const raw = [
        process.env.FRONTEND_URL,
        process.env.STOREFRONT_URL,
        "https://brytelinks.com",
        "https://www.brytelinks.com",
        "https://directdata.shop",
      ].filter(Boolean);

      // Normalise — strip trailing slash so exact matches work
      const allowed = raw.map((u) => u.replace(/\/+$/, ""));

      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) return callback(null, true);
      // Allow localhost (any port)
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      // Allow null origin in dev
      if (origin === "null" && process.env.NODE_ENV === "development") return callback(null, true);
      // Allow any Vercel preview
      if (/^https:\/\/saas-ecommerce[a-z0-9-]*\.vercel\.app$/.test(origin)) return callback(null, true);

      // Exact match (normalised)
      if (allowed.includes(origin.replace(/\/+$/, ""))) return callback(null, true);

      // Hostname-based match — catches www vs non-www, port variations, etc.
      try {
        const originHost = new URL(origin).hostname;
        const allowedHosts = allowed.map((u) => new URL(u).hostname);
        if (allowedHosts.some((h) => originHost === h || originHost.endsWith("." + h))) {
          return callback(null, true);
        }
      } catch {
        // malformed origin — fall through to deny
      }

      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

// Paystack webhook needs the raw body for HMAC signature verification.
// Capture it via express.json verify so req.body is still parsed.
app.use(
  "/api/webhooks/paystack",
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(appContextMiddleware());
app.use(requestContextMiddleware());
app.use(auditLogger());

// ─── Request Logging ──────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  const appId = req.appContext?.appId || "unknown";
  const appSource = req.appContext?.source || "unknown";
  logger.info(
    `${req.method} ${req.url} - ${req.ip} [app:${appId} via ${appSource}]`,
  );
  next();
});

// ─── Dynamic PWA Manifest ─────────────────────────────────────────────────────

app.get("/manifest", (req, res) => {
  const { theme = "#142850" } = req.query;
  res.setHeader("Content-Type", "application/manifest+json");
  res.json(buildManifestForApp({ appId: req.appContext?.appId, theme }));
});

// ─── Paystack Browser Callback Redirect ──────────────────────────────────────
// When the backend is publicly reachable and Paystack redirects the user's
// browser here after payment, forward them on to the frontend.

app.get("/wallet/topup/callback", async (req, res) => {
  const frontendBase = (
    process.env.FRONTEND_URL || "http://localhost:5173"
  ).replace(/\/$/, "");
  const qs = req.originalUrl.includes("?")
    ? "?" + req.originalUrl.split("?")[1]
    : "";
  const ref = String(req.query.trxref || req.query.reference || "");

  try {
    if (ref.startsWith("storefront_")) {
      // Storefront order — resolve the storefront's business name for a clean redirect
      try {
        const Order = (await import("./src/models/Order.js")).default;
        const AgentStorefront = (
          await import("./src/models/AgentStorefront.js")
        ).default;
        const order = await Order.findById(
          ref.replace(/^storefront_/, ""),
        ).lean();
        const storefrontId = order?.storefrontData?.storefrontId;
        if (storefrontId) {
          const sf = await AgentStorefront.findById(storefrontId).lean();
          if (sf?.businessName) {
            return res.redirect(
              302,
              `${frontendBase}/store/${sf.businessName}`,
            );
          }
        }
      } catch (e) {
        logger.warn(
          "[Redirect] Could not resolve storefront for callback redirect",
          { message: e.message },
        );
      }
      return res.redirect(302, `${frontendBase}/storefront/callback${qs}`);
    }

    // Default: wallet top-up callback
    return res.redirect(302, `${frontendBase}/wallet/topup/callback${qs}`);
  } catch (e) {
    logger.error("[Redirect] Callback redirect failed", { message: e.message });
    return res.redirect(302, frontendBase);
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRouter);
app.use("/api/users", userRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/push", pushNotificationRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/bundles", bundleRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/webhooks/paystack", paystackRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/commissions", commissionRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/admin/marketplace", adminMarketplaceRoutes);
app.use("/api", publicRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// ─── Error Handlers ───────────────────────────────────────────────────────────

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Global error handler (must have 4 params for Express to treat it as error middleware)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(`Server error: ${err?.message ?? String(err)}`);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "development"
        ? err?.message
        : "Internal server error",
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, "0.0.0.0", () => {
  logger.info(
    `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`,
  );
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

websocketService.initialize(httpServer);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  httpServer.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
