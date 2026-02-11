// src/routes/storefrontRoutes.js
import express from 'express';
import { body, param, query } from 'express-validator';
import storefrontController from '../controllers/storefrontController.js';
import { authenticate, authorizeAdmin } from '../middlewares/auth.js';


const router = express.Router();

// Validation middleware
const validateBusinessName = param('businessName')
  .isLength({ min: 3, max: 50 })
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Business name must be 3-50 characters, alphanumeric with underscores/hyphens only');

const validateStorefrontData = [
  body('businessName')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Business name must be 3-50 characters, alphanumeric with underscores/hyphens only'),
  body('displayName')
    .isLength({ min: 3, max: 100 })
    .withMessage('Display name must be 3-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('contactInfo.phone')
    .matches(/^[0-9+\-\s()]+$/)
    .withMessage('Invalid phone number format'),
  body('contactInfo.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
  body('paymentMethods')
    .isArray({ min: 1 })
    .withMessage('At least one payment method is required'),
  body('paymentMethods.*.type')
    .isIn(['mobile_money', 'bank_transfer'])
    .withMessage('Payment method type must be mobile_money or bank_transfer'),
  body('paymentMethods.*')
    .custom((paymentMethod) => {
      if (paymentMethod.type === 'mobile_money') {
        if (!paymentMethod.details || !paymentMethod.details.accounts) {
          throw new Error('Mobile money payment method must include accounts array');
        }
        if (!Array.isArray(paymentMethod.details.accounts)) {
          throw new Error('Mobile money accounts must be an array');
        }
        if (paymentMethod.details.accounts.length === 0 || paymentMethod.details.accounts.length > 2) {
          throw new Error('Mobile money must have 1-2 accounts');
        }
        paymentMethod.details.accounts.forEach((account, index) => {
          if (!account.provider || !['MTN', 'Vodafone', 'AirtelTigo'].includes(account.provider)) {
            throw new Error(`Account ${index + 1}: Invalid or missing provider (must be MTN, Vodafone, or AirtelTigo)`);
          }
          if (!account.number || !/^[0-9+\-\s()]+$/.test(account.number)) {
            throw new Error(`Account ${index + 1}: Invalid or missing phone number`);
          }
          if (!account.accountName || account.accountName.trim().length < 2) {
            throw new Error(`Account ${index + 1}: Account name must be at least 2 characters`);
          }
        });
      } else if (paymentMethod.type === 'bank_transfer') {
        if (!paymentMethod.details || !paymentMethod.details.bank || !paymentMethod.details.account || !paymentMethod.details.name) {
          throw new Error('Bank transfer payment method must include bank, account, and name');
        }
      }
      return true;
    }),
];

const validateOrderData = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  body('items.*.bundleId')
    .isMongoId()
    .withMessage('Invalid bundle ID'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  body('customerInfo.name')
    .isLength({ min: 2, max: 100 })
    .withMessage('Customer name must be 2-100 characters'),
  body('customerInfo.phone')
    .matches(/^[0-9+\-\s()]+$/)
    .withMessage('Invalid phone number format'),
  // Email is optional (not required for storefront orders)
  body('customerInfo.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
  body('paymentMethod.type')
    .isIn(['mobile_money', 'bank_transfer'])
    .withMessage('Payment method type must be mobile_money or bank_transfer'),
  body('paymentMethod.reference')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Payment reference must be 1-100 characters'),
  // Future: payment proof screenshot URL
  body('paymentMethod.paymentProofUrl')
    .optional()
    .isURL()
    .withMessage('Invalid payment proof URL')
];

const validatePricingData = [
  body('pricing')
    .isArray({ min: 1 })
    .withMessage('At least one pricing entry is required'),
  body('pricing.*.bundleId')
    .isMongoId()
    .withMessage('Invalid bundle ID'),
  body('pricing.*.customPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Custom price must be a positive number')
];

const validateBundleToggle = [
  body('bundles')
    .isArray({ min: 1 })
    .withMessage('At least one bundle update is required'),
  body('bundles.*.bundleId')
    .isMongoId()
    .withMessage('Invalid bundle ID'),
  body('bundles.*.isEnabled')
    .isBoolean()
    .withMessage('isEnabled must be a boolean')
];

// =========================================================================
// Public Routes (No Authentication Required)
// =========================================================================

/**
 * @route GET /api/storefront/:businessName
 * @desc Get public storefront details with available bundles
 * @access Public
 */
router.get(
  '/:businessName',
  validateBusinessName,
  storefrontController.getPublicStorefront
);

/**
 * @route POST /api/storefront/:businessName/order
 * @desc Create a new storefront order (email optional, payment proof future)
 * @access Public
 */
router.post(
  '/:businessName/order',
  validateBusinessName,
  validateOrderData,
  storefrontController.createStorefrontOrder
);

// =========================================================================
// Agent Storefront Management (Authentication Required)
// =========================================================================

/**
 * @route POST /api/storefront/agent/storefront
 * @desc Create a new storefront (auto-approve checked)
 * @access Private (Authenticated Agent)
 */
router.post(
  '/agent/storefront',
  authenticate,
  validateStorefrontData,
  storefrontController.createStorefront
);

/**
 * @route GET /api/storefront/agent/storefront
 * @desc Get user's storefront (shows suspension message if admin-suspended)
 * @access Private (Authenticated Agent)
 */
router.get(
  '/agent/storefront',
  authenticate,
  storefrontController.getAgentStorefront
);

/**
 * @route PUT /api/storefront/agent/storefront
 * @desc Update user's storefront
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront',
  authenticate,
  [
    body('displayName')
      .optional()
      .isLength({ min: 3, max: 100 })
      .withMessage('Display name must be 3-100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must be less than 500 characters'),
    body('contactInfo.phone')
      .optional()
      .matches(/^[0-9+\-\s()]+$/)
      .withMessage('Invalid phone number format'),
    body('contactInfo.email')
      .optional()
      .isEmail()
      .withMessage('Invalid email format'),
  ],
  storefrontController.updateStorefront
);

/**
 * @route PUT /api/storefront/agent/storefront/deactivate
 * @desc Deactivate storefront (agent can still see, public can't)
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront/deactivate',
  authenticate,
  storefrontController.deactivateStorefront
);

/**
 * @route PUT /api/storefront/agent/storefront/reactivate
 * @desc Reactivate agent's storefront
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront/reactivate',
  authenticate,
  storefrontController.reactivateStorefront
);

/**
 * @route DELETE /api/storefront/agent/storefront
 * @desc Delete storefront (graceful - checks active orders)
 * @access Private (Authenticated Agent)
 */
router.delete(
  '/agent/storefront',
  authenticate,
  storefrontController.deleteStorefront
);

// =========================================================================
// Bundle & Pricing Management
// =========================================================================

/**
 * @route GET /api/storefront/agent/storefront/bundles
 * @desc Get ALL active bundles with pricing status and enabled state
 * @access Private (Authenticated Agent)
 */
router.get(
  '/agent/storefront/bundles',
  authenticate,
  storefrontController.getAvailableBundles
);

/**
 * @route PUT /api/storefront/agent/storefront/bundles/toggle
 * @desc Enable/disable bundles in agent's store
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront/bundles/toggle',
  authenticate,
  validateBundleToggle,
  storefrontController.toggleBundles
);

/**
 * @route GET /api/storefront/agent/storefront/pricing
 * @desc Get current storefront pricing
 * @access Private (Authenticated Agent)
 */
router.get(
  '/agent/storefront/pricing',
  authenticate,
  storefrontController.getCurrentPricing
);

/**
 * @route POST /api/storefront/agent/storefront/pricing
 * @desc Set custom pricing for bundles (customPrice optional - enables at tier price if omitted)
 * @access Private (Authenticated Agent)
 */
router.post(
  '/agent/storefront/pricing',
  authenticate,
  validatePricingData,
  storefrontController.setPricing
);

// =========================================================================
// Order Management
// =========================================================================

/**
 * @route GET /api/storefront/agent/storefront/orders
 * @desc Get storefront orders
 * @access Private (Authenticated Agent)
 */
router.get(
  '/agent/storefront/orders',
  authenticate,
  [
    query('status')
      .optional()
      .isIn(['pending', 'pending_payment', 'confirmed', 'processing', 'completed', 'cancelled', 'failed'])
      .withMessage('Invalid status'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ],
  storefrontController.getStorefrontOrders
);

/**
 * @route PUT /api/storefront/agent/storefront/orders/:orderId/verify
 * @desc Verify payment - deducts wallet, queues for admin processing (existing order flow)
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront/orders/:orderId/verify',
  authenticate,
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes must be less than 500 characters')
  ],
  storefrontController.verifyPayment
);

/**
 * @route PUT /api/storefront/agent/storefront/orders/:orderId/reject
 * @desc Reject order (refunds wallet if already verified)
 * @access Private (Authenticated Agent)
 */
router.put(
  '/agent/storefront/orders/:orderId/reject',
  authenticate,
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('reason').isLength({ min: 1, max: 500 }).withMessage('Rejection reason is required and must be less than 500 characters')
  ],
  storefrontController.rejectOrder
);

// =========================================================================
// Analytics
// =========================================================================

/**
 * @route GET /api/storefront/agent/storefront/analytics
 * @desc Get storefront analytics
 * @access Private (Authenticated Agent)
 */
router.get(
  '/agent/storefront/analytics',
  authenticate,
  [
    query('startDate').optional().isISO8601().withMessage('Invalid start date format'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date format')
  ],
  storefrontController.getAnalytics
);

// =========================================================================
// Admin Routes (Super Admin Only)
// =========================================================================

/**
 * @route GET /api/storefront/admin/storefronts
 * @desc Get all storefronts (with suspended filter)
 * @access Private (Super Admin)
 */
router.get(
  '/admin/storefronts',
  authenticate,
  authorizeAdmin,
  [
    query('status').optional().isIn(['active', 'inactive', 'pending', 'approved', 'suspended']).withMessage('Invalid status filter'),
    query('search').optional().isLength({ max: 100 }).withMessage('Search query too long'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
  ],
  storefrontController.getAllStorefronts
);

/**
 * @route GET /api/storefront/admin/stats
 * @desc Get storefront platform stats (includes suspendedStores, autoApprove setting)
 * @access Private (Super Admin)
 */
router.get(
  '/admin/stats',
  authenticate,
  authorizeAdmin,
  storefrontController.getAdminStats
);

/**
 * @route PUT /api/storefront/admin/storefronts/:storefrontId/approve
 * @desc Approve a storefront
 * @access Private (Super Admin)
 */
router.put(
  '/admin/storefronts/:storefrontId/approve',
  authenticate,
  authorizeAdmin,
  [param('storefrontId').isMongoId().withMessage('Invalid storefront ID')],
  storefrontController.approveStorefront
);

/**
 * @route PUT /api/storefront/admin/storefronts/:storefrontId/suspend
 * @desc Suspend a storefront (blocks agent AND public access)
 * @access Private (Super Admin)
 */
router.put(
  '/admin/storefronts/:storefrontId/suspend',
  authenticate,
  authorizeAdmin,
  [
    param('storefrontId').isMongoId().withMessage('Invalid storefront ID'),
    body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters')
  ],
  storefrontController.adminSuspendStorefront
);

/**
 * @route PUT /api/storefront/admin/storefronts/:storefrontId/unsuspend
 * @desc Unsuspend a storefront (lifts admin ban)
 * @access Private (Super Admin)
 */
router.put(
  '/admin/storefronts/:storefrontId/unsuspend',
  authenticate,
  authorizeAdmin,
  [param('storefrontId').isMongoId().withMessage('Invalid storefront ID')],
  storefrontController.adminUnsuspendStorefront
);

/**
 * @route DELETE /api/storefront/admin/storefronts/:storefrontId
 * @desc Delete a storefront (graceful - checks orders, notifies agent)
 * @access Private (Super Admin)
 */
router.delete(
  '/admin/storefronts/:storefrontId',
  authenticate,
  authorizeAdmin,
  [
    param('storefrontId').isMongoId().withMessage('Invalid storefront ID'),
    body('reason').optional().isLength({ max: 500 }).withMessage('Reason must be less than 500 characters')
  ],
  storefrontController.adminDeleteStorefront
);

/**
 * @route PUT /api/storefront/admin/settings/auto-approve
 * @desc Toggle auto-approve for new storefronts
 * @access Private (Super Admin)
 */
router.put(
  '/admin/settings/auto-approve',
  authenticate,
  authorizeAdmin,
  [body('enabled').isBoolean().withMessage('enabled must be a boolean')],
  storefrontController.toggleAutoApprove
);

export default router;
