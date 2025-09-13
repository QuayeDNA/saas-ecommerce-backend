/**
 * Utility functions for handling user types consistently across the application
 */

// Define all business user types that can act as agents/tenants
const BUSINESS_USER_TYPES = ["agent", "super_agent", "dealer", "super_dealer"];

// Define user types that can have wallets and make transactions
const WALLET_ENABLED_USER_TYPES = [
  "agent",
  "super_agent",
  "dealer",
  "super_dealer",
];

// Define user types that can manage other users (act as tenants)
const TENANT_USER_TYPES = ["agent", "super_agent", "dealer", "super_dealer"];

// Define admin user types
const ADMIN_USER_TYPES = ["admin", "super_admin"];

/**
 * Check if a user type is a business user (can act as an agent/tenant)
 * @param {string} userType - The user type to check
 * @return {boolean} True if the user type is a business user type
 */
const isBusinessUser = (userType) => {
  return BUSINESS_USER_TYPES.includes(userType);
};

/**
 * Check if a user type can have a wallet
 * @param {string} userType - The user type to check
 * @return {boolean} True if the user type can have a wallet
 */
const canHaveWallet = (userType) => {
  return WALLET_ENABLED_USER_TYPES.includes(userType);
};

/**
 * Check if a user type can act as a tenant (manage other users)
 * @param {string} userType - The user type to check
 * @return {boolean} True if the user type can act as a tenant
 */
const isTenantUser = (userType) => {
  return TENANT_USER_TYPES.includes(userType);
};

/**
 * Check if a user type is an admin
 * @param {string} userType - The user type to check
 * @return {boolean} True if the user type is an admin
 */
const isAdminUser = (userType) => {
  return ADMIN_USER_TYPES.includes(userType);
};

/**
 * Get the tenant ID for a user based on their type
 * @param {Object} user - The user object
 * @return {string|null} The tenant ID or null if not applicable
 */
const getTenantId = (user) => {
  if (!user) return null;

  // Business users act as their own tenant
  if (isBusinessUser(user.userType)) {
    return user._id;
  }

  // Other users belong to a tenant
  return user.tenantId || null;
};

/**
 * Check if a user needs agent code generation
 * @param {string} userType - The user type to check
 * @return {boolean} True if the user type needs an agent code
 */
const needsAgentCode = (userType) => {
  return isBusinessUser(userType);
};

/**
 * Get all business user types for database queries
 * @return {string[]} Array of business user types
 */
const getBusinessUserTypes = () => {
  return [...BUSINESS_USER_TYPES];
};

/**
 * Get all wallet-enabled user types for database queries
 * @return {string[]} Array of wallet-enabled user types
 */
const getWalletEnabledUserTypes = () => {
  return [...WALLET_ENABLED_USER_TYPES];
};

/**
 * Get all tenant user types for database queries
 * @return {string[]} Array of tenant user types
 */
const getTenantUserTypes = () => {
  return [...TENANT_USER_TYPES];
};

export {
  BUSINESS_USER_TYPES,
  WALLET_ENABLED_USER_TYPES,
  TENANT_USER_TYPES,
  ADMIN_USER_TYPES,
  isBusinessUser,
  canHaveWallet,
  isTenantUser,
  isAdminUser,
  getTenantId,
  needsAgentCode,
  getBusinessUserTypes,
  getWalletEnabledUserTypes,
  getTenantUserTypes,
};
