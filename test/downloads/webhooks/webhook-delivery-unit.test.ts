import { defaultOptions } from "../../../src/config/option-defaults.ts";
import type { DownloadInfo, DownloadPlan } from "../../../src/downloads/download-types.ts";
import { deliverSaveWebhook } from "../../../src/downloads/webhook-delivery.ts";

const configuration = () => ({
  ...defaultOptions(),
  webhookEnabled: true,
  webhookUrl: "https://hooks.example/save",
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

    await deliverSaveWebhook(configuration(), plan(info), { add: vi.fn() });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      url: expectedUrl,
    });
  },
);

test("contains permission failures and rejected webhook responses", async () => {
  const log = { add: vi.fn() };
  vi.mocked(browser.permissions.getAll).mockRejectedValueOnce(new Error("unavailable"));
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 429,
  } as Response);

  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), log);
  expect(log.add).toHaveBeenCalledWith("webhook skipped: data permission not granted");
  expect(fetchMock).not.toHaveBeenCalled();

  vi.mocked(browser.permissions.getAll).mockResolvedValueOnce({
    permissions: [],
    origins: [],
    data_collection: ["browsingActivity", "websiteActivity", "websiteContent"],
  } as Awaited<ReturnType<typeof browser.permissions.getAll>>);
  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), log);
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

  await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), log);

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
      await deliverSaveWebhook(configuration(), plan({ selectedUrl: "https://cdn.example/a" }), {
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
  await deliverSaveWebhook(invalid, plan({ selectedUrl: "https://cdn.example/a" }), {
    add: vi.fn(),
  });
  await deliverSaveWebhook(configuration(), plan({ url: "data:text/plain,x" }), { add: vi.fn() });

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

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), {
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

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), { add });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("webhook delivery failed", { line: 1 });
  });

  test("reports a rejecting endpoint by line, never by URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    const add = vi.fn();
    const configured = configuration();
    configured.webhookUrl = "https://a.example/save?token=secret";

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), { add });

    // A query-string secret must not reach the debug log through a report.
    expect(JSON.stringify(add.mock.calls)).not.toContain("secret");
    expect(add).toHaveBeenCalledWith("webhook rejected", { line: 1, status: 500 });
  });

  test("asks for data permission once, not once per endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    await deliverSaveWebhook(twoHooks(), plan({ selectedUrl: "https://cdn.example/a" }), {
      add: vi.fn(),
    });

    expect(browser.permissions.getAll).toHaveBeenCalledOnce();
  });

  test("skips a rejected line and still delivers the usable one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const configured = configuration();
    configured.webhookUrl = "http://insecure.example/save\nhttps://ok.example/save";

    await deliverSaveWebhook(configured, plan({ selectedUrl: "https://cdn.example/a" }), {
      add: vi.fn(),
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["https://ok.example/save"]);
  });
});
