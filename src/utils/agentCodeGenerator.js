import mongoose from "mongoose";
import { getBusinessUserTypes } from "./userTypeHelpers.js";

/**
 * Generate a unique agent code using randomized format: BLA-XXX
 * @returns {Promise<string>} - Unique agent code (7 characters max)
 */
export const generateUniqueAgentCode = async () => {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 3-digit numeric suffix (000-999)
      const numbers = "0123456789";
      let randomSuffix = "";
      for (let i = 0; i < 3; i++) {
        randomSuffix += numbers.charAt(
          Math.floor(Math.random() * numbers.length)
        );
      }

      // Format: BLA-XXX (7 characters total)
      const agentCode = `BLA-${randomSuffix}`;

      // Check if this agent code already exists across all business user types
      const User = mongoose.model("User");
      const existingAgent = await User.findOne({
        agentCode,
        userType: { $in: getBusinessUserTypes() },
      });

      if (!existingAgent) {
        return agentCode;
      }

      // If exists, try again with exponential backoff
      console.warn(`Agent code ${agentCode} already exists, retrying...`);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 10)
      );
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed to generate agent code:`,
        error.message
      );

      if (attempt === maxAttempts - 1) {
        // Final fallback: timestamp-based with numeric only
        const timestamp = Date.now().toString().slice(-3);
        return `BLA-${timestamp}`;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
    }
  }

  throw new Error(
    "Failed to generate unique agent code after maximum attempts"
  );
};

/**
 * Generate agent code for special cases with custom prefix
 * @param {string} prefix - Prefix for the agent code (max 3 chars)
 * @returns {Promise<string>} - Unique agent code with prefix (7 chars max)
 */
export const generateSpecialAgentCode = async (prefix = "BLA") => {
  const maxAttempts = 5;

  // Ensure prefix is max 3 characters
  const shortPrefix = prefix.substring(0, 3).toUpperCase();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 3-digit numeric suffix (000-999)
      const numbers = "0123456789";
      let randomSuffix = "";
      for (let i = 0; i < 3; i++) {
        randomSuffix += numbers.charAt(
          Math.floor(Math.random() * numbers.length)
        );
      }

      // Format: PREFIX-XXX (7 characters total)
      const agentCode = `${shortPrefix}-${randomSuffix}`;

      // Check if this agent code already exists across all business user types
      const User = mongoose.model("User");
      const existingAgent = await User.findOne({
        agentCode,
        userType: { $in: getBusinessUserTypes() },
      });

      if (!existingAgent) {
        return agentCode;
      }

      // If exists, try again
      console.warn(
        `Special agent code ${agentCode} already exists, retrying...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 10)
      );
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1} failed to generate special agent code:`,
        error.message
      );

      if (attempt === maxAttempts - 1) {
        // Final fallback with timestamp (numeric only)
        const timestamp = Date.now().toString().slice(-3);
        return `${shortPrefix}-${timestamp}`;
      }
    }
  }

  throw new Error(
    `Failed to generate unique ${prefix} agent code after maximum attempts`
  );
};

export default {
  generateUniqueAgentCode,
  generateSpecialAgentCode,
};
