// src/utils/dto.js
// Data Transfer Object helpers — strip internal/sensitive fields from API responses

const ADMIN_TYPES = ["admin", "super_admin"];

const PUBLIC_OMIT = ["tenantId", "createdBy", "updatedBy", "isDeleted", "deletedAt", "deletedBy", "__v"];
const ADMIN_OMIT = ["isDeleted", "deletedAt", "deletedBy", "__v"];

const sans = (obj, omit) => {
  const plain = typeof obj?.toObject === "function" ? obj.toObject() : obj;
  const result = { ...plain };
  for (const key of omit) delete result[key];
  return result;
};

export const toPublicPackage = (pkg) =>
  sans(pkg, PUBLIC_OMIT);

export const toAdminPackage = (pkg) =>
  sans(pkg, ADMIN_OMIT);

export const toPublicBundle = (bundle) =>
  sans(bundle, [...PUBLIC_OMIT, "pricingTiers", "pricingSummary"]);

export const toAdminBundle = (bundle) =>
  sans(bundle, ADMIN_OMIT);

export const pickBundle = (bundle, userType) =>
  ADMIN_TYPES.includes(userType) ? toAdminBundle(bundle) : toPublicBundle(bundle);

export const pickPackage = (pkg, userType) =>
  ADMIN_TYPES.includes(userType) ? toAdminPackage(pkg) : toPublicPackage(pkg);
