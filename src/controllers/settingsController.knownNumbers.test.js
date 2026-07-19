import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    listMtnNumbers: vi.fn(),
    addMtnNumber: vi.fn(),
    deleteMtnNumber: vi.fn(),
    bulkDeleteMtnNumbers: vi.fn(),
  },
}));

import settingsService from "../services/settingsService.js";
import settingsController from "./settingsController.js";

function mockReqRes(overrides = {}) {
  const req = { query: {}, body: {}, params: {}, ...overrides };
  const res = { json: vi.fn(), status: vi.fn(() => res) };
  return { req, res };
}

describe("SettingsController Known Numbers CRUD", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("listMtnNumbers", () => {
    it("should return paginated results", async () => {
      settingsService.listMtnNumbers.mockResolvedValue({
        numbers: [{ phone: "0541111111" }],
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { req, res } = mockReqRes({ query: { page: "1", limit: "20" } });
      await settingsController.listMtnNumbers(req, res);

      expect(settingsService.listMtnNumbers).toHaveBeenCalledWith(1, 20, "");
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        numbers: [{ phone: "0541111111" }],
        total: 1,
        page: 1,
        totalPages: 1,
      });
    });

    it("should pass search query param", async () => {
      settingsService.listMtnNumbers.mockResolvedValue({
        numbers: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      const { req, res } = mockReqRes({ query: { page: "1", limit: "20", search: "0541" } });
      await settingsController.listMtnNumbers(req, res);

      expect(settingsService.listMtnNumbers).toHaveBeenCalledWith(1, 20, "0541");
    });

    it("should handle service errors", async () => {
      settingsService.listMtnNumbers.mockRejectedValue(new Error("DB error"));

      const { req, res } = mockReqRes();
      await settingsController.listMtnNumbers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: "DB error" });
    });
  });

  describe("addMtnNumber", () => {
    it("should create and return 201 with the number", async () => {
      settingsService.addMtnNumber.mockResolvedValue({ phone: "0541111111" });

      const { req, res } = mockReqRes({ body: { phone: "0541111111" } });
      await settingsController.addMtnNumber(req, res);

      expect(settingsService.addMtnNumber).toHaveBeenCalledWith("0541111111");
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, number: { phone: "0541111111" } });
    });

    it("should return 400 if phone is missing", async () => {
      const { req, res } = mockReqRes({ body: {} });
      await settingsController.addMtnNumber(req, res);

      expect(settingsService.addMtnNumber).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: "Phone number is required" });
    });

    it("should return 400 if service throws Invalid error", async () => {
      settingsService.addMtnNumber.mockRejectedValue(new Error("Invalid phone number format"));

      const { req, res } = mockReqRes({ body: { phone: "bad" } });
      await settingsController.addMtnNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 500 for non-validation errors", async () => {
      settingsService.addMtnNumber.mockRejectedValue(new Error("Unexpected DB error"));

      const { req, res } = mockReqRes({ body: { phone: "0541111111" } });
      await settingsController.addMtnNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("deleteMtnNumber", () => {
    it("should delete and return success message", async () => {
      settingsService.deleteMtnNumber.mockResolvedValue({ _id: "abc123" });

      const { req, res } = mockReqRes({ params: { id: "abc123" } });
      await settingsController.deleteMtnNumber(req, res);

      expect(settingsService.deleteMtnNumber).toHaveBeenCalledWith("abc123");
      expect(res.json).toHaveBeenCalledWith({ success: true, message: "Number removed from known list" });
    });

    it("should return 404 if number not found", async () => {
      settingsService.deleteMtnNumber.mockRejectedValue(new Error("Known number not found"));

      const { req, res } = mockReqRes({ params: { id: "nonexistent" } });
      await settingsController.deleteMtnNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: "Known number not found" });
    });

    it("should return 500 for unexpected errors", async () => {
      settingsService.deleteMtnNumber.mockRejectedValue(new Error("DB failure"));

      const { req, res } = mockReqRes({ params: { id: "abc123" } });
      await settingsController.deleteMtnNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("bulkDeleteMtnNumbers", () => {
    it("should delete multiple and return deletedCount", async () => {
      settingsService.bulkDeleteMtnNumbers.mockResolvedValue({ deletedCount: 2 });

      const { req, res } = mockReqRes({ body: { ids: ["a", "b"] } });
      await settingsController.bulkDeleteMtnNumbers(req, res);

      expect(settingsService.bulkDeleteMtnNumbers).toHaveBeenCalledWith(["a", "b"]);
      expect(res.json).toHaveBeenCalledWith({ success: true, deletedCount: 2 });
    });

    it("should return 400 if ids is missing", async () => {
      const { req, res } = mockReqRes({ body: {} });
      await settingsController.bulkDeleteMtnNumbers(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: "IDs array is required" });
    });

    it("should return 400 if ids is empty array", async () => {
      const { req, res } = mockReqRes({ body: { ids: [] } });
      await settingsController.bulkDeleteMtnNumbers(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if ids is not an array", async () => {
      const { req, res } = mockReqRes({ body: { ids: "not-an-array" } });
      await settingsController.bulkDeleteMtnNumbers(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 500 for unexpected errors", async () => {
      settingsService.bulkDeleteMtnNumbers.mockRejectedValue(new Error("DB failure"));

      const { req, res } = mockReqRes({ body: { ids: ["a"] } });
      await settingsController.bulkDeleteMtnNumbers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
