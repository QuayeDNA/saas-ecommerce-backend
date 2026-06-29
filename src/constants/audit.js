// src/constants/audit.js
export const AUDIT_ACTIONS = {
  // Authentication
  AUTH_LOGIN: "Login",
  AUTH_LOGOUT: "Logout",
  AUTH_REGISTER: "Account Registration",
  AUTH_PASSWORD_CHANGE: "Password Change",
  AUTH_PASSWORD_RESET: "Password Reset",
  AUTH_PIN_SETUP: "PIN Setup",
  AUTH_FAILED_LOGIN: "Failed Login Attempt",

  // User Management
  USER_CREATED: "User Created",
  USER_UPDATED: "User Updated",
  USER_STATUS_CHANGED: "Status Changed",
  USER_DELETED: "User Deleted",
  USER_IMPERSONATED: "User Impersonated",

  // Orders
  ORDER_CREATED: "Order Created",
  ORDER_STATUS_UPDATED: "Order Status Updated",
  ORDER_CANCELLED: "Order Cancelled",
  ORDER_REPORTED: "Order Reported",
  ORDER_BULK_PROCESSED: "Bulk Order Processed",

  // Wallet
  WALLET_TOPUP_REQUESTED: "Wallet Top-up Requested",
  WALLET_TOPUP_APPROVED: "Wallet Top-up Approved",
  WALLET_TOPUP_REJECTED: "Wallet Top-up Rejected",
  WALLET_CREDITED: "Wallet Credited",
  WALLET_DEBITED: "Wallet Debited",
  WALLET_PAYSTACK_INITIATED: "Paystack Payment Initiated",
  WALLET_PAYSTACK_VERIFIED: "Paystack Payment Verified",

  // Storefront
  STOREFRONT_CREATED: "Storefront Created",
  STOREFRONT_UPDATED: "Storefront Updated",
  STOREFRONT_PRICING_UPDATED: "Pricing Updated",
  STOREFRONT_APPROVED: "Storefront Approved",
  STOREFRONT_SUSPENDED: "Storefront Suspended",
  STOREFRONT_ORDER_CREATED: "Storefront Order Created",
  STOREFRONT_PAYMENT_VERIFIED: "Payment Verified",

  // Payouts
  PAYOUT_REQUESTED: "Payout Requested",
  PAYOUT_APPROVED: "Payout Approved",
  PAYOUT_REJECTED: "Payout Rejected",
  PAYOUT_COMPLETED: "Payout Completed",
  PAYOUT_FAILED: "Payout Failed",
  EARNINGS_CONVERTED_TO_WALLET: "Earnings Converted to Wallet",

  // Settings
  SETTINGS_UPDATED: "Settings Updated",

  // Bundles
  BUNDLE_CREATED: "Bundle Created",
  BUNDLE_UPDATED: "Bundle Updated",
  BUNDLE_DELETED: "Bundle Deleted",

  // Referral
  REFERRAL_COMMISSION_CALCULATED: "Commission Calculated",
  REFERRAL_COMMISSION_CREDITED: "Commission Credited",
  REFERRAL_COMMISSION_CANCELLED: "Commission Cancelled",
  REFERRAL_COMMISSION_WITHDRAWN: "Commission Withdrawn",

  // API Key
  API_KEY_CREATED: "API Key Created",
  API_KEY_UPDATED: "API Key Updated",
  API_KEY_REVOKED: "API Key Revoked",
  API_KEY_SUSPENDED: "API Key Suspended",
  API_KEY_ACTIVATED: "API Key Activated",
  API_KEY_REGENERATED: "API Key Regenerated",
  API_KEY_EXPIRATION_SET: "API Key Expiration Set",
  API_KEY_PERMISSIONS_UPDATED: "API Key Permissions Updated",
  API_KEY_LISTED: "API Keys Listed",
  API_KEY_VIEWED: "API Key Viewed",
};

export const AUDIT_CATEGORIES = {
  AUTH: "Authentication",
  USER: "User Management",
  ORDER: "Orders",
  WALLET: "Wallet",
  STOREFRONT: "Storefront",
  PAYOUT: "Payouts",
  SETTINGS: "Settings",
  BUNDLE: "Bundles",
  REFERRAL: "Referral",
  API_KEY: "API Key Management",
};

export const AUDIT_SEVERITIES = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
};
