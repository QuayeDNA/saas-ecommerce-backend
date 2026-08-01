import { describe, it, expect } from "vitest";
import CrossAppTransfer from "../models/CrossAppTransfer.js";

describe("CrossAppTransfer model", () => {
  it("exposes the expected schema paths", () => {
    const paths = CrossAppTransfer.schema.paths;
    expect(paths.reference.options.required).toBe(true);
    expect(paths.reference.options.unique).toBe(true);
    expect(paths.status.options.enum).toEqual(["completed", "failed", "pending"]);
    expect(paths.status.options.default).toBe("pending");
    expect(paths.amount.options.min).toBe(0.01);
    expect(paths.sourceAppId.options.required).toBe(true);
    expect(paths.destAppId.options.required).toBe(true);
    expect(paths.sourceUserId.options.required).toBeFalsy();
  });

  it("creates a valid document with defaults", () => {
    const doc = new CrossAppTransfer({
      reference: "crossapp_abc123",
      sourceAppId: "app_a",
      destAppId: "app_b",
      sourceUserEmail: "agent@a.com",
      destUserEmail: "agent@b.com",
      amount: 50,
      sourceAppName: "BryteLinks",
      destAppName: "DirectData",
    });
    expect(doc.reference).toBe("crossapp_abc123");
    expect(doc.status).toBe("pending");
    expect(doc.completedAt).toBeNull();
    expect(doc.error).toBeNull();
    expect(doc.note).toBe("");
    expect(doc.sourceUserEmail).toBe("agent@a.com");
  });

  it("rejects an invalid status", () => {
    const doc = new CrossAppTransfer({
      reference: "crossapp_xyz",
      sourceAppId: "app_a",
      destAppId: "app_b",
      sourceUserEmail: "a@a.com",
      destUserEmail: "b@b.com",
      amount: 5,
      sourceAppName: "A",
      destAppName: "B",
      status: "bogus",
    });
    const err = doc.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.status.message).toContain("bogus");
  });
});
