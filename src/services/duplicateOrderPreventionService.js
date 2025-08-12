// src/services/duplicateOrderPreventionService.js
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Bundle from '../models/Bundle.js';
import logger from '../utils/logger.js';

/**
 * Service for preventing duplicate orders
 * Implements smart duplicate detection with configurable time windows
 * and user-friendly warning system
 */
class DuplicateOrderPreventionService {
  constructor() {
    // Default configuration - can be overridden per tenant
    this.config = {
      // Time window to check for duplicates (in minutes)
      duplicateCheckWindow: 5,
      // Enable/disable duplicate prevention
      enabled: true,
      // Whether to allow force override of duplicates
      allowForceOverride: true
    };
  }

  /**
   * Check for potential duplicate orders
   * @param {Object} orderData - Order data to check
   * @param {string} userId - User ID creating the order
   * @param {string} tenantId - Tenant ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Duplicate check result
   */
  async checkForDuplicates(orderData, userId, tenantId, options = {}) {
    try {
      const { 
        forceOverride = false,
        checkWindowMinutes = this.config.duplicateCheckWindow 
      } = options;

      // If duplicate prevention is disabled, allow order
      if (!this.config.enabled) {
        return { 
          isDuplicate: false, 
          canProceed: true,
          message: 'Duplicate prevention disabled'
        };
      }

      // If force override is provided, allow order
      if (forceOverride && this.config.allowForceOverride) {
        return { 
          isDuplicate: false, 
          canProceed: true, 
          wasForced: true,
          message: 'Order forced by user override'
        };
      }

      // Determine order type and check accordingly
      if (orderData.items && Array.isArray(orderData.items)) {
        // Bulk order
        return await this.checkBulkOrderDuplicates(orderData, userId, tenantId, checkWindowMinutes);
      } else {
        // Single order
        return await this.checkSingleOrderDuplicates(orderData, userId, tenantId, checkWindowMinutes);
      }

    } catch (error) {
      logger.error(`Error checking for duplicates: ${error.message}`);
      // On error, allow order to proceed but log the issue
      return { 
        isDuplicate: false, 
        canProceed: true, 
        error: error.message,
        message: 'Duplicate check failed, allowing order'
      };
    }
  }

  /**
   * Check for single order duplicates
   */
  async checkSingleOrderDuplicates(orderData, userId, tenantId, checkWindowMinutes) {
    const { packageGroupId, packageItemId, customerPhone } = orderData;
    
    // Clean and normalize phone number
    const normalizedPhone = this.normalizePhoneNumber(customerPhone);
    
    // Calculate time threshold
    const timeThreshold = new Date();
    timeThreshold.setMinutes(timeThreshold.getMinutes() - checkWindowMinutes);

    logger.info(`Checking for duplicates:`, {
      userId,
      tenantId,
      normalizedPhone,
      packageGroupId,
      packageItemId,
      timeThreshold,
      checkWindowMinutes
    });

    // Query for recent similar orders - simplified query for better reliability
    const recentOrders = await Order.find({
      createdBy: userId,
      tenantId: tenantId,
      createdAt: { $gte: timeThreshold },
      status: { $nin: ['cancelled', 'failed'] } // Exclude cancelled/failed orders
    })
    .populate('items.packageGroup items.packageItem')
    .sort({ createdAt: -1 })
    .limit(10); // Increased limit for better debugging

    logger.info(`Found ${recentOrders.length} recent orders for user ${userId}`);

    if (recentOrders.length === 0) {
      return { 
        isDuplicate: false, 
        canProceed: true,
        message: 'No recent orders found for duplicate check'
      };
    }

    // Check each order's items for duplicates
    const duplicateMatches = [];
    
    for (const order of recentOrders) {
      for (const item of order.items) {
        const itemPhone = this.normalizePhoneNumber(item.customerPhone);
        const itemPackageGroup = item.packageGroup ? item.packageGroup._id || item.packageGroup : null;
        const itemPackageItem = item.packageItem ? item.packageItem._id || item.packageItem : null;

        // Check for exact match
        if (itemPhone === normalizedPhone &&
            itemPackageGroup && itemPackageGroup.toString() === packageGroupId.toString() &&
            itemPackageItem && itemPackageItem.toString() === packageItemId.toString()) {
          
          duplicateMatches.push({
            order,
            item,
            timeDiff: Math.floor((new Date() - order.createdAt) / (1000 * 60)) // minutes
          });
        }
      }
    }

    logger.info(`Found ${duplicateMatches.length} duplicate matches`);

    if (duplicateMatches.length === 0) {
      return { 
        isDuplicate: false, 
        canProceed: true,
        message: 'No duplicate orders found after detailed check'
      };
    }

    // Get bundle details for user-friendly message
    const bundle = await Bundle.findById(packageItemId);
    const bundleName = bundle ? bundle.name : 'Bundle';
    
    const latestMatch = duplicateMatches[0];
    const timeDiff = latestMatch.timeDiff;
    
    return {
      isDuplicate: true,
      canProceed: false,
      duplicateOrders: duplicateMatches.map(match => ({
        orderNumber: match.order.orderNumber,
        orderId: match.order._id,
        createdAt: match.order.createdAt,
        status: match.order.status,
        paymentStatus: match.order.paymentStatus
      })),
      message: `Potential duplicate order detected! You created a similar order for ${normalizedPhone} (${bundleName}) ${timeDiff} minute(s) ago.`,
      details: {
        customerPhone: normalizedPhone,
        bundleName,
        lastOrderTime: latestMatch.order.createdAt,
        lastOrderNumber: latestMatch.order.orderNumber,
        minutesAgo: timeDiff,
        totalSimilarOrders: duplicateMatches.length,
        timeWindow: checkWindowMinutes
      }
    };
  }

  /**
   * Check for bulk order duplicates
   */
  async checkBulkOrderDuplicates(orderData, userId, tenantId, checkWindowMinutes) {
    const { items } = orderData;
    
    // Parse bulk items to get phone numbers and volumes
    const bulkItems = items.map(item => {
      const parsed = this.parseBulkOrderRow(item);
      return {
        raw: item,
        parsed: parsed.value,
        error: parsed.error
      };
    }).filter(item => !item.error);

    if (bulkItems.length === 0) {
      return { 
        isDuplicate: false, 
        canProceed: true,
        message: 'No valid items to check for duplicates'
      };
    }

    // Calculate time threshold
    const timeThreshold = new Date();
    timeThreshold.setMinutes(timeThreshold.getMinutes() - checkWindowMinutes);

    // Get all phone numbers to check
    const phoneNumbers = bulkItems.map(item => 
      this.normalizePhoneNumber(item.parsed.customerPhone)
    );

    // Query for recent orders with any of these phone numbers
    const recentOrders = await Order.find({
      createdBy: userId,
      tenantId: tenantId,
      createdAt: { $gte: timeThreshold },
      status: { $nin: ['cancelled', 'failed'] },
      'items.customerPhone': { $in: phoneNumbers }
    })
    .populate('items.packageGroup items.packageItem')
    .sort({ createdAt: -1 });

    // Check each bulk item for duplicates
    const duplicateItems = [];
    const safeItems = [];

    for (const bulkItem of bulkItems) {
      const normalizedPhone = this.normalizePhoneNumber(bulkItem.parsed.customerPhone);
      const dataVolume = bulkItem.parsed.bundleSize.value;
      const dataUnit = bulkItem.parsed.bundleSize.unit;

      // Find matching recent orders
      const matchingOrders = recentOrders.filter(order => {
        return order.items.some(item => 
          item.customerPhone === normalizedPhone &&
          item.bundleSize?.value === dataVolume &&
          item.bundleSize?.unit === dataUnit
        );
      });

      if (matchingOrders.length > 0) {
        const latestMatch = matchingOrders[0];
        const timeDiff = Math.floor((new Date() - latestMatch.createdAt) / (1000 * 60));
        
        duplicateItems.push({
          customerPhone: normalizedPhone,
          dataVolume: `${dataVolume}${dataUnit}`,
          lastOrderNumber: latestMatch.orderNumber,
          lastOrderTime: latestMatch.createdAt,
          minutesAgo: timeDiff,
          rawItem: bulkItem.raw
        });
      } else {
        safeItems.push(bulkItem);
      }
    }

    if (duplicateItems.length > 0) {
      // Create a detailed message with specific duplicate information
      const duplicateDetails = duplicateItems.map(item => 
        `• ${item.customerPhone} (${item.dataVolume}) - ${item.minutesAgo === 0 ? 'Just ordered' : `${item.minutesAgo} minute(s) ago`} (Order #${item.lastOrderNumber})`
      ).join('\n');
      
      const safeDetails = safeItems.length > 0 
        ? `\n\nSafe Items (${safeItems.length}):\n${safeItems.map(item => `• ${item.raw}`).join('\n')}`
        : '';

      // Create a user-friendly summary message
      const summaryMessage = duplicateItems.length === bulkItems.length 
        ? `All ${duplicateItems.length} items appear to be duplicates of recent orders.`
        : `${duplicateItems.length} of ${bulkItems.length} items appear to be duplicates of recent orders.`;

      const detailedMessage = `${summaryMessage}\n\nDuplicate Items:\n${duplicateDetails}${safeDetails}`;

      return {
        isDuplicate: true,
        canProceed: false,
        duplicateItems,
        safeItems: safeItems.map(item => item.raw),
        message: detailedMessage,
        details: {
          totalItems: bulkItems.length,
          duplicateCount: duplicateItems.length,
          safeCount: safeItems.length,
          timeWindow: checkWindowMinutes,
          duplicateDetails,
          safeDetails: safeItems.map(item => item.raw),
          summaryMessage
        }
      };
    }

    return { 
      isDuplicate: false, 
      canProceed: true,
      message: `All ${bulkItems.length} items are safe to process`
    };
  }

  /**
   * Parse bulk order row (phone, data volume)
   */
  parseBulkOrderRow(row) {
    try {
      const parts = row.trim().split(/[\s,]+/);
      
      if (parts.length < 2) {
        return { error: 'Invalid format. Expected: "phone datavolume"' };
      }

      const customerPhone = parts[0];
      const dataVolumeStr = parts[1];
      
      // Parse data volume and unit
      let dataVolume, dataUnit;
      const dataMatch = dataVolumeStr.match(/^(\d+(?:\.\d+)?)(GB|MB)?$/i);
      
      if (dataMatch) {
        dataVolume = parseFloat(dataMatch[1]);
        dataUnit = dataMatch[2] ? dataMatch[2].toUpperCase() : 'GB';
      } else {
        return { error: 'Invalid data volume format' };
      }

      return {
        value: {
          customerPhone: customerPhone.trim(),
          bundleSize: {
            value: dataVolume,
            unit: dataUnit
          }
        }
      };
    } catch (error) {
      return { error: `Parse error: ${error.message}` };
    }
  }

  /**
   * Normalize phone number for consistent comparison
   */
  normalizePhoneNumber(phone) {
    if (!phone) return '';
    
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // Convert international format to local
    if (cleaned.startsWith('+233')) {
      cleaned = '0' + cleaned.substring(4);
    } else if (cleaned.startsWith('233')) {
      cleaned = '0' + cleaned.substring(3);
    }
    
    return cleaned;
  }

  /**
   * Get configuration for a specific tenant
   */
  async getTenantConfig(tenantId) {
    // In a real implementation, this could fetch tenant-specific configuration
    // For now, return default config
    return this.config;
  }

  /**
   * Update service configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get recent order statistics for debugging
   */
  async getRecentOrderStats(userId, tenantId, minutes = 60) {
    const timeThreshold = new Date();
    timeThreshold.setMinutes(timeThreshold.getMinutes() - minutes);

    const stats = await Order.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          tenantId: new mongoose.Types.ObjectId(tenantId),
          createdAt: { $gte: timeThreshold }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          uniquePhones: { $addToSet: '$items.customerPhone' },
          orderTypes: { $push: '$orderType' },
          statuses: { $push: '$status' }
        }
      }
    ]);

    return stats[0] || {
      totalOrders: 0,
      uniquePhones: [],
      orderTypes: [],
      statuses: []
    };
  }
}

export default new DuplicateOrderPreventionService();
