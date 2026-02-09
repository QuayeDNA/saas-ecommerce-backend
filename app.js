// app.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import connectDB from "./src/config/db.js";
import logger from "./src/utils/logger.js";
import websocketService from "./src/services/websocketService.js";
import { scheduleNotificationCleanup } from "./src/jobs/clearOldNotifications.js";
import commissionFinalizationJob from "./src/jobs/commissionFinalization.js";
import { scheduleDailyCommissionGeneration } from "./src/jobs/dailyCommissionGeneration.js";
import { initializeReportedOrdersCleanupJob } from "./src/jobs/reportedOrdersCleanup.js";
import announcementExpirationJob from "./src/jobs/announcementExpiration.js";
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
import commissionRoutes from "./src/routes/commissionRoutes.js";
import pushNotificationRoutes from "./src/routes/pushNotificationRoutes.js";
import announcementRoutes from "./src/routes/announcementRoutes.js";
import storefrontRoutes from "./src/routes/storefrontRoutes.js";

const app = express();
const PORT = process.env.PORT || 5050;

// Database connection
connectDB();

// Start notification cleanup job
scheduleNotificationCleanup();

// Start commission finalization job (1 minute after midnight on 1st of each month)
// This replaces the old generation/archive/expire workflow with real-time commission tracking
commissionFinalizationJob.start();

// Start daily commission generation job (every day at 2:00 AM)
// This creates daily commission records for users to see accumulation throughout the month
scheduleDailyCommissionGeneration();

// Start reported orders cleanup job (24hr auto-mark + 10min resolved cleanup)
initializeReportedOrdersCleanupJob();

// Start announcement expiration job (every hour)
announcementExpirationJob();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        "https://brytelink-chi.vercel.app",
        "https://saas-ecommerce.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
      ].filter(Boolean);

      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      // Allow any Vercel preview deployment for this project
      if (
        allowedOrigins.includes(origin) ||
        /^https:\/\/saas-ecommerce[a-z0-9-]*\.vercel\.app$/.test(origin)
      ) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Dynamic PWA manifest route (served from root for PWA compatibility)
app.get("/manifest", (req, res) => {
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

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRouter);
app.use("/api/users", userRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/commissions", commissionRoutes);
app.use("/api/push", pushNotificationRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/bundles", bundleRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api", publicRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Redis health check
app.get("/health/redis", async (req, res) => {
  try {
    const isRedisHealthy = await redisClient.ping();
    const redisStatus = redisClient.getStatus();
    res.json({
      status: isRedisHealthy ? "OK" : "ERROR",
      redis: {
        connected: redisStatus.connected,
        client: redisStatus.client,
        ping: isRedisHealthy,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      redis: {
        connected: false,
        error: error.message,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// Root endpoint - ASCII Landing Page
app.get("/", (req, res) => {
  const asciiArt = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    🚀 SAAS E-COMMERCE BACKEND API 🚀                          ║
║                                                                              ║
║              ███████╗ █████╗  █████╗ ███████╗                               ║
║              ██╔════╝██╔══██╗██╔══██╗██╔════╝                               ║
║              ███████╗███████║███████║███████╗                               ║
║              ╚════██║██╔══██║██╔══██║╚════██║                               ║
║              ███████║██║  ██║██║  ██║███████║                               ║
║              ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝                               ║
║                                                                              ║
║                    🛒 Multi-Vendor E-Commerce Platform 🛒                      ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🎯 WELCOME TO THE BACKEND API!                                              ║
║                                                                              ║
║  This is a secure multi-vendor e-commerce platform backend built with       ║
║  modern technologies for scalable and reliable operations.                  ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🏥 SYSTEM STATUS:                                                            ║
║                                                                              ║
║  ✅ API Status:       Online                                                 ║
║  � Environment:      ${
    process.env.NODE_ENV?.toUpperCase() || "DEVELOPMENT"
  } MODE                        ║
║  ⏰ Server Time:       ${new Date().toLocaleString()}                              ║
║  🌐 Health Check:      /health                                               ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🛠️  TECHNOLOGIES:                                                           ║
║                                                                              ║
║  • Node.js + Express.js (RESTful API)                                       ║
║  • MongoDB (Primary Database)                                               ║
║  • Redis (Caching & Sessions)                                               ║
║  • WebSocket (Real-time Communication)                                      ║
║  • JWT (Authentication & Security)                                          ║
║  • Push Notifications (VAPID)                                               ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  � API DOCUMENTATION:                                                       ║
║                                                                              ║
║  � Check the /docs/ folder for detailed API documentation                  ║
║  🔗 Frontend Application: http://localhost:5173                             ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  � SECURITY NOTICE:                                                         ║
║                                                                              ║
║  This API is secured with JWT authentication and role-based access control. ║
║  All endpoints require proper authentication and authorization.              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

  res.setHeader("Content-Type", "text/plain");
  res.send(asciiArt);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.message}`);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(async () => {
    logger.info("HTTP server closed");
    try {
      await redisClient.disconnect();
      logger.info("Redis connection closed");
    } catch (error) {
      logger.error("Error closing Redis connection:", error);
    }
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(async () => {
    logger.info("HTTP server closed");
    try {
      await redisClient.disconnect();
      logger.info("Redis connection closed");
    } catch (error) {
      logger.error("Error closing Redis connection:", error);
    }
    process.exit(0);
  });
});

// Initialize WebSocket server
websocketService.initialize(server);
