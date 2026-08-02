import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../services/settingsService.js", () => ({
  default: {
    getConnectedApps: vi.fn(),
  },
}));

import { makeRequest } from "./connectedApps.js";

const app = {
  baseUrl: "https://directdata.example.com",
  apiKey: "sk_abc",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeRequest", () => {
  it("resolves parsed JSON on 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ success: true, transfer: { status: "completed" } }),
      ),
    );

    const data = await makeRequest(app, "GET", "/api/internal/wallet/transfers/crossapp_x");

    expect(data).toEqual({ success: true, transfer: { status: "completed" } });
  });

  it("throws with err.status set when the response is non-2xx JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 404)),
    );

    await expect(makeRequest(app, "GET", "/api/x")).rejects.toMatchObject({
      message: "boom",
      status: 404,
    });
  });

  it("throws a network failure error (no status) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(makeRequest(app, "GET", "/api/x")).rejects.toThrow(
      "Request to https://directdata.example.com/api/x failed: boom",
    );
  });

  it("throws a Non-JSON response error when content-type is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>not json</html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(makeRequest(app, "GET", "/api/x")).rejects.toThrow(/Non-JSON response/);
  });
});
