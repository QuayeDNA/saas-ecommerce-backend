// src/routes/storefrontRoutes.js
import express from 'express';
import { body, param, query } from 'express-validator';
import storefrontController from '../controllers/storefrontController.js';
import { authenticate, authorizeAdmin } from '../middlewares/auth.js';

const router = express.Router();

// =============================================================================
// Validation helpers
// =============================================================================

const validateBusinessName = param('businessName')
  .isLength({ min: 3, max: 50 })
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Business name must be 3-50 characters, alphanumeric with underscores/hyphens only');

const validateStorefrontData = [
  body('businessName')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Business name must be 3-50 alphanumeric characters'),
  body('displayName')
    .isLength({ min: 3, max: 100 })
    .withMessage('Display name must be 3-100 characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be under 500 characters'),
  body('contactInfo.phone')
    .optional()
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
    .isIn(['mobile_money', 'bank_transfer', 'paystack'])
    .withMessage('Payment method type must be mobile_money, bank_transfer, or paystack'),
  body('paymentMethods.*').custom((pm) => {
    if (pm.type === 'mobile_money') {
      if (!pm.details?.accounts || !Array.isArray(pm.details.accounts)) {
        throw new Error('Mobile money payment method must include an accounts array');
      }
      if (pm.details.accounts.length < 1 || pm.details.accounts.length > 2) {
        throw new Error('Mobile money must have 1-2 accounts');
      }
      pm.details.accounts.forEach((acc, i) => {
        if (!acc.provider || !['MTN', 'Vodafone', 'AirtelTigo'].includes(acc.provider)) {
          throw new Error(`Account ${i + 1}: provider must be MTN, Vodafone, or AirtelTigo`);
        }
        if (!acc.number || !/^[0-9+\-\s()]+$/.test(acc.number)) {
          throw new Error(`Account ${i + 1}: invalid or missing phone number`);
        }
        if (!acc.accountName || acc.accountName.trim().length < 2) {
          throw new Error(`Account ${i + 1}: account name must be at least 2 characters`);
        }
      });
    } else if (pm.type === 'bank_transfer') {
      if (!pm.details?.bank || !pm.details?.account || !pm.details?.name) {
        throw new Error('Bank transfer must include bank, account, and name');
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
    .optional()
    .matches(/^[0-9+\-\s()]+$/)
    .withMessage('Invalid phone number format'),
  body('customerInfo.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
  body('paymentMethod.type')
    .isIn(['mobile_money', 'bank_transfer', 'paystack'])
    .withMessage('Payment method type must be mobile_money, bank_transfer, or paystack'),
  body('paymentMethod.reference')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Payment reference must be 1-100 characters'),
  body('paymentMethod.paymentProofUrl')
    .optional()
    .isURL()
    .withMessage('Invalid payment proof URL'),
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
    .withMessage('Custom price must be a non-negative number'),
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
    .withMessage('isEnabled must be a boolean'),
];

// =============================================================================
// ⚠️  ROUTE ORDERING IS CRITICAL
//
// Express matches routes top-to-bottom. ALL static path prefixes (/paystack,
// /agent, /admin, /discover) MUST be declared BEFORE the /:businessName wildcard.
//
// If /:businessName comes first, Express will match "paystack", "agent", and
// "admin" as business names and call getPublicStorefront instead of the
// intended handler — causing silent failures (like the verify bug where the
// order stayed in pending_payment forever).
// =============================================================================

// =============================================================================
// 0. Discovery — PUBLIC, no auth, BEFORE /:businessName
// =============================================================================

// GET /api/storefront/discover/random — returns random active storefronts for landing page
router.get('/discover/random', [query('limit').optional().isInt({ min: 1, max: 12 })], storefrontController.getRandomStorefronts);

// =============================================================================
// 1. Paystack verify — PUBLIC, no auth, BEFORE /:businessName
//
// Called by the frontend immediately after the Paystack inline modal closes.
// Reference format: storefront_<orderId>
//
// The frontend MUST call this endpoint:
//   GET /api/storefront/paystack/verify?reference=storefront_<orderId>
//
// NOT /api/wallet/paystack/verify — that endpoint only handles wallet top-ups.
// =============================================================================
router.get('/paystack/verify', storefrontController.verifyPaystackTransaction);

// =============================================================================
// 2. Agent routes — authenticated, BEFORE /:businessName
// =============================================================================

// Storefront CRUD
router.post('/agent/storefront', authenticate, validateStorefrontData, storefrontController.createStorefront);
router.get('/agent/storefront',  authenticate, storefrontController.getAgentStorefront);
router.put(
  '/agent/storefront',
  authenticate,
  [
    body('displayName').optional().isLength({ min: 3, max: 100 }).withMessage('Display name must be 3-100 characters'),
    body('description').optional().isLength({ max: 500 }).withMessage('Description under 500 characters'),
    body('contactInfo.phone').optional().matches(/^[0-9+\-\s()]+$/).withMessage('Invalid phone'),
    body('contactInfo.email').optional().isEmail().withMessage('Invalid email'),
  ],
  storefrontController.updateStorefront
);
router.delete('/agent/storefront',            authenticate, storefrontController.deleteStorefront);
router.put('/agent/storefront/deactivate',    authenticate, storefrontController.deactivateStorefront);
router.put('/agent/storefront/reactivate',    authenticate, storefrontController.reactivateStorefront);

// Paystack subaccount
router.post('/agent/storefront/paystack/subaccount', authenticate, storefrontController.createPaystackSubaccount);

// Bundle & Pricing
router.get('/agent/storefront/bundles',        authenticate, storefrontController.getAvailableBundles);
router.put('/agent/storefront/bundles/toggle', authenticate, validateBundleToggle, storefrontController.toggleBundles);
router.get('/agent/storefront/pricing',        authenticate, storefrontController.getCurrentPricing);
router.post('/agent/storefront/pricing',       authenticate, validatePricingData, storefrontController.setPricing);

// Orders
router.get(
  '/agent/storefront/orders',
  authenticate,
  [
    query('status').optional()
      .isIn(['pending', 'pending_payment', 'confirmed', 'processing', 'completed', 'cancelled', 'failed'])
      .withMessage('Invalid status'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  ],
  storefrontController.getStorefrontOrders
);

// Manual payment verification — mobile_money / bank_transfer only.
// Paystack orders are verified automatically via GET /paystack/verify above.
router.put(
  '/agent/storefront/orders/:orderId/verify',
  authenticate,
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes under 500 characters'),
  ],
  storefrontController.verifyPayment
);

router.put(
  '/agent/storefront/orders/:orderId/reject',
  authenticate,
  [
    param('orderId').isMongoId().withMessage('Invalid order ID'),
    body('reason').isLength({ min: 1, max: 500 }).withMessage('Rejection reason required (max 500 characters)'),
  ],
  storefrontController.rejectOrder
);

// Analytics
router.get(
  '/agent/storefront/analytics',
  authenticate,
  [
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  ],
  storefrontController.getAnalytics
);

// Earnings — authoritative ledger (EarningsTransaction records)
router.get(
  '/agent/storefront/earnings',
  authenticate,
  storefrontController.getEarnings
);

// =============================================================================
// 3. Admin routes — super_admin only, BEFORE /:businessName
// =============================================================================

router.get(
  '/admin/storefronts',
  authenticate, authorizeAdmin,
  [
    query('status').optional()
      .isIn(['active', 'inactive', 'pending', 'approved', 'suspended'])
      .withMessage('Invalid status filter'),
    query('search').optional().isLength({ max: 100 }).withMessage('Search too long'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  ],
  storefrontController.getAllStorefronts
);

router.get('/admin/stats', authenticate, authorizeAdmin, storefrontController.getAdminStats);

router.get(
  '/admin/storefronts/:storefrontId',
  authenticate, authorizeAdmin,
  [param('storefrontId').isMongoId().withMessage('Invalid storefront ID')],
  storefrontController.getAdminStorefrontById
);

router.put(
  '/admin/storefronts/:storefrontId/approve',
  authenticate, authorizeAdmin,
  [param('storefrontId').isMongoId().withMessage('Invalid storefront ID')],
  storefrontController.approveStorefront
);

router.put(
  '/admin/storefronts/:storefrontId/suspend',
  authenticate, authorizeAdmin,
  [
    param('storefrontId').isMongoId().withMessage('Invalid storefront ID'),
    body('reason').optional().isLength({ max: 500 }).withMessage('Reason under 500 characters'),
  ],
  storefrontController.adminSuspendStorefront
);

router.put(
  '/admin/storefronts/:storefrontId/unsuspend',
  authenticate, authorizeAdmin,
  [param('storefrontId').isMongoId().withMessage('Invalid storefront ID')],
  storefrontController.adminUnsuspendStorefront
);

router.delete(
  '/admin/storefronts/:storefrontId',
  authenticate, authorizeAdmin,
  [
    param('storefrontId').isMongoId().withMessage('Invalid storefront ID'),
    body('reason').optional().isLength({ max: 500 }).withMessage('Reason under 500 characters'),
  ],
  storefrontController.adminDeleteStorefront
);

router.put(
  '/admin/settings/auto-approve',
  authenticate, authorizeAdmin,
  [body('enabled').isBoolean().withMessage('enabled must be a boolean')],
  storefrontController.toggleAutoApprove
);

// =============================================================================
// 4. Public wildcard routes — /:businessName LAST
//
// These must come after all static prefixes above or "paystack", "agent", and
// "admin" will be incorrectly matched as business names.
// =============================================================================

// Public: Track an order by orderId or storefront_<orderId> reference
router.get(
  '/:businessName/orders/track',
  validateBusinessName,
  [query('ref').isLength({ min: 1, max: 120 }).withMessage('ref query parameter is required')],
  storefrontController.trackPublicOrder
);

router.get('/:businessName', validateBusinessName, storefrontController.getPublicStorefront);

router.post(
  '/:businessName/order',
  validateBusinessName,
  validateOrderData,
  storefrontController.createStorefrontOrder
);

export default router;