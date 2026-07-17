import { describe, expect, it, vi } from "vitest";
import { respondAsync } from "../../../src/background/message-dispatch.ts";

describe("respondAsync", () => {
  it("returns true synchronously and turns rejection into a protocol response", async () => {
    const sendResponse = vi.fn();
    const onError = vi.fn();
    const result = respondAsync(
      "CHECK_ROUTES",
      Promise.reject(new Error("preview failed: https://private.example/token")),
      sendResponse,
      onError,
    );
    expect(result).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({
      type: "CHECK_ROUTES",
      body: {
        status: "ERROR",
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "preview failed: https://private.example/token" }),
    );
  });

  it("still responds when error reporting itself fails", async () => {
    const sendResponse = vi.fn();
    respondAsync("APPLY_CONFIG", Promise.reject(new Error("write failed")), sendResponse, () => {
      throw new Error("logger unavailable");
    });
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({
      body: { status: "ERROR", error: "INTERNAL_ERROR" },
    });
  });

  it("does not require an error-reporting callback", async () => {
    const sendResponse = vi.fn();

    respondAsync("CHECK_ROUTES", Promise.reject(new Error("failed")), sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
  });
});
