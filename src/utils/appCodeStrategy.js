import { normalizeAppId } from "./appContextResolver.js";

const LEGACY_PREFIXES = {
  order: "ORD",
  storefrontOrder: "BAGS",
  agent: "BLA",
};

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

export function isAppAwareCodeGenerationEnabled() {
  return isTruthy(process.env.APP_AWARE_CODE_GENERATION_ENABLED);
}

function sanitizePrefix(prefix, maxLength = 4) {
  return String(prefix || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maxLength);
}

function getAppSpecificPrefix(kind, appId) {
  const normalizedAppId = normalizeAppId(appId);
  const rawEnvToken = normalizedAppId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const appEnvToken = rawEnvToken.replace(/^APP_/, "") || "A";
  const kindToken =
    kind === "storefrontOrder"
      ? "STOREFRONT_ORDER"
      : kind === "agent"
        ? "AGENT"
        : "ORDER";

  return process.env[`APP_${appEnvToken}_${kindToken}_PREFIX`] || null;
}

export function getPrefixByKind(kind, appId) {
  const legacy = LEGACY_PREFIXES[kind] || LEGACY_PREFIXES.order;

  if (!isAppAwareCodeGenerationEnabled()) {
    return legacy;
  }

  const maxLength = kind === "agent" ? 3 : 4;
  const configured = sanitizePrefix(
    getAppSpecificPrefix(kind, appId),
    maxLength,
  );
  return configured || legacy;
}

export { LEGACY_PREFIXES };
