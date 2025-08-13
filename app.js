// app.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import connectDB from './src/config/db.js';
import logger from './src/utils/logger.js';
import websocketService from './src/services/websocketService.js';
import authRoutes from './src/routes/authRoutes.js';
import orderRouter from './src/routes/orderRoutes.js';
import packageRoutes from './src/routes/packageRoutes.js';
import bundleRoutes from './src/routes/bundleRoutes.js';
import publicRoutes from './src/routes/publicRoutes.js';
import storefrontRoutes from './src/routes/storefrontRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import providerRoutes from './src/routes/providerRoutes.js';
import walletRoutes from './src/routes/walletRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import deleteUnverifiedUsersJob from './src/jobs/deleteUnverifiedUsers.js';
import { scheduleNotificationCleanup } from './src/jobs/clearOldNotifications.js';

const app = express();
const PORT = process.env.PORT || 5050;

// Database connection
connectDB();

// Start job to delete unverified users
if (process.env.NODE_ENV === 'development') {
  deleteUnverifiedUsersJob();
}

// Start notification cleanup job
scheduleNotificationCleanup();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://brytelink-chi.vercel.app',
    'https://saas-ecommerce.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ].filter(Boolean),
  credentials: true
}));

// Rate limiting - Production optimized
// General rate limiting with higher limits for production
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per 15 minutes
  message: {
    error: 'Too many requests from this IP',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for certain conditions
    return req.ip === '127.0.0.1' || req.ip === '::1'; // Skip for localhost
  }
});

// More restrictive rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 authentication attempts per 15 minutes
  message: {
    error: 'Too many authentication attempts from this IP',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply general rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Routes
app.use('/api/auth', authLimiter, authRoutes); // Apply stricter rate limiting to auth endpoints
app.use('/api/orders', orderRouter);
app.use('/api/storefront', storefrontRoutes);
app.use('/api/users', userRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', publicRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/bundles', bundleRoutes);


// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.message}`);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Initialize WebSocket server
websocketService.initialize(server);