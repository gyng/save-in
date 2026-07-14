import { defaultOptions } from "../src/config/option-defaults.ts";
import type { DownloadInfo, DownloadPlan } from "../src/downloads/download-types.ts";
import { deliverSaveWebhook } from "../src/downloads/webhook-delivery.ts";

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
  expect(log.add).toHaveBeenCalledWith("webhook rejected", { status: 429 });
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
