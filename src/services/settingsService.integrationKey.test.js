import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Settings.js", () => ({
  default: {
    getInstance: vi.fn(),
  },
}));

import Settings from "../models/Settings.js";
import settingsService from "./settingsService.js";

function makeSettings(overrides = {}) {
  return {
    integrationKey: {
      hashedKey: null,
      label: "",
      createdAt: null,
      regeneratedAt: null,
    },
    save: vi.fn(),
    ...overrides,
  };
}

describe("SettingsService Integration Key", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("generateIntegrationKey", () => {
    it("should generate a key starting with sk_integ_ followed by 64 hex chars", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      const rawKey = await settingsService.generateIntegrationKey();

      expect(rawKey).toMatch(/^sk_integ_[0-9a-f]{64}$/);
      expect(rawKey.length).toBe(73);
    });

    it("should hash the key with bcrypt before storing", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      const rawKey = await settingsService.generateIntegrationKey();

      const hash = settings.integrationKey.hashedKey;
      expect(hash).toBeTruthy();
      expect(hash.startsWith("sk_integ_")).toBe(false);
      expect(hash).not.toBe(rawKey);
    });

    it("should set createdAt and leave regeneratedAt null on first generation", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      await settingsService.generateIntegrationKey();

      expect(settings.integrationKey.createdAt).toBeInstanceOf(Date);
      expect(settings.integrationKey.regeneratedAt).toBeNull();
    });

    it("should preserve createdAt and set regeneratedAt on regeneration", async () => {
      const oldDate = new Date("2024-01-01");
      const settings = makeSettings({
        integrationKey: {
          hashedKey: "existing_hash",
          label: "",
          createdAt: oldDate,
          regeneratedAt: null,
        },
      });
      Settings.getInstance.mockResolvedValue(settings);

      await settingsService.generateIntegrationKey();

      expect(settings.integrationKey.createdAt).toBe(oldDate);
      expect(settings.integrationKey.regeneratedAt).toBeInstanceOf(Date);
    });

    it("should call save on the settings document", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      await settingsService.generateIntegrationKey();

      expect(settings.save).toHaveBeenCalledTimes(1);
    });

    it("should preserve existing label when regenerating", async () => {
      const settings = makeSettings({
        integrationKey: {
          hashedKey: "existing_hash",
          label: "my-label",
          createdAt: new Date("2024-01-01"),
          regeneratedAt: null,
        },
      });
      Settings.getInstance.mockResolvedValue(settings);

      await settingsService.generateIntegrationKey();

      expect(settings.integrationKey.label).toBe("my-label");
    });
  });

  describe("getIntegrationKey", () => {
    it("should return keyPreview null when hashedKey is null", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.getIntegrationKey();

      expect(result).toEqual({ keyPreview: null });
    });

    it("should return keyPreview null when integrationKey is missing", async () => {
      const settings = makeSettings({ integrationKey: undefined });
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.getIntegrationKey();

      expect(result).toEqual({ keyPreview: null });
    });

    it("should return key details when key exists", async () => {
      const createdAt = new Date("2024-06-01");
      const settings = makeSettings({
        integrationKey: {
          hashedKey: "$2b$10$abcdefgh1234567890thisislast4",
          label: "",
          createdAt,
          regeneratedAt: null,
        },
      });
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.getIntegrationKey();

      expect(result).toEqual({
        label: "",
        createdAt,
        regeneratedAt: null,
        keyPreview: "ast4",
      });
    });

    it("should include label and regeneratedAt when set", async () => {
      const createdAt = new Date("2024-01-01");
      const regeneratedAt = new Date("2024-06-01");
      const settings = makeSettings({
        integrationKey: {
          hashedKey: "some_long_hash_here_last4",
          label: "prod-instance",
          createdAt,
          regeneratedAt,
        },
      });
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.getIntegrationKey();

      expect(result.label).toBe("prod-instance");
      expect(result.createdAt).toBe(createdAt);
      expect(result.regeneratedAt).toBe(regeneratedAt);
      expect(result.keyPreview).toBe("ast4");
    });
  });
});
