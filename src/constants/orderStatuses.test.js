import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  CANCELLABLE_STATUSES,
  COMPLETABLE_STATUSES,
  ALL_STATUSES,
} from "./orderStatuses.js";

describe("Order Status Constants", () => {
  it("should include all expected status values", () => {
    expect(ORDER_STATUSES.PENDING).toBe("pending");
    expect(ORDER_STATUSES.PENDING_PAYMENT).toBe("pending_payment");
    expect(ORDER_STATUSES.CONFIRMED).toBe("confirmed");
    expect(ORDER_STATUSES.PROCESSING).toBe("processing");
    expect(ORDER_STATUSES.PARTIALLY_COMPLETED).toBe("partially_completed");
    expect(ORDER_STATUSES.COMPLETED).toBe("completed");
    expect(ORDER_STATUSES.CANCELLED).toBe("cancelled");
    expect(ORDER_STATUSES.FAILED).toBe("failed");
    expect(ORDER_STATUSES.WORK_IN_PROGRESS).toBe("work_in_progress");
  });

  it("should include work_in_progress in ALL_STATUSES", () => {
    expect(ALL_STATUSES).toContain("work_in_progress");
  });

  it("should not include work_in_progress in TERMINAL_STATUSES", () => {
    expect(TERMINAL_STATUSES).not.toContain("work_in_progress");
  });

  it("should include work_in_progress in CANCELLABLE_STATUSES", () => {
    expect(CANCELLABLE_STATUSES).toContain("work_in_progress");
  });

  it("should include work_in_progress in COMPLETABLE_STATUSES", () => {
    expect(COMPLETABLE_STATUSES).toContain("work_in_progress");
  });
});
