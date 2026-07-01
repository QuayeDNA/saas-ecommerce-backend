// src/utils/dto.js
// Data Transfer Object helpers — strip internal/sensitive fields from API responses
//
// Three visibility tiers:
//   admin   — strip only truly internal fields (isDeleted, __v, etc.)
//   business — same as admin but also strip tenantId/createdBy/updatedBy/pricingSummary
//   public  — same as business but also strip pricingTiers (anonymous/unauthenticated)
//
// The bundleController defaults to "agent" for anonymous requests, so all
// authenticated users (agents, dealers, etc.) get at least business-level and
// thus keep pricingTiers — which they need for their dashboard.

import { BUSINESS_ROLES } from "../constants/roles.js";

const ADMIN_TYPES = ["admin", "super_admin"];

const SENSITIVE = ["isDeleted", "deletedAt", "deletedBy", "__v"];
const BUSINESS_BUNDLE_OMIT = [...SENSITIVE, "tenantId", "createdBy", "updatedBy", "pricingSummary"];
const PUBLIC_BUNDLE_OMIT = [...BUSINESS_BUNDLE_OMIT, "pricingTiers"];
const BUSINESS_PACKAGE_OMIT = [...SENSITIVE, "tenantId", "createdBy", "updatedBy"];

const sans = (obj, omit) => {
  const plain = typeof obj?.toObject === "function" ? obj.toObject() : obj;
  const result = { ...plain };
  for (const key of omit) delete result[key];
  return result;
};

// Public and business tiers are identical for packages (same omit list).
// Differences could be added here later if needed (e.g. hiding pricing tiers
// from unauthenticated users); until then, both delegate to the same omit list.
export const toPublicPackage = (pkg) =>
  sans(pkg, BUSINESS_PACKAGE_OMIT);

export const toBusinessPackage = (pkg) =>
  sans(pkg, BUSINESS_PACKAGE_OMIT);

export const toAdminPackage = (pkg) =>
  sans(pkg, SENSITIVE);

export const toPublicBundle = (bundle) =>
  sans(bundle, PUBLIC_BUNDLE_OMIT);

export const toBusinessBundle = (bundle) =>
  sans(bundle, BUSINESS_BUNDLE_OMIT);

export const toAdminBundle = (bundle) =>
  sans(bundle, SENSITIVE);

export const pickBundle = (bundle, userType) => {
  if (ADMIN_TYPES.includes(userType)) return toAdminBundle(bundle);
  if (BUSINESS_ROLES.includes(userType)) return toBusinessBundle(bundle);
  return toPublicBundle(bundle);
};

export const pickPackage = (pkg, userType) => {
  if (ADMIN_TYPES.includes(userType)) return toAdminPackage(pkg);
  if (BUSINESS_ROLES.includes(userType)) return toBusinessPackage(pkg);
  return toPublicPackage(pkg);
};
