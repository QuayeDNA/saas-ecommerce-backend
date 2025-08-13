import mongoose from 'mongoose';

/**
 * Generate a unique order number using randomized format: ORD-XXXX
 * @param {string} counterName - Name of the counter (e.g., 'orderNumber')
 * @returns {Promise<string>} - Unique order number (8 characters max)
 */
export const generateUniqueOrderNumber = async (counterName = 'orderNumber') => {
  const maxAttempts = 5;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 4-character alphanumeric suffix
      const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let randomSuffix = '';
      for (let i = 0; i < 4; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Format: ORD-XXXX (8 characters total)
      const orderNumber = `ORD-${randomSuffix}`;
      
      // Check if this order number already exists
      const Order = mongoose.model('Order');
      const existingOrder = await Order.findOne({ orderNumber });
      
      if (!existingOrder) {
        return orderNumber;
      }
      
      // If exists, try again with exponential backoff
      console.warn(`Order number ${orderNumber} already exists, retrying...`);
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
      
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to generate order number:`, error.message);
      
      if (attempt === maxAttempts - 1) {
        // Final fallback: timestamp-based with different format
        const timestamp = Date.now().toString().slice(-4);
        return `ORD-${timestamp}`;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    }
  }
  
  throw new Error('Failed to generate unique order number after maximum attempts');
};

/**
 * Generate order number for special cases (like AFA)
 * @param {string} prefix - Prefix for the order number (max 3 chars)
 * @returns {Promise<string>} - Unique order number with prefix (8 chars max)
 */
export const generateSpecialOrderNumber = async (prefix = 'AFA') => {
  const maxAttempts = 5;
  
  // Ensure prefix is max 3 characters
  const shortPrefix = prefix.substring(0, 3).toUpperCase();
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 4-character alphanumeric suffix
      const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let randomSuffix = '';
      for (let i = 0; i < 4; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Format: AFA-XXXX (8 characters total)
      const orderNumber = `${shortPrefix}-${randomSuffix}`;
      
      // Check if this order number already exists
      const Order = mongoose.model('Order');
      const existingOrder = await Order.findOne({ orderNumber });
      
      if (!existingOrder) {
        return orderNumber;
      }
      
      // If exists, try again
      console.warn(`Special order number ${orderNumber} already exists, retrying...`);
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
      
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to generate special order number:`, error.message);
      
      if (attempt === maxAttempts - 1) {
        // Final fallback with timestamp
        const timestamp = Date.now().toString().slice(-4);
        return `${shortPrefix}-${timestamp}`;
      }
    }
  }
  
  throw new Error(`Failed to generate unique ${prefix} order number after maximum attempts`);
};

export default {
  generateUniqueOrderNumber,
  generateSpecialOrderNumber
};
