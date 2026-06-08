// src/constants/roles.js

export const ROLES = {
  AGENT: "agent",
  SUPER_AGENT: "super_agent",
  DEALER: "dealer",
  SUPER_DEALER: "super_dealer",
  ELITE_DEALER: "elite_dealer",
  MASTER_DEALER: "master_dealer",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
};

export const ALL_ROLES = [
  ROLES.AGENT,
  ROLES.SUPER_AGENT,
  ROLES.DEALER,
  ROLES.SUPER_DEALER,
  ROLES.ELITE_DEALER,
  ROLES.MASTER_DEALER,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
];

// Business users (everyone except admin and super_admin)
export const BUSINESS_ROLES = [
  ROLES.AGENT,
  ROLES.SUPER_AGENT,
  ROLES.DEALER,
  ROLES.SUPER_DEALER,
  ROLES.ELITE_DEALER,
  ROLES.MASTER_DEALER,
];
