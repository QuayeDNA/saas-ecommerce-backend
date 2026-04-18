import mongoose from "mongoose";
import { getCurrentRequestContext } from "./requestContext.js";
import { getPrefixByKind } from "./appCodeStrategy.js";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const getActiveAppId = (appId) => {
  if (appId) return appId;
  return getCurrentRequestContext()?.appContext?.appId || null;
};

/**
 * Generate a unique order number using randomized format: ORD-XXXX
 * @param {string} counterName - Name of the counter (e.g., 'orderNumber')
 * @returns {Promise<string>} - Unique order number (8 characters max)
 */
export const generateUniqueOrderNumber = async (
  counterName = "orderNumber",
  appId = null,
) => {
  const maxAttempts = 5;
  const resolvedAppId = getActiveAppId(appId);
  const orderPrefix = getPrefixByKind("order", resolvedAppId);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 4-character alphanumeric suffix
      let randomSuffix = "";
      for (let i = 0; i < 4; i++) {
        randomSuffix += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
      }

      // Format: PREFIX-XXXX
      const orderNumber = `${orderPrefix}-${randomSuffix}`;

      // Check if this order number already exists
      const Order = mongoose.model("Order");
      const existingOrder = await Order.findOne({ orderNumber });

      if (!existingOrder) {
        return orderNumber;
      }

      // If exists, try again with exponential backoff
      console.warn(`Order number ${orderNumber} already exists, retrying...`);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 10),
      );
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed to generate order number:`,
        error.message,
      );

      if (attempt === maxAttempts - 1) {
        // Final fallback: timestamp-based with different format
        const timestamp = Date.now().toString().slice(-4);
        return `${orderPrefix}-${timestamp}`;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
    }
  }

  throw new Error(
    "Failed to generate unique order number after maximum attempts",
  );
};

/**
 * Generate order number for special cases (like AFA)
 * @param {string} prefix - Prefix for the order number (max 3 chars)
 * @returns {Promise<string>} - Unique order number with prefix (8 chars max)
 */
export const generateSpecialOrderNumber = async (prefix = "AFA") => {
  const maxAttempts = 5;

  // Ensure prefix is max 3 characters
  const shortPrefix = prefix.substring(0, 3).toUpperCase();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 4-character alphanumeric suffix
      let randomSuffix = "";
      for (let i = 0; i < 4; i++) {
        randomSuffix += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
      }

      // Format: AFA-XXXX (8 characters total)
      const orderNumber = `${shortPrefix}-${randomSuffix}`;

      // Check if this order number already exists
      const Order = mongoose.model("Order");
      const existingOrder = await Order.findOne({ orderNumber });

      if (!existingOrder) {
        return orderNumber;
      }

      // If exists, try again
      console.warn(
        `Special order number ${orderNumber} already exists, retrying...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 10),
      );
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed to generate special order number:`,
        error.message,
      );

      if (attempt === maxAttempts - 1) {
        // Final fallback with timestamp
        const timestamp = Date.now().toString().slice(-4);
        return `${shortPrefix}-${timestamp}`;
      }
    }
  }

  throw new Error(
    `Failed to generate unique ${prefix} order number after maximum attempts`,
  );
};

export default {
  generateUniqueOrderNumber,
  generateSpecialOrderNumber,
  generateUniqueStorefrontOrderNumber,
};

/**
 * Generate a unique order number for storefront (agent-store) orders.
 * Format: BAGS-XXXX  (Brytelink Agents' Store)
 * @returns {Promise<string>}
 */
export async function generateUniqueStorefrontOrderNumber(appId = null) {
  const maxAttempts = 5;
  const resolvedAppId = getActiveAppId(appId);
  const storefrontPrefix = getPrefixByKind("storefrontOrder", resolvedAppId);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let suffix = "";
      for (let i = 0; i < 4; i++) {
        suffix += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
      }
      const orderNumber = `${storefrontPrefix}-${suffix}`;

      const Order = mongoose.model("Order");
      const existing = await Order.findOne({ orderNumber });
      if (!existing) return orderNumber;

      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 10),
      );
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed to generate BAGS order number:`,
        error.message,
      );
      if (attempt === maxAttempts - 1) {
        return `${storefrontPrefix}-${Date.now().toString().slice(-4)}`;
      }
    }
  }

  throw new Error(
    `Failed to generate unique ${storefrontPrefix} order number after maximum attempts`,
  );
}
