import {
  createSaveWebhookPayload,
  createTestWebhookPayload,
  getWebhookDataTypes,
  postWebhook,
  validateWebhookUrl,
} from "../src/shared/webhook.ts";

describe("webhook endpoint validation", () => {
  test.each([
    "https://hooks.example.com/save",
    "https://hooks.example.com/save?token=user-supplied",
  ])("accepts a direct HTTPS endpoint: %s", (value) => {
    expect(validateWebhookUrl(value)).toEqual({ ok: true, url: value });
  });

  test.each([
    "",
    "http://hooks.example.com/save",
    "https://user:secret@hooks.example.com/save",
    "https://hooks.example.com/save#fragment",
    "not a URL",
  ])("rejects unsafe or ambiguous endpoint %s", (value) => {
    expect(validateWebhookUrl(value)).toEqual({ ok: false, message: expect.any(String) });
  });
});

describe("webhook payload", () => {
  const source = {
    selectedUrl: "https://cdn.example/cat.jpg",
    pageUrl: "https://example/gallery",
    pageTitle: "Cats",
    selectionText: "private notes",
  };

  test.each([
    [{ includePageUrl: false, includePageTitle: false, includeSelectionText: false }, {}],
    [
      { includePageUrl: true, includePageTitle: false, includeSelectionText: false },
      { pageUrl: "https://example/gallery" },
    ],
    [
      { includePageUrl: false, includePageTitle: true, includeSelectionText: false },
      { pageTitle: "Cats" },
    ],
    [
      { includePageUrl: false, includePageTitle: false, includeSelectionText: true },
      { selectionText: "private notes" },
    ],
    [
      { includePageUrl: true, includePageTitle: true, includeSelectionText: false },
      { pageUrl: "https://example/gallery", pageTitle: "Cats" },
    ],
    [
      { includePageUrl: true, includePageTitle: false, includeSelectionText: true },
      { pageUrl: "https://example/gallery", selectionText: "private notes" },
    ],
    [
      { includePageUrl: false, includePageTitle: true, includeSelectionText: true },
      { pageTitle: "Cats", selectionText: "private notes" },
    ],
    [
      { includePageUrl: true, includePageTitle: true, includeSelectionText: true },
      {
        pageUrl: "https://example/gallery",
        pageTitle: "Cats",
        selectionText: "private notes",
      },
    ],
  ] as const)("adds exactly the selected optional fields", (fields, optionalFields) => {
    expect(createSaveWebhookPayload(source, fields, new Date("2026-07-14T10:00:00.000Z"))).toEqual({
      version: 1,
      event: "save",
      timestamp: "2026-07-14T10:00:00.000Z",
      url: "https://cdn.example/cat.jpg",
      ...optionalFields,
    });
  });

  test("does not emit absent optional values", () => {
    expect(
      createSaveWebhookPayload(
        { selectedUrl: "https://example/file" },
        { includePageUrl: true, includePageTitle: true, includeSelectionText: true },
        new Date("2026-07-14T10:00:00.000Z"),
      ),
    ).toEqual({
      version: 1,
      event: "save",
      timestamp: "2026-07-14T10:00:00.000Z",
      url: "https://example/file",
    });
  });

  test.each([
    [false, false, false, ["browsingActivity", "websiteActivity"]],
    [true, false, false, ["browsingActivity", "websiteActivity"]],
    [false, true, false, ["browsingActivity", "websiteActivity", "websiteContent"]],
    [false, false, true, ["browsingActivity", "websiteActivity", "websiteContent"]],
    [true, true, false, ["browsingActivity", "websiteActivity", "websiteContent"]],
    [true, false, true, ["browsingActivity", "websiteActivity", "websiteContent"]],
    [false, true, true, ["browsingActivity", "websiteActivity", "websiteContent"]],
    [true, true, true, ["browsingActivity", "websiteActivity", "websiteContent"]],
  ] as const)(
    "uses the exact data categories for each field selection",
    (includePageUrl, includePageTitle, includeSelectionText, expected) => {
      expect(
        getWebhookDataTypes({ includePageUrl, includePageTitle, includeSelectionText }),
      ).toEqual(expected);
    },
  );

  test("test payloads contain no browsing data", () => {
    expect(createTestWebhookPayload(new Date("2026-07-14T10:00:00.000Z"))).toEqual({
      version: 1,
      event: "test",
      timestamp: "2026-07-14T10:00:00.000Z",
    });
  });
});

describe("webhook delivery", () => {
  test("posts JSON without credentials, referrer, redirects, or response-body reads", async () => {
    const response = { ok: true, status: 204, text: vi.fn() };
    const fetcher = vi.fn(async () => response);
    const payload = createTestWebhookPayload(new Date("2026-07-14T10:00:00.000Z"));

    await expect(
      postWebhook("https://hooks.example/save", payload, { fetcher, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: true, status: 204 });

    expect(fetcher).toHaveBeenCalledWith(
      "https://hooks.example/save",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(response.text).not.toHaveBeenCalled();
  });

  test("reports HTTP rejection without reading its body", async () => {
    const response = { ok: false, status: 401, json: vi.fn() };
    const fetcher = vi.fn(async () => response);

    await expect(
      postWebhook("https://hooks.example/save", createTestWebhookPayload(), {
        fetcher,
        timeoutMs: 100,
      }),
    ).resolves.toEqual({ ok: false, status: 401 });
    expect(response.json).not.toHaveBeenCalled();
  });

  test("aborts a request that exceeds its delivery timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        (_input: string, init: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted")));
          }),
      );
      const delivery = postWebhook("https://hooks.example/save", createTestWebhookPayload(), {
        fetcher,
        timeoutMs: 50,
      });
      const rejected = expect(delivery).rejects.toThrow("Aborted");

      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
