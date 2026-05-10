// src/constants/roles.js

export const ROLES = {
  AGENT: "agent",
  SUPER_AGENT: "super_agent",
  DEALER: "dealer",
  SUPER_DEALER: "super_dealer",
  SUPER_ADMIN: "super_admin",
};

export const ALL_ROLES = [
  ROLES.AGENT,
  ROLES.SUPER_AGENT,
  ROLES.DEALER,
  ROLES.SUPER_DEALER,
  ROLES.SUPER_ADMIN,
];

// Business users (everyone except super_admin)
export const BUSINESS_ROLES = [
  ROLES.AGENT,
  ROLES.SUPER_AGENT,
  ROLES.DEALER,
  ROLES.SUPER_DEALER,
];
