export const AUDIT_CATEGORIES = {
  AUTH: "auth",
  USER: "user",
  ORDER: "order",
  WALLET: "wallet",
  STOREFRONT: "storefront",
  PAYOUT: "payout",
  SETTINGS: "settings",
  BUNDLE: "bundle",
  COMMISSION: "commission",
};

export const AUDIT_ACTIONS = {
  // Auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_REGISTER: "auth.register",
  AUTH_PASSWORD_CHANGE: "auth.password_change",
  AUTH_PASSWORD_RESET: "auth.password_reset",
  AUTH_PIN_SETUP: "auth.pin_setup",
  AUTH_FAILED_LOGIN: "auth.failed_login",

  // User Management
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_DELETED: "user.deleted",
  USER_IMPERSONATED: "user.impersonated",

  // Orders
  ORDER_CREATED: "order.created",
  ORDER_STATUS_UPDATED: "order.status_updated",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_REPORTED: "order.reported",
  ORDER_BULK_PROCESSED: "order.bulk_processed",

  // Wallet
  WALLET_TOPUP_REQUESTED: "wallet.topup_requested",
  WALLET_TOPUP_APPROVED: "wallet.topup_approved",
  WALLET_TOPUP_REJECTED: "wallet.topup_rejected",
  WALLET_CREDITED: "wallet.credited",
  WALLET_DEBITED: "wallet.debited",
  WALLET_PAYSTACK_INITIATED: "wallet.paystack_initiated",
  WALLET_PAYSTACK_VERIFIED: "wallet.paystack_verified",

  // Storefront
  STOREFRONT_CREATED: "storefront.created",
  STOREFRONT_UPDATED: "storefront.updated",
  STOREFRONT_PRICING_UPDATED: "storefront.pricing_updated",
  STOREFRONT_APPROVED: "storefront.approved",
  STOREFRONT_SUSPENDED: "storefront.suspended",
  STOREFRONT_ORDER_CREATED: "storefront.order_created",
  STOREFRONT_PAYMENT_VERIFIED: "storefront.payment_verified",

  // Payouts
  PAYOUT_REQUESTED: "payout.requested",
  PAYOUT_APPROVED: "payout.approved",
  PAYOUT_REJECTED: "payout.rejected",
  PAYOUT_COMPLETED: "payout.completed",
  PAYOUT_FAILED: "payout.failed",

  // Settings & Bundles
  SETTINGS_UPDATED: "settings.updated",
  BUNDLE_CREATED: "bundle.created",
  BUNDLE_UPDATED: "bundle.updated",
  BUNDLE_DELETED: "bundle.deleted",
};

export const AUDIT_SEVERITIES = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
};
