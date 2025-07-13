// app.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import connectDB from './src/config/db.js';
import logger from './src/utils/logger.js';
import authRoutes from './src/routes/authRoutes.js';
import orderRouter from './src/routes/orderRoutes.js';
import packageRoutes from './src/routes/packageRoutes.js';
import bundleRoutes from './src/routes/bundleRoutes.js';
import publicRoutes from './src/routes/publicRoutes.js';
import storefrontRoutes from './src/routes/storefrontRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import providerRoutes from './src/routes/providerRoutes.js';
import walletRoutes from './src/routes/walletRoutes.js';
import deleteUnverifiedUsersJob from './src/jobs/deleteUnverifiedUsers.js';

const app = express();
const PORT = process.env.PORT || 5050;

// Database connection
connectDB();

// Check and seed data if needed
import('./src/scripts/check-seeding.js').then(async (seedingModule) => {
  try {
    const needsSeeding = await seedingModule.checkIfSeedingNeeded();
    if (needsSeeding) {
      logger.info('🌱 Seeding data...');
      await seedingModule.runSeeding();
      logger.info('✅ Data seeding completed');
    } else {
      logger.info('✅ No seeding needed - data is present');
    }
  } catch (error) {
    logger.error('❌ Error during seeding check:', error);
  }
}).catch(error => {
  logger.error('❌ Error loading seeding module:', error);
});

// Start job to delete unverified users
if (process.env.NODE_ENV === 'development') {
  deleteUnverifiedUsersJob();
}

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRouter);
app.use('/api/storefront', storefrontRoutes);
app.use('/api/users', userRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/wallet', walletRoutes);
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

app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});