// app.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import connectDB from './src/config/db.js';
import logger from './src/utils/logger.js';
import websocketService from './src/services/websocketService.js';
import { logNetworkInfo } from './src/utils/networkUtil.js';
import { scheduleNotificationCleanup } from './src/jobs/clearOldNotifications.js';
import commissionFinalizationJob from './src/jobs/commissionFinalization.js';
import { scheduleDailyCommissionGeneration } from './src/jobs/dailyCommissionGeneration.js';
import { initializeReportedOrdersCleanupJob } from './src/jobs/reportedOrdersCleanup.js';
import announcementExpirationJob from './src/jobs/announcementExpiration.js';
import authRoutes from './src/routes/authRoutes.js';
import orderRouter from './src/routes/orderRoutes.js';
import packageRoutes from './src/routes/packageRoutes.js';
import bundleRoutes from './src/routes/bundleRoutes.js';
import publicRoutes from './src/routes/publicRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import providerRoutes from './src/routes/providerRoutes.js';
import walletRoutes from './src/routes/walletRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import analyticsRoutes from './src/routes/analyticsRoutes.js';
import commissionRoutes from './src/routes/commissionRoutes.js';
import pushNotificationRoutes from './src/routes/pushNotificationRoutes.js';
import announcementRoutes from './src/routes/announcementRoutes.js';
import storefrontRoutes from './src/routes/storefrontRoutes.js';
import paystackRoutes from './src/routes/paystackRoutes.js';

// ─── App & Server ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app); // single HTTP server — WebSocket attaches here
const PORT = process.env.PORT || 5050;

// ─── Startup ──────────────────────────────────────────────────────────────────

logger.info('Starting SaaS E-Commerce backend...');
connectDB();
logNetworkInfo();

// ─── Background Jobs ──────────────────────────────────────────────────────────

scheduleNotificationCleanup();
commissionFinalizationJob.start();
scheduleDailyCommissionGeneration();
initializeReportedOrdersCleanupJob();
announcementExpirationJob();

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      const allowed = [
        process.env.FRONTEND_URL,
        process.env.STOREFRONT_URL,  // dedicated public-store domain
        'https://brytelink-chi.vercel.app',
        'https://saas-ecommerce.vercel.app',
        'http://localhost:5173',
        'http://localhost:3000',
      ].filter(Boolean);

      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) return callback(null, true);
      // Allow any Vercel preview for this project
      if (allowed.includes(origin) || /^https:\/\/saas-ecommerce[a-z0-9-]*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

// Paystack webhook needs the raw body for HMAC signature verification.
// We capture it BEFORE express.json() consumes the stream.
app.use('/api/webhooks/paystack', (req, _res, next) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => { req.rawBody = raw; next(); });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging ──────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// ─── Dynamic PWA Manifest ─────────────────────────────────────────────────────

app.get('/manifest', (req, res) => {
  const { theme = '#142850' } = req.query;

  // Determine branding based on request origin/referer
  const origin = req.get('origin') || req.get('referer') || '';
  const isStorefrontDomain = origin.includes('directdata.shop') ||
                            origin.includes('storefront') ||
                            req.query.context === 'storefront';

  const branding = isStorefrontDomain ? {
    name: 'DirectData — Instant Data Bundles',
    short_name: 'DirectData',
    description: 'A modern storefront for buying data bundles from trusted agents across Ghana.',
    start_url: '/',
  } : {
    name: 'BryteLinks — Telecom Solutions Platform',
    short_name: 'BryteLinks',
    description: 'Modern telecom solutions platform for agents and dealers in Ghana.',
    start_url: '/',
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    ...branding,
    icons: [
      { src: '/favicon.svg',               sizes: 'any',     type: 'image/svg+xml', purpose: 'any maskable' },
      { src: '/favicon-16x16.png',          sizes: '16x16',   type: 'image/png' },
      { src: '/favicon-32x32.png',          sizes: '32x32',   type: 'image/png' },
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: theme,
    background_color: theme,
    display: 'standalone',
    orientation: 'portrait-primary',
    categories: isStorefrontDomain ? ['business', 'finance', 'utilities'] : ['business', 'productivity'],
  });
});

// ─── Paystack Browser Callback Redirect ──────────────────────────────────────
// When NGROK_URL points at the backend and Paystack redirects the user's
// browser here after payment, forward them on to the frontend.

app.get('/wallet/topup/callback', async (req, res) => {
  const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const qs = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : '';
  const ref = String(req.query.trxref || req.query.reference || '');

  try {
    if (ref.startsWith('storefront_')) {
      // Storefront order — resolve the storefront's business name for a clean redirect
      try {
        const Order = (await import('./src/models/Order.js')).default;
        const AgentStorefront = (await import('./src/models/AgentStorefront.js')).default;
        const order = await Order.findById(ref.replace(/^storefront_/, '')).lean();
        const storefrontId = order?.storefrontData?.storefrontId;
        if (storefrontId) {
          const sf = await AgentStorefront.findById(storefrontId).lean();
          if (sf?.businessName) {
            return res.redirect(302, `${frontendBase}/store/${sf.businessName}`);
          }
        }
      } catch (e) {
        logger.warn('[Redirect] Could not resolve storefront for callback redirect', { message: e.message });
      }
      return res.redirect(302, `${frontendBase}/storefront/callback${qs}`);
    }

    // Default: wallet top-up callback
    return res.redirect(302, `${frontendBase}/wallet/topup/callback${qs}`);
  } catch (e) {
    logger.error('[Redirect] Callback redirect failed', { message: e.message });
    return res.redirect(302, frontendBase);
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/auth',          authRoutes);
app.use('/api/orders',        orderRouter);
app.use('/api/users',         userRoutes);
app.use('/api/providers',     providerRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/commissions',   commissionRoutes);
app.use('/api/push',          pushNotificationRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/packages',      packageRoutes);
app.use('/api/bundles',       bundleRoutes);
app.use('/api/storefront',    storefrontRoutes);
app.use('/api/webhooks/paystack', paystackRoutes);
app.use('/api',               publicRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── Error Handlers ───────────────────────────────────────────────────────────

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler (must have 4 params for Express to treat it as error middleware)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(`Server error: ${err?.message ?? String(err)}`);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err?.message : 'Internal server error',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

websocketService.initialize(httpServer);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));