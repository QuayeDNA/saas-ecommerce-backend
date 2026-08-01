import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Settings.js", () => ({
  default: { getInstance: vi.fn() },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

import Settings from "../models/Settings.js";
import settingsService from "./settingsService.js";

function makeSettings(overrides = {}) {
  return {
    crossAppWalletTransferEnabled: false,
    save: vi.fn(),
    ...overrides,
  };
}

describe("SettingsService Cross-App Wallet Transfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getCrossAppTransferSettings", () => {
    it("returns the flag defaulting to false", async () => {
      Settings.getInstance.mockResolvedValue(makeSettings());
      const result = await settingsService.getCrossAppTransferSettings();
      expect(result).toEqual({ crossAppWalletTransferEnabled: false });
    });

    it("returns true when enabled", async () => {
      Settings.getInstance.mockResolvedValue(
        makeSettings({ crossAppWalletTransferEnabled: true }),
      );
      const result = await settingsService.getCrossAppTransferSettings();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });
  });

  describe("updateCrossAppTransferSettings", () => {
    it("persists the boolean flag", async () => {
      const settings = makeSettings();
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.updateCrossAppTransferSettings({
        crossAppWalletTransferEnabled: true,
      });

      expect(settings.crossAppWalletTransferEnabled).toBe(true);
      expect(settings.save).toHaveBeenCalled();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });

    it("leaves the flag untouched when not provided", async () => {
      const settings = makeSettings({ crossAppWalletTransferEnabled: true });
      Settings.getInstance.mockResolvedValue(settings);

      const result = await settingsService.updateCrossAppTransferSettings({});

      expect(settings.save).toHaveBeenCalled();
      expect(result).toEqual({ crossAppWalletTransferEnabled: true });
    });
  });
});
