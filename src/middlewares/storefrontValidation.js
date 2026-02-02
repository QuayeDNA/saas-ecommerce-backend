// src/middlewares/storefrontValidation.js
import validator from 'validator';
import mongoose from 'mongoose';

/**
 * Sanitize and validate storefront input data
 */
export const validateStorefrontInput = (req, res, next) => {
  try {
    const { body } = req;

    // Sanitize string inputs
    if (body.businessName) {
      body.businessName = validator.escape(body.businessName.trim());
      // Validate business name format
      if (!/^[a-zA-Z0-9\s\-_.]{3,50}$/.test(body.businessName)) {
        return res.status(400).json({
          success: false,
          message: 'Business name must be 3-50 characters and contain only letters, numbers, spaces, hyphens, underscores, and periods.'
        });
      }
    }

    if (body.description) {
      body.description = validator.escape(body.description.trim());
      if (body.description.length > 500) {
        return res.status(400).json({
          success: false,
          message: 'Description must be less than 500 characters.'
        });
      }
    }

    if (body.contactEmail) {
      body.contactEmail = validator.normalizeEmail(body.contactEmail);
      if (!validator.isEmail(body.contactEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format.'
        });
      }
    }

    if (body.contactPhone) {
      body.contactPhone = validator.escape(body.contactPhone.trim());
      // Basic phone validation (Ghana format)
      if (!/^(\+233|0)[0-9]{9}$/.test(body.contactPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Use Ghana format (+233XXXXXXXXX or 0XXXXXXXXX).'
        });
      }
    }

    // Validate payment methods
    if (body.paymentMethods && Array.isArray(body.paymentMethods)) {
      for (const method of body.paymentMethods) {
        if (!['mobile_money', 'bank_transfer', 'paystack'].includes(method.type)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid payment method type.'
          });
        }

        // Validate mobile money
        if (method.type === 'mobile_money') {
          if (!method.mobileMoney || !method.mobileMoney.network || !['MTN', 'Vodafone', 'AirtelTigo'].includes(method.mobileMoney.network)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid mobile money network.'
            });
          }
          if (!method.mobileMoney.accountName || method.mobileMoney.accountName.trim().length < 2) {
            return res.status(400).json({
              success: false,
              message: 'Account name is required for mobile money.'
            });
          }
          method.mobileMoney.accountName = validator.escape(method.mobileMoney.accountName.trim());
          if (!method.mobileMoney.accountNumber || !/^[0-9]{10}$/.test(method.mobileMoney.accountNumber)) {
            return res.status(400).json({
              success: false,
              message: 'Valid 10-digit account number is required for mobile money.'
            });
          }
        }

        // Validate bank transfer
        if (method.type === 'bank_transfer') {
          if (!method.bankTransfer || !method.bankTransfer.bankName || method.bankTransfer.bankName.trim().length < 2) {
            return res.status(400).json({
              success: false,
              message: 'Bank name is required for bank transfer.'
            });
          }
          method.bankTransfer.bankName = validator.escape(method.bankTransfer.bankName.trim());
          if (!method.bankTransfer.accountName || method.bankTransfer.accountName.trim().length < 2) {
            return res.status(400).json({
              success: false,
              message: 'Account name is required for bank transfer.'
            });
          }
          method.bankTransfer.accountName = validator.escape(method.bankTransfer.accountName.trim());
          if (!method.bankTransfer.accountNumber || !/^[0-9]{10,12}$/.test(method.bankTransfer.accountNumber)) {
            return res.status(400).json({
              success: false,
              message: 'Valid account number (10-12 digits) is required for bank transfer.'
            });
          }
        }

        // Validate Paystack
        if (method.type === 'paystack') {
          if (!method.paystack || !method.paystack.publicKey || method.paystack.publicKey.trim().length < 10) {
            return res.status(400).json({
              success: false,
              message: 'Valid Paystack public key is required.'
            });
          }
          method.paystack.publicKey = validator.escape(method.paystack.publicKey.trim());
        }
      }
    }

    // Validate custom pricing
    if (body.customPricing && Array.isArray(body.customPricing)) {
      for (const pricing of body.customPricing) {
        if (!pricing.bundleId || !mongoose.Types.ObjectId.isValid(pricing.bundleId)) {
          return res.status(400).json({
            success: false,
            message: 'Valid bundle ID is required for custom pricing.'
          });
        }
        if (typeof pricing.customPrice !== 'number' || pricing.customPrice < 0) {
          return res.status(400).json({
            success: false,
            message: 'Custom price must be a positive number.'
          });
        }
        if (pricing.customPrice > 10000) { // Reasonable upper limit
          return res.status(400).json({
            success: false,
            message: 'Custom price cannot exceed GHS 10,000.'
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Input validation failed.'
    });
  }
};

/**
 * Validate order creation input
 */
export const validateOrderInput = (req, res, next) => {
  try {
    const { body } = req;

    // Validate customer info
    if (!body.customerInfo) {
      return res.status(400).json({
        success: false,
        message: 'Customer information is required.'
      });
    }

    const { customerInfo } = body;

    if (!customerInfo.name || customerInfo.name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required and must be at least 2 characters.'
      });
    }
    customerInfo.name = validator.escape(customerInfo.name.trim());

    if (!customerInfo.phone || !/^(\+233|0)[0-9]{9}$/.test(customerInfo.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Ghana phone number is required.'
      });
    }
    customerInfo.phone = validator.escape(customerInfo.phone.trim());

    if (customerInfo.email) {
      customerInfo.email = validator.normalizeEmail(customerInfo.email);
      if (!validator.isEmail(customerInfo.email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format.'
        });
      }
    }

    // Validate order items
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one order item is required.'
      });
    }

    for (const item of body.items) {
      if (!item.bundleId || !mongoose.Types.ObjectId.isValid(item.bundleId)) {
        return res.status(400).json({
          success: false,
          message: 'Valid bundle ID is required for each item.'
        });
      }
      if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1) {
        return res.status(400).json({
          success: false,
          message: 'Valid quantity (minimum 1) is required for each item.'
        });
      }
      if (item.quantity > 100) { // Reasonable upper limit
        return res.status(400).json({
          success: false,
          message: 'Quantity cannot exceed 100 per item.'
        });
      }
    }

    // Validate payment method
    if (!body.paymentMethod || typeof body.paymentMethod !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Payment method information is required.'
      });
    }

    const { paymentMethod } = body;
    if (!['mobile_money', 'bank_transfer', 'paystack'].includes(paymentMethod.type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method type.'
      });
    }

    // Additional validation based on payment type
    if (paymentMethod.type === 'mobile_money') {
      if (!paymentMethod.network || !['mtn', 'vodafone', 'airteltigo'].includes(paymentMethod.network)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid mobile money network.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Order validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Order validation failed.'
    });
  }
};

/**
 * Validate payment confirmation input
 */
export const validatePaymentConfirmation = (req, res, next) => {
  try {
    const { body } = req;

    if (!body.orderId || !mongoose.Types.ObjectId.isValid(body.orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid order ID is required.'
      });
    }

    if (!body.transactionId || body.transactionId.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID/reference is required.'
      });
    }
    body.transactionId = validator.escape(body.transactionId.trim());

    if (typeof body.amountPaid !== 'number' || body.amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required.'
      });
    }

    if (body.amountPaid > 100000) { // Reasonable upper limit
      return res.status(400).json({
        success: false,
        message: 'Payment amount cannot exceed GHS 100,000.'
      });
    }

    // Validate payment proof file if provided
    if (req.file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only JPEG, PNG, JPG, and PDF files are allowed.'
        });
      }

      if (req.file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: 'File size too large. Maximum size is 5MB.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Payment confirmation validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Payment confirmation validation failed.'
    });
  }
};

/**
 * General input sanitization middleware
 */
export const sanitizeInput = (req, res, next) => {
  // Recursively sanitize all string inputs in req.body, req.query, req.params
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = validator.escape(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeObject(req.params);
  }

  next();
};