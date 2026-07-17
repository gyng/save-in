import {
  createSaveWebhookPayload,
  createTestWebhookPayload,
  getWebhookDataTypes,
  parseWebhookEndpoints,
  postWebhook,
  validateWebhookUrl,
  WEBHOOK_ENDPOINT_REASONS,
  WEBHOOK_TARGET_LIMIT,
  webhookEndpointReason,
} from "../../../src/shared/webhook.ts";

describe("webhook endpoint list", () => {
  const urls = (value: string) => parseWebhookEndpoints(value).entries.map((e) => e.value);

  // The stored option has always been one URL. It is a one-line list, so a
  // profile written before this existed keeps its endpoint with no migration.
  test("reads a single stored endpoint as a one-entry list", () => {
    expect(urls("https://hooks.example.com/save")).toEqual(["https://hooks.example.com/save"]);
    expect(parseWebhookEndpoints("https://hooks.example.com/save").issues).toEqual([]);
  });

  test("reads one endpoint per line, ignoring blank lines and edge whitespace", () => {
    expect(urls("  https://a.example/save  \n\n\thttps://b.example/save")).toEqual([
      "https://a.example/save",
      "https://b.example/save",
    ]);
  });

  test.each(["", "   \n\n  "])("reads %j as no endpoints", (value) => {
    expect(parseWebhookEndpoints(value)).toEqual({ entries: [], issues: [] });
  });

  // A bad line must not take the good ones down with it, and must never become
  // an endpoint: the editor is told, and delivery only ever sees entries.
  test("keeps a rejected line out of the entries and reports it at its line", () => {
    const result = parseWebhookEndpoints(
      "https://good.example/save\nhttp://insecure.example/save\nhttps://also-good.example/save",
    );

    expect(result.entries.map((e) => e.value)).toEqual([
      "https://good.example/save",
      "https://also-good.example/save",
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ line: 2, source: "http://insecure.example/save" }),
    ]);
  });

  // Endpoints arrive from imported configuration, which is untrusted: an
  // unbounded list turns one save into a fan-out to every address it names.
  test("sends only up to the target limit and says so at the first dropped line", () => {
    const lines = Array.from(
      { length: WEBHOOK_TARGET_LIMIT + 2 },
      (_, index) => `https://hook-${index}.example/save`,
    );
    const result = parseWebhookEndpoints(lines.join("\n"));

    expect(result.entries).toHaveLength(WEBHOOK_TARGET_LIMIT);
    expect(result.entries.map((e) => e.value)).toEqual(lines.slice(0, WEBHOOK_TARGET_LIMIT));
    expect(result.issues).toEqual([
      expect.objectContaining({ line: WEBHOOK_TARGET_LIMIT + 1 }),
      expect.objectContaining({ line: WEBHOOK_TARGET_LIMIT + 2 }),
    ]);
  });

  test("counts only usable endpoints against the limit", () => {
    const lines = [
      "http://nope.example/save",
      ...Array.from(
        { length: WEBHOOK_TARGET_LIMIT },
        (_, index) => `https://hook-${index}.example/save`,
      ),
    ];

    expect(parseWebhookEndpoints(lines.join("\n")).entries).toHaveLength(WEBHOOK_TARGET_LIMIT);
  });
});

describe("webhook endpoint validation", () => {
  test.each([
    "https://hooks.example.com/save",
    "https://hooks.example.com/save?token=user-supplied",
  ])("accepts a direct HTTPS endpoint: %s", (value) => {
    expect(validateWebhookUrl(value)).toEqual({ ok: true, url: value });
  });

  // The reason is the editor's message key, so each rejection has to keep
  // naming the same one: it is what the bad line says about itself.
  test.each([
    ["", WEBHOOK_ENDPOINT_REASONS.EMPTY],
    ["http://hooks.example.com/save", WEBHOOK_ENDPOINT_REASONS.NOT_HTTPS],
    ["https://user:secret@hooks.example.com/save", WEBHOOK_ENDPOINT_REASONS.CREDENTIALS],
    ["https://hooks.example.com/save#fragment", WEBHOOK_ENDPOINT_REASONS.FRAGMENT],
    ["not a URL", WEBHOOK_ENDPOINT_REASONS.MALFORMED],
  ])("rejects unsafe or ambiguous endpoint %s", (value, reason) => {
    expect(validateWebhookUrl(value)).toEqual({
      ok: false,
      reason,
      message: expect.any(String),
    });
  });

  test("reports each rejected line's own reason", () => {
    const { issues } = parseWebhookEndpoints(
      ["https://hooks.example.com/save", "http://insecure.example.com/save", "not a URL"].join(
        "\n",
      ),
    );
    expect(issues.map((issue) => [issue.line, webhookEndpointReason(issue.error)])).toEqual([
      [2, WEBHOOK_ENDPOINT_REASONS.NOT_HTTPS],
      [3, WEBHOOK_ENDPOINT_REASONS.MALFORMED],
    ]);
  });

  test("blames an endpoint past the limit on the limit, not on its URL", () => {
    const lines = Array.from(
      { length: WEBHOOK_TARGET_LIMIT + 1 },
      (_unused, index) => `https://hooks.example.com/${index}`,
    );
    const { issues } = parseWebhookEndpoints(lines.join("\n"));
    expect(issues.map((issue) => [issue.line, webhookEndpointReason(issue.error)])).toEqual([
      [WEBHOOK_TARGET_LIMIT + 1, WEBHOOK_ENDPOINT_REASONS.OVER_LIMIT],
    ]);
  });

  test("falls back to the malformed reason for an error it did not raise", () => {
    expect(webhookEndpointReason(new Error("from somewhere else"))).toBe(
      WEBHOOK_ENDPOINT_REASONS.MALFORMED,
    );
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
  test("rejects an unsafe endpoint before starting a request", async () => {
    const fetcher = vi.fn();

    await expect(
      postWebhook("http://hooks.example/save", createTestWebhookPayload(), { fetcher }),
    ).rejects.toThrow("HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
  });

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
