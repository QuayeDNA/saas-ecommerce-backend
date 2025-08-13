import { generateUniqueOrderNumber, generateSpecialOrderNumber } from './orderNumberGenerator.js';

/**
 * Generate a fallback order number when other methods fail
 * @param {string} orderNumber - Current order number to determine type
 * @returns {string} - Fallback order number
 */
const generateFallbackOrderNumber = (orderNumber) => {
  const timestamp = Date.now().toString().slice(-4);
  
  if (orderNumber && orderNumber.includes('AFA')) {
    return `AFA-${timestamp}`;
  }
  return `ORD-${timestamp}`;
};

/**
 * Generate new order number based on current order type
 * @param {string} currentOrderNumber - Current order number
 * @returns {Promise<string>} - New order number
 */
const generateNewOrderNumber = async (currentOrderNumber) => {
  try {
    if (currentOrderNumber && currentOrderNumber.includes('AFA')) {
      return await generateSpecialOrderNumber('AFA');
    }
    return await generateUniqueOrderNumber();
  } catch (error) {
    console.error('Failed to generate new order number:', error);
    return generateFallbackOrderNumber(currentOrderNumber);
  }
};

/**
 * Save order with automatic retry on duplicate key errors
 * @param {Object} order - Mongoose order document
 * @param {Object} session - MongoDB session (optional)
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @returns {Promise<Object>} - Saved order document
 */
export const saveOrderWithRetry = async (order, session = null, maxRetries = 3) => {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      if (session) {
        await order.save({ session });
      } else {
        await order.save();
      }
      return order;
    } catch (error) {
      attempts++;
      
      // Handle duplicate key errors
      if (isDuplicateKeyError(error)) {
        console.log(`Duplicate order number detected (attempt ${attempts}): ${order.orderNumber}`);
        
        if (attempts < maxRetries) {
          order.orderNumber = await generateNewOrderNumber(order.orderNumber);
          console.log(`New order number generated: ${order.orderNumber}`);
        } else {
          throw new Error(`Failed to create order: Unable to generate unique order number after ${maxRetries} attempts`);
        }
      } else {
        // For other errors, don't retry
        console.error('Order save failed with non-duplicate error:', error);
        throw error;
      }
    }
  }
  
  throw new Error(`Failed to save order after ${maxRetries} attempts`);
};

/**
 * Check if error is a duplicate key error
 * @param {Error} error - Error object
 * @param {string} field - Field name to check (default: 'orderNumber')
 * @returns {boolean} - True if it's a duplicate key error for the field
 */
export const isDuplicateKeyError = (error, field = 'orderNumber') => {
  return error.code === 11000 && error.keyPattern?.[field];
};

/**
 * Extract duplicate key information from error
 * @param {Error} error - MongoDB duplicate key error
 * @returns {Object} - Information about the duplicate key
 */
export const extractDuplicateKeyInfo = (error) => {
  if (error.code === 11000) {
    return {
      collection: error.keyValue ? Object.keys(error.keyValue)[0] : 'unknown',
      field: error.keyPattern ? Object.keys(error.keyPattern)[0] : 'unknown',
      value: error.keyValue ? Object.values(error.keyValue)[0] : 'unknown'
    };
  }
  return null;
};

export default {
  saveOrderWithRetry,
  isDuplicateKeyError,
  extractDuplicateKeyInfo
};
