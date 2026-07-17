import { defaultOptions } from "../../../src/config/option-defaults.ts";
import type { DownloadInfo, DownloadPlan } from "../../../src/downloads/download-types.ts";
import {
  deliverDownloadOutcomeWebhook,
  deliverSaveWebhook,
} from "../../../src/downloads/webhook-delivery.ts";

const configuration = () => ({
  ...defaultOptions(),
  webhookEnabled: true,
  webhookUrl: "https://hooks.example/save",
  // Named here so they widen to boolean: each default is a literal type, and
  // these tests turn them on and off.
  webhookOnStart: true,
  webhookOnComplete: true as boolean,
  webhookOnFailed: true as boolean,
  webhookAllowInsecure: false,
  webhookIncludePageUrl: true,
  webhookIncludePageTitle: true,
  webhookIncludeSelectionText: true,
});

const plan = (info: Partial<DownloadInfo>): DownloadPlan =>
  ({
    state: {
      info: { webhookEligible: true, ...info },
      path: { finalize: () => "saved", toString: () => "saved" },
      scratch: {},
    },
    finalFullPath: "saved",
    prompt: false,
    historyEntryId: null,
  }) as DownloadPlan;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.permissions.getAll).mockResolvedValue({ permissions: [], origins: [] });
});

test.each([
  [{ url: "https://cdn.example/from-download" }, "https://cdn.example/from-download"],
  [
    { url: "data:image/png;base64,AA", sourceUrl: "https://cdn.example/from-source" },
    "https://cdn.example/from-source",
  ],
  [{ url: "blob:test", pageUrl: "https://example/from-page" }, "https://example/from-page"],
] satisfies [Partial<DownloadInfo>, string][])(
  "uses the first shareable source URL",
  async (info, expectedUrl) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverSaveWebhook(configuration(), plan(info), 7, { add: vi.fn() });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      url: expectedUrl,
    });
  },
);

// Every webhook-eligible caller sets selectedUrl (menu-click.ts, menu-tabs.ts,
// and the same-extension DOWNLOAD handler), so these are the shapes delivery
// actually sees. A data: URL is its own payload: reporting one verbatim POSTs
// the whole inline image to the endpoint.
test.each([
  [
    { selectedUrl: "data:image/png;base64,AAAA", sourceUrl: "https://cdn.example/from-source" },
    "https://cdn.example/from-source",
  ],
  [
    { selectedUrl: "blob:https://example/uuid", pageUrl: "https://example/from-page" },
    "https://example/from-page",
  ],
] satisfies [Partial<DownloadInfo>, string][])(
  "skips past an opaque selectedUrl to the first shareable source",
  async (info, expectedUrl) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverSaveWebhook(configuration(), plan(info), 7, { add: vi.fn() });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      url: expectedUrl,
    });
  },
);

// Saving an inline image names every source with the same data: URL. Reporting
// one verbatim would POST the whole payload to the endpoint.
test("sends nothing when every source is an inline data: payload", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
  const inline = "data:image/png;base64,AAAA";

  await deliverSaveWebhook(
    configuration(),
    plan({ selectedUrl: inline, url: inline, sourceUrl: inline }),
    7,
    { add: vi.fn() },
  );

  expect(fetchMock).not.toHaveBeenCalled();
});

test("contains permission failures and rejected webhook responses", async () => {
  const log = { add: vi.fn() };
  vi.mocked(browser.permissions.getAll).mockRejectedValueOnce(new Error("unavailable"));
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 429,
  } as Response);

  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), 7, log);
  expect(log.add).toHaveBeenCalledWith("webhook skipped: data permission not granted");
  expect(fetchMock).not.toHaveBeenCalled();

  vi.mocked(browser.permissions.getAll).mockResolvedValueOnce({
    permissions: [],
    origins: [],
    data_collection: ["browsingActivity", "websiteActivity", "websiteContent"],
  } as Awaited<ReturnType<typeof browser.permissions.getAll>>);
  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), 7, log);
  // The line names which endpoint refused, now that there can be more than one.
  expect(log.add).toHaveBeenCalledWith("webhook rejected", { line: 1, status: 429 });
});

test.each([
  null,
  {
    permissions: [],
    origins: [],
    data_collection: ["browsingActivity", "websiteActivity", "websiteContent", 7],
  },
])("rejects malformed data-permission responses", async (permissions) => {
  const log = { add: vi.fn() };
  vi.mocked(browser.permissions.getAll).mockResolvedValueOnce(permissions as never);
  const fetchMock = vi.spyOn(globalThis, "fetch");

  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), 7, log);

  expect(log.add).toHaveBeenCalledWith("webhook skipped: data permission not granted");
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([undefined, {}])(
  "uses the in-product switch when the host has no data-permission API",
  async (hostPermissions) => {
    const permissions = browser.permissions;
    Object.defineProperty(browser, "permissions", { configurable: true, value: hostPermissions });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    try {
      await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), 7, {
        add: vi.fn(),
      });
    } finally {
      Object.defineProperty(browser, "permissions", { configurable: true, value: permissions });
    }

    expect(fetchMock).toHaveBeenCalledOnce();
  },
);

test("rejects invalid endpoints and absent public URLs before requesting permission", async () => {
  const invalid = configuration();
  invalid.webhookUrl = "http://localhost/private";
  await deliverSaveWebhook(invalid, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
    add: vi.fn(),
  });
  await deliverSaveWebhook(configuration(), plan({ url: "data:text/plain,x" }), 7, {
    add: vi.fn(),
  });

  expect(browser.permissions.getAll).not.toHaveBeenCalled();
});

describe("multiple endpoints", () => {
  const twoHooks = () => {
    const configured = configuration();
    configured.webhookUrl = "https://a.example/save\nhttps://b.example/save";
    return configured;
  };

  test("posts the same payload to every configured endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://a.example/save",
      "https://b.example/save",
    ]);
    const bodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));
    expect(new Set(bodies).size).toBe(1);
  });

  // One unreachable endpoint must not cost the others their delivery.
  test("delivers to the healthy endpoints when one fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network is down"))
      .mockResolvedValue({ ok: true } as Response);
    const add = vi.fn();

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("webhook delivery failed", { line: 1 });
  });

  test("reports a rejecting endpoint by line, never by URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    const add = vi.fn();
    const configured = configuration();
    configured.webhookUrl = "https://a.example/save?token=secret";

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add,
    });

    // A query-string secret must not reach the debug log through a report.
    expect(JSON.stringify(add.mock.calls)).not.toContain("secret");
    expect(add).toHaveBeenCalledWith("webhook rejected", { line: 1, status: 500 });
  });

  test("asks for data permission once, not once per endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });

    expect(browser.permissions.getAll).toHaveBeenCalledOnce();
  });

  test("skips a rejected line and still delivers the usable one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookUrl = "http://insecure.example/save\nhttps://ok.example/save";

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["https://ok.example/save"]);
  });
  test("delivers to a plaintext endpoint only while the setting allows one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookUrl = "http://insecure.example/save";
    configured.webhookAllowInsecure = true;

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["http://insecure.example/save"]);

    // Turning it back off is enough on its own: the stored list still names the
    // endpoint, and the delivery re-reads the policy rather than a saved verdict.
    fetchMock.mockClear();
    configured.webhookAllowInsecure = false;
    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not treat allowing http as allowing any other scheme", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookUrl = "ftp://files.example/save\nfile:///etc/passwd";
    configured.webhookAllowInsecure = true;

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), 7, {
      add: vi.fn(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("download outcome events", () => {
  const eligible = () => ({ url: "https://cdn.example/a", webhookEligible: true }) as const;

  test("reports the resolved path a receiver is waiting for", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverDownloadOutcomeWebhook(
      configuration(),
      eligible(),
      7,
      { status: "complete", path: "Images/cat(1).jpg" },
      { add: vi.fn() },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      version: 1,
      event: "complete",
      timestamp: expect.any(String),
      id: 7,
      url: "https://cdn.example/a",
      path: "Images/cat(1).jpg",
    });
  });

  // The record cannot tell a private download from a public one after a worker
  // restart, so an outcome is only reported when the start path said it could
  // be. A record that never answered is not an invitation to guess.
  test.each([{ webhookEligible: false }, {}])(
    "sends no outcome for a download the start path did not clear (%o)",
    async (overrides) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

      await deliverDownloadOutcomeWebhook(
        configuration(),
        { url: "https://cdn.example/a", ...overrides },
        7,
        { status: "complete", path: "Images/cat.jpg" },
        { add: vi.fn() },
      );

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("each outcome answers to its own checkbox", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookOnFailed = false;

    await deliverDownloadOutcomeWebhook(
      configured,
      eligible(),
      7,
      { status: "failed", reason: "NETWORK_FAILED" },
      { add: vi.fn() },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    configured.webhookOnFailed = true;
    await deliverDownloadOutcomeWebhook(
      configured,
      eligible(),
      7,
      { status: "failed", reason: "NETWORK_FAILED" },
      { add: vi.fn() },
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      event: "failed",
      id: 7,
      reason: "NETWORK_FAILED",
    });

    // Completion is the default, and start is not.
    configured.webhookOnComplete = false;
    fetchMock.mockClear();
    await deliverDownloadOutcomeWebhook(
      configured,
      eligible(),
      7,
      { status: "complete", path: "a.jpg" },
      { add: vi.fn() },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("carries no page context, so it asks for no page-data consent", async () => {
    vi.mocked(browser.permissions.getAll).mockResolvedValue({
      permissions: [],
      origins: [],
      data_collection: ["browsingActivity", "websiteActivity"],
    } as Awaited<ReturnType<typeof browser.permissions.getAll>>);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookIncludePageTitle = true;

    await deliverDownloadOutcomeWebhook(
      configured,
      eligible(),
      7,
      { status: "complete", path: "a.jpg" },
      { add: vi.fn() },
    );

    // websiteContent is not granted, and the save event would have been skipped.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).not.toHaveProperty("pageUrl");
  });
});
