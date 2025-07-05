// src/routes/productRoutes.js
import express from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';

// Import the new controllers
import packageRoutes from './packageRoutes.js';

const router = express.Router();

// Mount the new routes
router.use('/packages', packageRoutes);

// Legacy endpoint redirect for compatibility
router.get(
  '/',
  authenticate,
  authorize('agent'),
  (req, res) => {
    res.redirect('/api/packages');
  }
);

export default router;
