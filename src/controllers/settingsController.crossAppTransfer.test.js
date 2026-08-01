import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    getCrossAppTransferSettings: vi.fn(),
    updateCrossAppTransferSettings: vi.fn(),
  },
}));

vi.mock("../utils/logger.js", () => ({
  default: { error: vi.fn() },
}));

import settingsService from "../services/settingsService.js";
import settingsController from "./settingsController.js";

function mockReqRes(overrides = {}) {
  const req = { params: {}, body: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe("SettingsController Cross-App Wallet Transfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getCrossAppTransferSettings", () => {
    it("returns the settings object", async () => {
      settingsService.getCrossAppTransferSettings.mockResolvedValue({
        crossAppWalletTransferEnabled: true,
      });

      const { req, res } = mockReqRes();
      await settingsController.getCrossAppTransferSettings(req, res);

      expect(settingsService.getCrossAppTransferSettings).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { crossAppWalletTransferEnabled: true },
      });
    });

    it("handles service errors", async () => {
      settingsService.getCrossAppTransferSettings.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes();
      await settingsController.getCrossAppTransferSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Failed to get cross-app wallet transfer settings",
      });
    });
  });

  describe("updateCrossAppTransferSettings", () => {
    it("updates and returns the settings object", async () => {
      settingsService.updateCrossAppTransferSettings.mockResolvedValue({
        crossAppWalletTransferEnabled: true,
      });

      const { req, res } = mockReqRes({
        body: { crossAppWalletTransferEnabled: true },
      });
      await settingsController.updateCrossAppTransferSettings(req, res);

      expect(settingsService.updateCrossAppTransferSettings).toHaveBeenCalledWith(
        { crossAppWalletTransferEnabled: true },
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { crossAppWalletTransferEnabled: true },
      });
    });

    it("handles service errors", async () => {
      settingsService.updateCrossAppTransferSettings.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes({ body: {} });
      await settingsController.updateCrossAppTransferSettings(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Failed to update cross-app wallet transfer settings",
      });
    });
  });
});
