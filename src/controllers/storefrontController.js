// src/controllers/storefrontController.js
import storefrontService from '../services/storefrontService.js';
import { validationResult } from 'express-validator';
import AgentStorefront from '../models/AgentStorefront.js';
import Order from '../models/Order.js';

/**
 * Public Storefront Endpoints (No Authentication Required)
 */

// Get storefront by business name
export const getStorefront = async (req, res) => {
  try {
    const { businessName } = req.params;
    const storefront = await storefrontService.getStorefrontByBusinessName(businessName);

    res.json({
      success: true,
      data: {
        storefront: {
          _id: storefront._id,
          businessName: storefront.businessName,
          displayName: storefront.displayName,
          description: storefront.description,
          theme: storefront.theme,
          isActive: storefront.isActive,
          isPublic: storefront.isPublic,
          paymentMethods: storefront.getActivePaymentMethods().map(pm => ({
            type: pm.type,
            isActive: pm.isActive,
            instructions: pm.instructions,
            // Include account numbers for payment instructions
            mobileMoney: pm.mobileMoney ? {
              accountName: pm.mobileMoney.accountName,
              accountNumber: pm.mobileMoney.accountNumber,
              network: pm.mobileMoney.network
            } : undefined,
            bankTransfer: pm.bankTransfer ? {
              bankName: pm.bankTransfer.bankName,
              accountName: pm.bankTransfer.accountName,
              accountNumber: pm.bankTransfer.accountNumber,
              branch: pm.bankTransfer.branch
            } : undefined
          })),
          settings: {
            contactInfo: storefront.settings.contactInfo
          }
        }
      }
    });
  } catch (error) {
    console.error('Get storefront error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to get storefront'
    });
  }
};

// Get bundles available in storefront
export const getStorefrontBundles = async (req, res) => {
  try {
    const { businessName } = req.params;
    const storefront = await storefrontService.getStorefrontByBusinessName(businessName);
    const bundles = await storefrontService.getStorefrontBundles(storefront._id);

    res.json({
      success: true,
      data: { bundles }
    });
  } catch (error) {
    console.error('Get storefront bundles error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to get storefront bundles'
    });
  }
};

// Create storefront order
export const createStorefrontOrder = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { businessName } = req.params;
    const storefront = await storefrontService.getStorefrontByBusinessName(businessName);

    const order = await storefrontService.createStorefrontOrder(storefront._id, req.body);

    res.status(201).json({
      success: true,
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          total: order.total,
          status: order.status,
          paymentInstructions: storefront.getActivePaymentMethods()
            .find(pm => pm.type === req.body.paymentMethod.type)?.instructions
        }
      }
    });
  } catch (error) {
    console.error('Create storefront order error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create order'
    });
  }
};

// Upload payment proof for an order
export const uploadPaymentProof = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No payment proof file uploaded'
      });
    }

    // Verify order exists and belongs to user's storefront
    const order = await Order.findById(orderId).populate('storefrontData.storefrontId');
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.orderType !== 'storefront') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order type'
      });
    }

    // Check if user owns the storefront (for authenticated requests)
    if (req.user && order.storefrontData.storefrontId.agentId.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update order with payment proof
    const paymentProof = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      uploadedAt: new Date()
    };

    order.paymentProof = paymentProof;
    await order.save();

    res.json({
      success: true,
      message: 'Payment proof uploaded successfully',
      data: {
        orderId: order._id,
        paymentProof: {
          filename: paymentProof.filename,
          uploadedAt: paymentProof.uploadedAt
        }
      }
    });
  } catch (error) {
    console.error('Upload payment proof error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to upload payment proof'
    });
  }
};

/**
 * Agent Storefront Management Endpoints (Agent Authentication Required)
 */

// Create storefront
export const createStorefront = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const storefront = await storefrontService.createStorefront(req.user.userId, req.body);

    res.status(201).json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Create storefront error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to create storefront'
    });
  }
};

// Get agent's storefront
export const getAgentStorefront = async (req, res) => {
  try {
    const storefront = await storefrontService.getStorefrontByAgentId(req.user.userId);

    if (!storefront) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found'
      });
    }

    res.json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Get agent storefront error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to get storefront'
    });
  }
};

// Update storefront
export const updateStorefront = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { storefrontId } = req.params;
    const storefront = await storefrontService.updateStorefront(storefrontId, req.user.userId, req.body);

    res.json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Update storefront error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to update storefront'
    });
  }
};

// Add payment method
export const addPaymentMethod = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { storefrontId } = req.params;
    const storefront = await storefrontService.addPaymentMethod(storefrontId, req.user.userId, req.body);

    res.status(201).json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to add payment method'
    });
  }
};

// Update payment method
export const updatePaymentMethod = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { storefrontId, methodId } = req.params;
    const storefront = await storefrontService.updatePaymentMethod(storefrontId, req.user.userId, methodId, req.body);

    res.json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Update payment method error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to update payment method'
    });
  }
};

// Set pricing
export const setPricing = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { storefrontId } = req.params;
    const storefront = await storefrontService.setPricing(storefrontId, req.user.userId, req.body.pricing);

    res.json({
      success: true,
      data: { storefront }
    });
  } catch (error) {
    console.error('Set pricing error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to set pricing'
    });
  }
};

// Get pending orders
export const getPendingOrders = async (req, res) => {
  try {
    const orders = await storefrontService.getPendingOrders(req.user.userId);

    res.json({
      success: true,
      data: { orders }
    });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to get pending orders'
    });
  }
};

// Confirm payment
export const confirmPayment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { orderId } = req.params;
    const paymentData = { ...req.body };

    // Handle uploaded payment proof file
    if (req.file) {
      paymentData.paymentProof = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        uploadedAt: new Date()
      };
    }

    const order = await storefrontService.confirmPayment(orderId, req.user.userId, paymentData);

    res.json({
      success: true,
      data: { order }
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Failed to confirm payment'
    });
  }
};

/**
 * Admin Endpoints (Admin Authentication Required)
 */

// Get all storefronts (admin)
export const getAllStorefronts = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, agentId } = req.query;

    const query = {};
    if (status) query.isActive = status === 'active';
    if (agentId) query.agentId = agentId;

    const storefronts = await AgentStorefront.find(query)
      .populate('agentId', 'fullName businessName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AgentStorefront.countDocuments(query);

    res.json({
      success: true,
      data: {
        storefronts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all storefronts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get storefronts'
    });
  }
};

// Approve/reject storefront
export const updateStorefrontStatus = async (req, res) => {
  try {
    const { storefrontId } = req.params;
    const route = req.route.path.split('/').pop(); // 'activate' or 'deactivate'
    const isActive = route === 'activate';

    const storefront = await AgentStorefront.findById(storefrontId);
    if (!storefront) {
      return res.status(404).json({
        success: false,
        message: 'Storefront not found'
      });
    }

    // Check if user owns this storefront (for agent routes)
    if (req.user?.userType === 'agent' && storefront.agentId.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    storefront.isActive = isActive;
    await storefront.save();

    res.json({
      success: true,
      message: `Storefront ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { storefront }
    });
  } catch (error) {
    console.error('Update storefront status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update storefront status'
    });
  }
};