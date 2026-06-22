// src/constants/audit.js
export const AUDIT_ACTIONS = {
  // Authentication
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.register": "Account Registration",
  "auth.password_change": "Password Change",
  "auth.password_reset": "Password Reset",
  "auth.pin_setup": "PIN Setup",
  "auth.failed_login": "Failed Login Attempt",

  // User Management
  "user.created": "User Created",
  "user.updated": "User Updated",
  "user.status_changed": "Status Changed",
  "user.deleted": "User Deleted",
  "user.impersonated": "User Impersonated",

  // Orders
  "order.created": "Order Created",
  "order.status_updated": "Order Status Updated",
  "order.cancelled": "Order Cancelled",
  "order.reported": "Order Reported",
  "order.bulk_processed": "Bulk Order Processed",

  // Wallet
  "wallet.topup_requested": "Wallet Top-up Requested",
  "wallet.topup_approved": "Wallet Top-up Approved",
  "wallet.topup_rejected": "Wallet Top-up Rejected",
  "wallet.credited": "Wallet Credited",
  "wallet.debited": "Wallet Debited",
  "wallet.paystack_initiated": "Paystack Payment Initiated",
  "wallet.paystack_verified": "Paystack Payment Verified",

  // Storefront
  "storefront.created": "Storefront Created",
  "storefront.updated": "Storefront Updated",
  "storefront.pricing_updated": "Pricing Updated",
  "storefront.approved": "Storefront Approved",
  "storefront.suspended": "Storefront Suspended",
  "storefront.order_created": "Storefront Order Created",
  "storefront.payment_verified": "Payment Verified",

  // Payouts
  "payout.requested": "Payout Requested",
  "payout.approved": "Payout Approved",
  "payout.rejected": "Payout Rejected",
  "payout.completed": "Payout Completed",
  "payout.failed": "Payout Failed",

  // Settings
  "settings.updated": "Settings Updated",

  // Bundles
  "bundle.created": "Bundle Created",
  "bundle.updated": "Bundle Updated",
  "bundle.deleted": "Bundle Deleted",

  // Referral
  "referral.commission_calculated": "Commission Calculated",
  "referral.commission_credited": "Commission Credited",
  "referral.commission_cancelled": "Commission Cancelled",
  "referral.commission_withdrawn": "Commission Withdrawn",

  // API Key
  "api_key.created": "API Key Created",
  "api_key.updated": "API Key Updated",
  "api_key.revoked": "API Key Revoked",
  "api_key.suspended": "API Key Suspended",
  "api_key.activated": "API Key Activated",
  "api_key.regenerated": "API Key Regenerated",
  "api_key.expiration_set": "API Key Expiration Set",
  "api_key.permissions_updated": "API Key Permissions Updated",
  "api_key.listed": "API Keys Listed",
  "api_key.viewed": "API Key Viewed",
};

export const AUDIT_CATEGORIES = {
  auth: "Authentication",
  user: "User Management",
  order: "Orders",
  wallet: "Wallet",
  storefront: "Storefront",
  payout: "Payouts",
  settings: "Settings",
  bundle: "Bundles",
  referral: "Referral",
  api_key: "API Key Management",
};

export const AUDIT_SEVERITIES = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  CRITICAL: "critical",
};
