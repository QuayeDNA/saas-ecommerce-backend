import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    getIntegrationKey: vi.fn(),
    generateIntegrationKey: vi.fn(),
  },
}));

import settingsService from "../services/settingsService.js";
import settingsController from "./settingsController.js";

function mockReqRes(overrides = {}) {
  const req = { ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe("SettingsController Integration Key", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getIntegrationKey", () => {
    it("should return integration key info from service", async () => {
      const serviceResult = {
        label: "prod",
        createdAt: new Date("2024-06-01"),
        regeneratedAt: null,
        keyPreview: "abcd",
      };
      settingsService.getIntegrationKey.mockResolvedValue(serviceResult);

      const { req, res } = mockReqRes();
      await settingsController.getIntegrationKey(req, res);

      expect(settingsService.getIntegrationKey).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith(serviceResult);
    });

    it("should return keyPreview null when no key exists", async () => {
      settingsService.getIntegrationKey.mockResolvedValue({
        keyPreview: null,
      });

      const { req, res } = mockReqRes();
      await settingsController.getIntegrationKey(req, res);

      expect(res.json).toHaveBeenCalledWith({ keyPreview: null });
    });

    it("should handle service errors", async () => {
      settingsService.getIntegrationKey.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes();
      await settingsController.getIntegrationKey(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Failed to get integration key",
      });
    });
  });

  describe("regenerateIntegrationKey", () => {
    it("should return the raw key with warning message", async () => {
      const rawKey = "sk_integ_abc123...";
      settingsService.generateIntegrationKey.mockResolvedValue(rawKey);

      const { req, res } = mockReqRes();
      await settingsController.regenerateIntegrationKey(req, res);

      expect(settingsService.generateIntegrationKey).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith({
        key: rawKey,
        message: "Save this key — it will not be shown again",
      });
    });

    it("should handle service errors", async () => {
      settingsService.generateIntegrationKey.mockRejectedValue(
        new Error("Generation failed"),
      );

      const { req, res } = mockReqRes();
      await settingsController.regenerateIntegrationKey(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Failed to regenerate integration key",
      });
    });
  });
});
