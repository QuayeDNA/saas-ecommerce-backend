import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Order.js", () => ({ default: { findOne: vi.fn(), findByIdAndUpdate: vi.fn() } }));
vi.mock("../models/User.js", () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock("../models/WalletTransaction.js", () => ({ default: { create: vi.fn() } }));
vi.mock("../models/KnownMtnNumber.js", () => ({
  default: { exists: vi.fn(), deleteOne: vi.fn(), create: vi.fn() },
}));
vi.mock("../models/Settings.js", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("./walletService.js", () => ({ default: { creditWallet: vi.fn() } }));
vi.mock("./notificationService.js", () => ({ default: { createInAppNotification: vi.fn() } }));
vi.mock("./websocketService.js", () => ({ default: { broadcastOrderStatusUpdate: vi.fn() } }));
vi.mock("../utils/logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../utils/auditLogger.js", () => ({ logAuditAction: vi.fn().mockResolvedValue() }));

import KnownMtnNumber from "../models/KnownMtnNumber.js";
import orderService from "./orderService.js";

describe("OrderService WIP", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  describe("_removeFromKnownMtnList", () => {
    it("should normalize and remove MTN phone from known list", async () => {
      KnownMtnNumber.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await orderService._removeFromKnownMtnList("0541234567");
      expect(KnownMtnNumber.deleteOne).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should normalize 233 prefix before removing", async () => {
      KnownMtnNumber.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await orderService._removeFromKnownMtnList("233541234567");
      expect(KnownMtnNumber.deleteOne).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should do nothing when phone is empty", async () => {
      await orderService._removeFromKnownMtnList("");
      expect(KnownMtnNumber.deleteOne).not.toHaveBeenCalled();
    });

    it("should do nothing when phone is null", async () => {
      await orderService._removeFromKnownMtnList(null);
      expect(KnownMtnNumber.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe("_addToKnownMtnList", () => {
    it("should add phone to known list if not already present", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({ phone: "0541234567" });
      await orderService._addToKnownMtnList("0541234567");
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should not add phone if already in known list", async () => {
      KnownMtnNumber.exists.mockResolvedValue(true);
      await orderService._addToKnownMtnList("0541234567");
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });

    it("should normalize 233 prefix before adding", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({});
      await orderService._addToKnownMtnList("233541234567");
      expect(KnownMtnNumber.exists).toHaveBeenCalledWith({ phone: "0541234567" });
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0541234567" });
    });

    it("should do nothing when phone is empty", async () => {
      await orderService._addToKnownMtnList("");
      expect(KnownMtnNumber.exists).not.toHaveBeenCalled();
    });
  });

  describe("_getMtnPhonesFromOrder", () => {
    it("should extract MTN phones from order items", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
          { customerPhone: "0542222222", packageDetails: { provider: "Vodafone" } },
          { customerPhone: "0543333333", packageDetails: { provider: "MTN" } },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual(["0541111111", "0543333333"]);
    });

    it("should use top-level provider field when packageDetails is missing", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", provider: "MTN" },
          { customerPhone: "0542222222", provider: "AirtelTigo" },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual(["0541111111"]);
    });

    it("should not include non-MTN phones", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "Vodafone" } },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual([]);
    });

    it("should handle empty items", () => {
      const phones = orderService._getMtnPhonesFromOrder({ items: [] });
      expect(phones).toEqual([]);
    });

    it("should handle missing items", () => {
      const phones = orderService._getMtnPhonesFromOrder({});
      expect(phones).toEqual([]);
    });

    it("should deduplicate same phone across multiple MTN items", () => {
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
        ],
      };
      const phones = orderService._getMtnPhonesFromOrder(order);
      expect(phones).toEqual(["0541111111"]);
    });
  });

  describe("addMtnNumbersToKnownList", () => {
    it("should add all MTN phones from order to known list", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({});
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
          { customerPhone: "0542222222", packageDetails: { provider: "MTN" } },
        ],
      };
      await orderService.addMtnNumbersToKnownList(order);
      expect(KnownMtnNumber.create).toHaveBeenCalledTimes(2);
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0541111111" });
      expect(KnownMtnNumber.create).toHaveBeenCalledWith({ phone: "0542222222" });
    });

    it("should skip non-MTN phones", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "Vodafone" } },
        ],
      };
      await orderService.addMtnNumbersToKnownList(order);
      expect(KnownMtnNumber.exists).not.toHaveBeenCalled();
      expect(KnownMtnNumber.create).not.toHaveBeenCalled();
    });

    it("should not add duplicate numbers from same order", async () => {
      KnownMtnNumber.exists.mockResolvedValue(null);
      KnownMtnNumber.create.mockResolvedValue({});
      const order = {
        items: [
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
          { customerPhone: "0541111111", packageDetails: { provider: "MTN" } },
        ],
      };
      await orderService.addMtnNumbersToKnownList(order);
      expect(KnownMtnNumber.create).toHaveBeenCalledTimes(1);
    });
  });
});
