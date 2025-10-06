// src/constants/commission.js

/**
 * Commission System Constants
 *
 * Centralized constants for commission-related operations.
 * This makes the codebase more maintainable and easier to update.
 */

/**
 * Commission record statuses
 *
 * Lifecycle:
 * - pending: Commission calculated, awaiting payment (can last up to 30 days)
 * - paid: Commission paid to wallet (final state, cannot be reversed)
 * - rejected: Commission rejected by admin (final state)
 * - expired: Commission not paid within expiry period (auto-reset)
 * - cancelled: Reserved for future use
 */
export const COMMISSION_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  REJECTED: "rejected",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

/**
 * Commission calculation periods
 *
 * Currently only MONTHLY is actively used.
 * WEEKLY and DAILY are reserved for future expansion.
 */
export const COMMISSION_PERIOD = {
  MONTHLY: "monthly",
  WEEKLY: "weekly",
  DAILY: "daily",
};

/**
 * Default commission rates by user type (percentage)
 *
 * These are fallback values if Settings document doesn't have specific rates.
 * Actual rates should be configured in the Settings collection.
 */
export const DEFAULT_COMMISSION_RATES = {
  AGENT: 5.0,
  SUPER_AGENT: 7.5,
  DEALER: 10.0,
  SUPER_DEALER: 12.5,
  DEFAULT: 1.0,
};

/**
 * User types that can earn commissions
 */
export const COMMISSION_USER_TYPES = {
  AGENT: "agent",
  SUPER_AGENT: "super_agent",
  DEALER: "dealer",
  SUPER_DEALER: "super_dealer",
};

/**
 * Commission processing configuration
 */
export const COMMISSION_DEFAULTS = {
  // Batch processing configuration
  BATCH_SIZE: 10, // Number of agents to process simultaneously
  BATCH_DELAY_MS: 100, // Delay between batches (milliseconds)

  // Expiry configuration
  EXPIRY_DAYS: 30, // Days before pending commissions expire

  // Generation settings
  ALLOW_DUPLICATE_GENERATION: false, // Prevent duplicate commission records
  AUTO_GENERATE_ON_ORDER: true, // Auto-generate when order is completed

  // Performance settings
  MAX_RETRY_ATTEMPTS: 3, // Retry attempts for failed operations
  OPERATION_TIMEOUT_MS: 30000, // 30 seconds timeout for operations
};

/**
 * Commission error messages
 */
export const COMMISSION_ERRORS = {
  AGENT_NOT_FOUND: "Agent not found",
  COMMISSION_NOT_FOUND: "Commission record not found",
  ALREADY_PAID: "Commission already paid",
  ALREADY_REJECTED: "Commission already rejected",
  CANNOT_REJECT_PAID: "Cannot reject a paid commission",
  DUPLICATE_GENERATION: "Commissions already generated for this period",
  INVALID_STATUS_TRANSITION: "Invalid commission status transition",
  CALCULATION_FAILED: "Failed to calculate commission",
  PAYMENT_FAILED: "Failed to pay commission",
};

/**
 * Commission success messages
 */
export const COMMISSION_MESSAGES = {
  GENERATION_STARTED: "Commission generation started",
  GENERATION_COMPLETED: "Commission generation completed",
  PAYMENT_SUCCESSFUL: "Commission paid successfully",
  REJECTION_SUCCESSFUL: "Commission rejected successfully",
  CALCULATION_SUCCESSFUL: "Commission calculated successfully",
};

/**
 * WebSocket event types for commission updates
 */
export const COMMISSION_EVENTS = {
  CREATED: "commission_created",
  PAID: "commission_paid",
  REJECTED: "commission_rejected",
  EXPIRED: "commission_expired",
  GENERATED: "commission_generated",
};

/**
 * Helper function to check if a status is final (cannot be changed)
 */
export const isFinalStatus = (status) => {
  return [
    COMMISSION_STATUS.PAID,
    COMMISSION_STATUS.REJECTED,
    COMMISSION_STATUS.EXPIRED,
  ].includes(status);
};

/**
 * Helper function to validate status transition
 */
export const isValidStatusTransition = (fromStatus, toStatus) => {
  // Can't change from final states
  if (isFinalStatus(fromStatus)) {
    return false;
  }

  // Valid transitions from PENDING
  if (fromStatus === COMMISSION_STATUS.PENDING) {
    return [
      COMMISSION_STATUS.PAID,
      COMMISSION_STATUS.REJECTED,
      COMMISSION_STATUS.EXPIRED,
      COMMISSION_STATUS.CANCELLED,
    ].includes(toStatus);
  }

  // Cancelled can be changed to pending (reactivation)
  if (fromStatus === COMMISSION_STATUS.CANCELLED) {
    return toStatus === COMMISSION_STATUS.PENDING;
  }

  return false;
};

/**
 * Helper function to get commission rate field name from user type
 */
export const getCommissionRateField = (userType) => {
  const fieldMap = {
    [COMMISSION_USER_TYPES.SUPER_DEALER]: "superDealerCommission",
    [COMMISSION_USER_TYPES.DEALER]: "dealerCommission",
    [COMMISSION_USER_TYPES.SUPER_AGENT]: "superAgentCommission",
    [COMMISSION_USER_TYPES.AGENT]: "agentCommission",
  };

  return fieldMap[userType] || "defaultCommissionRate";
};

/**
 * Helper function to get default commission rate for user type
 */
export const getDefaultRate = (userType) => {
  const rateMap = {
    [COMMISSION_USER_TYPES.SUPER_DEALER]: DEFAULT_COMMISSION_RATES.SUPER_DEALER,
    [COMMISSION_USER_TYPES.DEALER]: DEFAULT_COMMISSION_RATES.DEALER,
    [COMMISSION_USER_TYPES.SUPER_AGENT]: DEFAULT_COMMISSION_RATES.SUPER_AGENT,
    [COMMISSION_USER_TYPES.AGENT]: DEFAULT_COMMISSION_RATES.AGENT,
  };

  return rateMap[userType] || DEFAULT_COMMISSION_RATES.DEFAULT;
};

export default {
  COMMISSION_STATUS,
  COMMISSION_PERIOD,
  DEFAULT_COMMISSION_RATES,
  COMMISSION_USER_TYPES,
  COMMISSION_DEFAULTS,
  COMMISSION_ERRORS,
  COMMISSION_MESSAGES,
  COMMISSION_EVENTS,
  isFinalStatus,
  isValidStatusTransition,
  getCommissionRateField,
  getDefaultRate,
};
