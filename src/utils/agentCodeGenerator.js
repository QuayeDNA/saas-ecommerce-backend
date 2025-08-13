import mongoose from 'mongoose';

/**
 * Generate a unique agent code using randomized format: BLA-XXXX
 * @returns {Promise<string>} - Unique agent code (8 characters max)
 */
export const generateUniqueAgentCode = async () => {
  const maxAttempts = 5;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Generate random 4-character alphanumeric suffix
      const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let randomSuffix = '';
      for (let i = 0; i < 4; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      // Format: BLA-XXXX (8 characters total)
      const agentCode = `BLA-${randomSuffix}`;
      
      // Check if this agent code already exists
      const User = mongoose.model('User');
      const existingAgent = await User.findOne({ agentCode, userType: 'agent' });
      
      if (!existingAgent) {
        return agentCode;
      }
      
      // If exists, try again with exponential backoff
      console.warn(`Agent code ${agentCode} already exists, retrying...`);
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
      
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to generate agent code:`, error.message);
      
      if (attempt === maxAttempts - 1) {
        // Final fallback: timestamp-based with different format
        const timestamp = Date.now().toString().slice(-4);
        return `BLA-${timestamp}`;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    }
  }
  
  throw new Error('Failed to generate unique agent code after maximum attempts');
};

/**
 * Generate agent code for special cases with custom prefix
 * @param {string} prefix - Prefix for the agent code (max 3 chars)
 * @returns {Promise<string>} - Unique agent code with prefix (8 chars max)
 */
export const generateSpecialAgentCode = async (prefix = 'BLA') => {
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
      
      // Format: PREFIX-XXXX (8 characters total)
      const agentCode = `${shortPrefix}-${randomSuffix}`;
      
      // Check if this agent code already exists
      const User = mongoose.model('User');
      const existingAgent = await User.findOne({ agentCode, userType: 'agent' });
      
      if (!existingAgent) {
        return agentCode;
      }
      
      // If exists, try again
      console.warn(`Special agent code ${agentCode} already exists, retrying...`);
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 10));
      
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed to generate special agent code:`, error.message);
      
      if (attempt === maxAttempts - 1) {
        // Final fallback with timestamp
        const timestamp = Date.now().toString().slice(-4);
        return `${shortPrefix}-${timestamp}`;
      }
    }
  }
  
  throw new Error(`Failed to generate unique ${prefix} agent code after maximum attempts`);
};

export default {
  generateUniqueAgentCode,
  generateSpecialAgentCode
};
