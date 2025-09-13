// src/utils/pricingHelpers.js
import logger from "./logger.js";

/**
 * Get the appropriate price for a bundle based on user type
 * @param {Object} bundle - Bundle object with price and pricingTiers
 * @param {string} userType - User type (agent, super_agent, dealer, super_dealer)
 * @returns {number} - Price for the specific user type
 */
export const getPriceForUserType = (bundle, userType = "agent") => {
  try {
    if (!bundle) {
      throw new Error("Bundle is required");
    }

    // If no pricing tiers exist, return the base price
    if (!bundle.pricingTiers || typeof bundle.pricingTiers !== "object") {
      return bundle.price || 0;
    }

    // Check if user type has specific pricing
    if (
      bundle.pricingTiers[userType] !== undefined &&
      bundle.pricingTiers[userType] !== null
    ) {
      return bundle.pricingTiers[userType];
    }

    // Fallback to default pricing tier if available
    if (
      bundle.pricingTiers.default !== undefined &&
      bundle.pricingTiers.default !== null
    ) {
      return bundle.pricingTiers.default;
    }

    // Final fallback to base price
    return bundle.price || 0;
  } catch (error) {
    logger.error("Error getting price for user type:", error);
    return bundle?.price || 0;
  }
};

/**
 * Calculate total price for multiple bundles based on user type
 * @param {Array} bundleItems - Array of { bundle, quantity } objects
 * @param {string} userType - User type
 * @returns {number} - Total price
 */
export const calculateTotalPrice = (bundleItems, userType = "agent") => {
  try {
    if (!Array.isArray(bundleItems) || bundleItems.length === 0) {
      return 0;
    }

    return bundleItems.reduce((total, item) => {
      const { bundle, quantity = 1 } = item;
      const unitPrice = getPriceForUserType(bundle, userType);
      return total + unitPrice * quantity;
    }, 0);
  } catch (error) {
    logger.error("Error calculating total price:", error);
    return 0;
  }
};

/**
 * Get pricing summary for a bundle showing all user type prices
 * @param {Object} bundle - Bundle object
 * @returns {Object} - Pricing summary with all user type prices
 */
export const getBundlePricingSummary = (bundle) => {
  try {
    if (!bundle) {
      throw new Error("Bundle is required");
    }

    const userTypes = ["agent", "super_agent", "dealer", "super_dealer"];
    const pricing = {
      basePrice: bundle.price || 0,
      userTypePrices: {},
      hasCustomPricing: false,
    };

    userTypes.forEach((userType) => {
      pricing.userTypePrices[userType] = getPriceForUserType(bundle, userType);
    });

    // Check if any user type has custom pricing different from base price
    pricing.hasCustomPricing = userTypes.some(
      (userType) => pricing.userTypePrices[userType] !== pricing.basePrice
    );

    return pricing;
  } catch (error) {
    logger.error("Error getting bundle pricing summary:", error);
    return {
      basePrice: bundle?.price || 0,
      userTypePrices: {},
      hasCustomPricing: false,
    };
  }
};

/**
 * Validate pricing tiers structure
 * @param {Object} pricingTiers - Pricing tiers object
 * @returns {Object} - Validation result with isValid and errors
 */
export const validatePricingTiers = (pricingTiers) => {
  const result = {
    isValid: true,
    errors: [],
  };

  try {
    if (!pricingTiers || typeof pricingTiers !== "object") {
      return result; // Empty pricing tiers is valid
    }

    const validUserTypes = [
      "agent",
      "super_agent",
      "dealer",
      "super_dealer",
      "default",
    ];

    Object.entries(pricingTiers).forEach(([userType, price]) => {
      // Check if user type is valid
      if (!validUserTypes.includes(userType)) {
        result.isValid = false;
        result.errors.push(
          `Invalid user type: ${userType}. Valid types are: ${validUserTypes.join(
            ", "
          )}`
        );
      }

      // Check if price is valid
      if (typeof price !== "number" || price < 0) {
        result.isValid = false;
        result.errors.push(
          `Invalid price for ${userType}: must be a positive number`
        );
      }
    });
  } catch (error) {
    result.isValid = false;
    result.errors.push(`Validation error: ${error.message}`);
  }

  return result;
};

/**
 * Apply pricing tiers to bundle data for API responses
 * @param {Object} bundle - Bundle object
 * @param {string} userType - Current user type (for showing relevant price)
 * @returns {Object} - Enhanced bundle object with pricing information
 */
export const enhanceBundleWithPricing = (bundle, userType = "agent") => {
  try {
    const bundleObj = bundle.toObject ? bundle.toObject() : { ...bundle };

    // Add user-specific price
    bundleObj.userPrice = getPriceForUserType(bundle, userType);

    // Add pricing summary for admin users
    bundleObj.pricingSummary = getBundlePricingSummary(bundle);

    return bundleObj;
  } catch (error) {
    logger.error("Error enhancing bundle with pricing:", error);
    return bundle;
  }
};

/**
 * Get discount percentage between base price and user type price
 * @param {Object} bundle - Bundle object
 * @param {string} userType - User type
 * @returns {number} - Discount percentage (0 if no discount)
 */
export const getDiscountPercentage = (bundle, userType = "agent") => {
  try {
    const basePrice = bundle.price || 0;
    const userPrice = getPriceForUserType(bundle, userType);

    if (basePrice === 0 || userPrice >= basePrice) {
      return 0;
    }

    return Math.round(((basePrice - userPrice) / basePrice) * 100);
  } catch (error) {
    logger.error("Error calculating discount percentage:", error);
    return 0;
  }
};
