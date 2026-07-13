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
    ["", "Enter an HTTPS webhook URL"],
    ["http://hooks.example.com/save", "Use an HTTPS webhook URL"],
    ["https://user:secret@hooks.example.com/save", "Put authentication in the query string"],
    ["https://hooks.example.com/save#fragment", "Remove the URL fragment"],
    ["not a URL", "Enter a valid HTTPS webhook URL"],
  ])("rejects unsafe or ambiguous endpoint %s", (value, message) => {
    expect(validateWebhookUrl(value)).toEqual({ ok: false, message });
  });
});

describe("webhook payload", () => {
  const source = {
    selectedUrl: "https://cdn.example/cat.jpg",
    pageUrl: "https://example/gallery",
    pageTitle: "Cats",
    selectionText: "private notes",
  };

  test("keeps the default payload purpose-limited", () => {
    expect(
      createSaveWebhookPayload(
        source,
        {
          includePageUrl: false,
          includePageTitle: false,
          includeSelectionText: false,
        },
        new Date("2026-07-14T10:00:00.000Z"),
      ),
    ).toEqual({
      version: 1,
      event: "save",
      timestamp: "2026-07-14T10:00:00.000Z",
      url: "https://cdn.example/cat.jpg",
    });
  });

  test("adds only the fields selected by the user", () => {
    expect(
      createSaveWebhookPayload(
        source,
        {
          includePageUrl: true,
          includePageTitle: true,
          includeSelectionText: true,
        },
        new Date("2026-07-14T10:00:00.000Z"),
      ),
    ).toMatchObject({
      pageUrl: "https://example/gallery",
      pageTitle: "Cats",
      selectionText: "private notes",
    });
  });

  test("does not emit absent optional values", () => {
    expect(
      createSaveWebhookPayload(
        { selectedUrl: "https://example/file" },
        { includePageUrl: true, includePageTitle: true, includeSelectionText: true },
      ),
    ).not.toMatchObject({ pageUrl: expect.anything() });
  });

  test("uses the exact Firefox data categories needed by selected fields", () => {
    expect(
      getWebhookDataTypes({
        includePageUrl: false,
        includePageTitle: false,
        includeSelectionText: false,
      }),
    ).toEqual(["browsingActivity", "websiteActivity"]);
    expect(
      getWebhookDataTypes({
        includePageUrl: true,
        includePageTitle: true,
        includeSelectionText: false,
      }),
    ).toEqual(["browsingActivity", "websiteActivity", "websiteContent"]);
  });

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
