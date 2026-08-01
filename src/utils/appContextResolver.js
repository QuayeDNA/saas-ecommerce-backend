const APP_IDS = {
  APP_A: "app_a",
  APP_B: "app_b",
  APP_C: "app_c",
};

const DEFAULT_APP_ID = APP_IDS.APP_A;

const DEFAULT_EMAIL_BRAND = {
  brandName: "SaaS E-commerce",
  primary: "#142850",
  primaryLight: "#1e3a5f",
  secondary: "#0ea5e9",
  accent: "#14b8a6",
  headerGradient: "linear-gradient(135deg, #142850, #0ea5e9)",
  textPrimary: "#1e293b",
  textSecondary: "#64748b",
  textMuted: "#94a3b8",
  bodyBg: "#f8fafc",
  cardBg: "#ffffff",
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  logoUrl: null,
  footerText: "© 2024 SaaS E-commerce Platform. All rights reserved.",
  supportEmail: null,
};

const BASE_APP_CONFIG = {
  [APP_IDS.APP_A]: {
    aliases: ["app_a", "app-a", "appa", "brytelinks", "main", "admin"],
    origins: [
      "brytelinks.com",
      "www.brytelinks.com",
      "brytelink-chi.vercel.app",
      "saas-ecommerce.vercel.app",
      "localhost:5173",
      "localhost:3000",
    ],
    manifest: {
      name: "BryteLinks - Telecom Solutions Platform",
      short_name: "BryteLinks",
      description:
        "Modern telecom solutions platform for agents and dealers in Ghana.",
      start_url: "/",
      categories: ["business", "productivity"],
    },
    emailBrand: {
      brandName: "BryteLinks",
      primary: "#142850",
      primaryLight: "#1e3a5f",
      secondary: "#0ea5e9",
      accent: "#14b8a6",
      headerGradient: "linear-gradient(135deg, #142850, #0ea5e9)",
      textPrimary: "#1e293b",
      textSecondary: "#64748b",
      textMuted: "#94a3b8",
      bodyBg: "#f8fafc",
      cardBg: "#ffffff",
      success: "#10b981",
      error: "#ef4444",
      warning: "#f59e0b",
      logoUrl: null,
      footerText: "© 2024 BryteLinks. All rights reserved.",
      supportEmail: "support@brytelinks.com",
    },
  },
  [APP_IDS.APP_B]: {
    aliases: [
      "app_b",
      "app-b",
      "appb",
      "storefront",
      "directdata",
      "public-store",
    ],
    origins: ["directdata.shop", "storefront", "localhost:5174"],
    manifest: {
      name: "DirectData - Instant Data Bundles",
      short_name: "DirectData",
      description:
        "A modern storefront for buying data bundles from trusted agents across Ghana.",
      start_url: "/",
      categories: ["business", "finance", "utilities"],
    },
    emailBrand: {
      brandName: "DirectData",
      primary: "#0057FF",
      primaryLight: "#EEF2FF",
      secondary: "#C0A670",
      accent: "#252F36",
      headerGradient: "linear-gradient(135deg, #0057FF, #252F36)",
      textPrimary: "#1e293b",
      textSecondary: "#4A5270",
      textMuted: "#8891A7",
      bodyBg: "#F2F4F8",
      cardBg: "#ffffff",
      success: "#059669",
      error: "#E11D48",
      warning: "#D97706",
      logoUrl: null,
      footerText: "© 2024 DirectData. All rights reserved.",
      supportEmail: "support@directdata.shop",
    },
  },
  [APP_IDS.APP_C]: {
    aliases: [
      "app_c",
      "app-c",
      "appc",
      "directdata-app",
    ],
    origins: [],
    manifest: {
      name: "DirectData",
      short_name: "DirectData",
      description: "DirectData application.",
      start_url: "/",
      categories: ["business"],
    },
    emailBrand: {
      brandName: "DirectData",
      primary: "#142850",
      primaryLight: "#1e3a5f",
      secondary: "#0ea5e9",
      accent: "#14b8a6",
      headerGradient: "linear-gradient(135deg, #142850, #0ea5e9)",
      textPrimary: "#1e293b",
      textSecondary: "#64748b",
      textMuted: "#94a3b8",
      bodyBg: "#f8fafc",
      cardBg: "#ffffff",
      success: "#10b981",
      error: "#ef4444",
      warning: "#f59e0b",
      logoUrl: null,
      footerText: "© 2024 DirectData. All rights reserved.",
      supportEmail: null,
    },
  },
};

function toList(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function toEnvToken(appId) {
  const rawToken = String(appId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  return rawToken.replace(/^APP_/, "") || "A";
}

function parseJsonObject(raw) {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getConfiguredAppIds() {
  const fromEnv = toList(process.env.APP_IDS);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv)];
  }
  return Object.keys(BASE_APP_CONFIG);
}

function getRawAppConfig(appId) {
  const token = toEnvToken(appId);
  const base = BASE_APP_CONFIG[appId] || {};

  const aliasesFromEnv = toList(process.env[`APP_${token}_ALIASES`]);
  const originsFromEnv = toList(process.env[`APP_${token}_ORIGINS`]);
  const manifestFromEnv = parseJsonObject(
    process.env[`APP_${token}_MANIFEST_JSON`],
  );
  const emailBrandFromEnv = parseJsonObject(
    process.env[`APP_${token}_EMAIL_BRAND_JSON`],
  );

  const aliases =
    aliasesFromEnv.length > 0 ? aliasesFromEnv : base.aliases || [];
  const origins =
    originsFromEnv.length > 0 ? originsFromEnv : base.origins || [];
  const manifest = {
    ...(base.manifest || {}),
    ...(manifestFromEnv || {}),
  };
  const emailBrand = {
    ...DEFAULT_EMAIL_BRAND,
    ...(base.emailBrand || {}),
    ...(emailBrandFromEnv || {}),
  };

  return {
    aliases,
    origins,
    manifest,
    emailBrand,
  };
}

function getAppConfigMap() {
  const appIds = getConfiguredAppIds();
  const configMap = {};

  for (const appId of appIds) {
    configMap[appId] = getRawAppConfig(appId);
  }

  return configMap;
}

function normalizeCandidate(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveFromExplicitValue(value, appConfigMap) {
  const normalized = normalizeCandidate(value);
  if (!normalized) return null;

  for (const [appId, config] of Object.entries(appConfigMap)) {
    const aliases = new Set([appId, ...(config.aliases || [])]);
    if (aliases.has(normalized)) {
      return appId;
    }
  }

  return null;
}

function matchDomain(originOrReferer, domains) {
  const source = normalizeCandidate(originOrReferer);
  if (!source) return false;
  return domains.some((domain) => source.includes(domain));
}

export function resolveAppContextFromRequest(req) {
  const appConfigMap = getAppConfigMap();
  const appHeader = req.get("x-client-app") || req.get("x-app-id");
  const queryApp = req.query?.app;
  const queryContext = req.query?.context;

  const explicit = resolveFromExplicitValue(
    appHeader || queryApp,
    appConfigMap,
  );
  if (explicit) {
    return {
      appId: explicit,
      source: appHeader ? "header" : "query",
      isDefault: false,
    };
  }

  const storefrontAppId = normalizeAppId(
    process.env.STOREFRONT_APP_ID || APP_IDS.APP_B,
  );
  if (normalizeCandidate(queryContext) === "storefront") {
    return {
      appId: storefrontAppId,
      source: "query_context",
      isDefault: false,
    };
  }

  const origin = req.get("origin") || "";
  const referer = req.get("referer") || "";

  for (const [appId, config] of Object.entries(appConfigMap)) {
    const origins = config.origins || [];
    if (matchDomain(origin, origins) || matchDomain(referer, origins)) {
      return {
        appId,
        source: "origin_or_referer",
        isDefault: false,
      };
    }
  }

  if (req.originalUrl?.startsWith("/api/storefront")) {
    return {
      appId: storefrontAppId,
      source: "route_hint",
      isDefault: false,
    };
  }

  return {
    appId: DEFAULT_APP_ID,
    source: "default",
    isDefault: true,
  };
}

export function buildManifestForApp({ appId, theme = "#142850" }) {
  const normalizedAppId = normalizeAppId(appId);
  const appConfigMap = getAppConfigMap();
  const configuredManifest = appConfigMap[normalizedAppId]?.manifest || {};
  const safeTheme = String(theme || "#142850");
  const fallbackBranding = {
    name: `${normalizedAppId} - Telecom Platform`,
    short_name: normalizedAppId.toUpperCase().slice(0, 12),
    description: `Multi-tenant telecom experience for ${normalizedAppId}.`,
    start_url: "/",
    categories: ["business", "utilities"],
  };

  return {
    ...fallbackBranding,
    ...configuredManifest,
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
      { src: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { src: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    theme_color: safeTheme,
    background_color: safeTheme,
    display: "standalone",
    orientation: "portrait-primary",
  };
}

export function getRegisteredAppIds() {
  return getConfiguredAppIds();
}

export function normalizeAppId(appId) {
  const candidate = normalizeCandidate(appId);
  const registered = new Set(getConfiguredAppIds());
  if (candidate && registered.has(candidate)) {
    return candidate;
  }
  return normalizeCandidate(process.env.DEFAULT_APP_ID) || DEFAULT_APP_ID;
}

export function getEmailTheme(appId) {
  const normalizedAppId = normalizeAppId(appId);
  const config = getRawAppConfig(normalizedAppId);
  return config.emailBrand || { ...DEFAULT_EMAIL_BRAND };
}

export function getDefaultEmailTheme() {
  return { ...DEFAULT_EMAIL_BRAND };
}

export function getLocalAppIdentity() {
  const appId = normalizeAppId();
  const manifest = getRawAppConfig(appId)?.manifest || {};
  return {
    appId,
    name: manifest.short_name || manifest.name || appId,
  };
}

export { APP_IDS, DEFAULT_APP_ID };
