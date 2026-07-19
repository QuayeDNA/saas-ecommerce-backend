import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/KnownMtnNumber.js", () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        skip: vi.fn(() => ({
          limit: vi.fn(() => ({
            lean: vi.fn(),
          })),
        })),
      })),
    })),
    findOneAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import settingsService from "./settingsService.js";

describe("SettingsService Known Numbers CRUD", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("listMtnNumbers", () => {
    it("should return paginated results", async () => {
      KnownMtnNumber.countDocuments.mockResolvedValue(50);
      KnownMtnNumber.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([{ phone: "0541111111" }, { phone: "0542222222" }]),
            }),
          }),
        }),
      });

      const result = await settingsService.listMtnNumbers(1, 20);

      expect(result.total).toBe(50);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(3);
      expect(result.numbers).toHaveLength(2);
    });

    it("should apply search filter", async () => {
      KnownMtnNumber.countDocuments.mockResolvedValue(1);
      KnownMtnNumber.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([{ phone: "0541111111" }]),
            }),
          }),
        }),
      });

      await settingsService.listMtnNumbers(1, 20, "0541");

      expect(KnownMtnNumber.countDocuments).toHaveBeenCalledWith({
        phone: { $regex: "0541", $options: "i" },
      });
      expect(KnownMtnNumber.find).toHaveBeenCalledWith({
        phone: { $regex: "0541", $options: "i" },
      });
    });

    it("should use default page and limit", async () => {
      KnownMtnNumber.countDocuments.mockResolvedValue(0);
      KnownMtnNumber.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const result = await settingsService.listMtnNumbers();

      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(0);
    });
  });

  describe("addMtnNumber", () => {
    it("should normalize and upsert a phone number", async () => {
      KnownMtnNumber.findOneAndUpdate.mockResolvedValue({ phone: "0541111111" });

      const result = await settingsService.addMtnNumber("0541111111");

      expect(KnownMtnNumber.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: "0541111111" },
        { phone: "0541111111", importedAt: expect.any(Date) },
        { upsert: true, returnDocument: "after" },
      );
      expect(result.phone).toBe("0541111111");
    });

    it("should convert 233 prefix to 0 prefix", async () => {
      KnownMtnNumber.findOneAndUpdate.mockResolvedValue({ phone: "0541111111" });

      await settingsService.addMtnNumber("233541111111");

      expect(KnownMtnNumber.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: "0541111111" },
        { phone: "0541111111", importedAt: expect.any(Date) },
        { upsert: true, returnDocument: "after" },
      );
    });

    it("should strip spaces, dashes, and plus sign", async () => {
      KnownMtnNumber.findOneAndUpdate.mockResolvedValue({ phone: "0541111111" });

      await settingsService.addMtnNumber("+233-54-111-1111");

      expect(KnownMtnNumber.findOneAndUpdate).toHaveBeenCalledWith(
        { phone: "0541111111" },
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should throw on invalid number format", async () => {
      await expect(settingsService.addMtnNumber("123")).rejects.toThrow("Invalid phone number format");
    });

    it("should throw on empty string", async () => {
      await expect(settingsService.addMtnNumber("")).rejects.toThrow("Invalid phone number format");
    });
  });

  describe("deleteMtnNumber", () => {
    it("should delete by id and return the deleted document", async () => {
      const mockDoc = { _id: "abc123", phone: "0541111111" };
      KnownMtnNumber.findByIdAndDelete.mockResolvedValue(mockDoc);

      const result = await settingsService.deleteMtnNumber("abc123");

      expect(KnownMtnNumber.findByIdAndDelete).toHaveBeenCalledWith("abc123");
      expect(result).toBe(mockDoc);
    });

    it("should throw Known number not found if id does not exist", async () => {
      KnownMtnNumber.findByIdAndDelete.mockResolvedValue(null);

      await expect(settingsService.deleteMtnNumber("nonexistent")).rejects.toThrow("Known number not found");
    });
  });

  describe("bulkDeleteMtnNumbers", () => {
    it("should delete multiple by ids and return deletedCount", async () => {
      KnownMtnNumber.deleteMany.mockResolvedValue({ deletedCount: 3 });

      const result = await settingsService.bulkDeleteMtnNumbers(["a", "b", "c"]);

      expect(KnownMtnNumber.deleteMany).toHaveBeenCalledWith({ _id: { $in: ["a", "b", "c"] } });
      expect(result.deletedCount).toBe(3);
    });

    it("should return 0 when no ids match", async () => {
      KnownMtnNumber.deleteMany.mockResolvedValue({ deletedCount: 0 });

      const result = await settingsService.bulkDeleteMtnNumbers(["x", "y"]);

      expect(result.deletedCount).toBe(0);
    });
  });
});
