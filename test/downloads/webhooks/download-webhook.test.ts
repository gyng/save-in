import { Download, Log, makeState, options, setCurrentBrowser } from "../download-flow.fixture.ts";

const enableWebhook = () => {
  vi.mocked(global.browser.permissions.getAll).mockResolvedValue({ permissions: [], origins: [] });
  Object.assign(options, {
    webhookEnabled: true,
    webhookUrl: "https://hooks.example/save?token=secret",
    webhookIncludePageUrl: true,
    webhookIncludePageTitle: true,
    webhookIncludeSelectionText: true,
  });
};

const webhookState = (info: Record<string, unknown> = {}) =>
  makeState({ info: { webhookEligible: true, ...info } });

test("delivers one webhook after a non-private Save In download starts", async () => {
  setCurrentBrowser("CHROME");
  enableWebhook();
  vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 204 } as Response);
  const state = webhookState({
    selectedUrl: "https://cdn.example/cat.jpg",
    pageUrl: "https://example/gallery",
    selectionText: "cat",
    currentTab: { title: "Cats", incognito: false },
  });

  await expect(Download.renameAndDownload(state)).resolves.toMatchObject({ status: "started" });

  await vi.waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.example/save?token=secret",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  const webhookCalls = vi
    .mocked(global.fetch)
    .mock.calls.filter(([, init]) => init?.method === "POST");
  expect(webhookCalls).toHaveLength(1);
  expect(JSON.parse(String(webhookCalls[0]?.[1]?.body))).toEqual(
    expect.objectContaining({
      event: "save",
      url: "https://cdn.example/cat.jpg",
      pageUrl: "https://example/gallery",
      pageTitle: "Cats",
      selectionText: "cat",
    }),
  );
});

test("never delivers private Save In activity", async () => {
  setCurrentBrowser("CHROME");
  enableWebhook();

  await Download.renameAndDownload(
    webhookState({ currentTab: { incognito: true }, selectedUrl: "https://secret.example" }),
  );

  expect(
    vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

test("does not treat an external integration request as an implicit-consent command", async () => {
  setCurrentBrowser("CHROME");
  enableWebhook();

  await Download.renameAndDownload(
    makeState({ info: { selectedUrl: "https://cdn.example/automated.jpg" } }),
  );

  expect(
    vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

test("respects a revoked Firefox data permission", async () => {
  setCurrentBrowser("FIREFOX");
  enableWebhook();
  vi.mocked(global.browser.permissions.getAll).mockResolvedValue({
    permissions: [],
    origins: [],
    data_collection: [],
  } as Awaited<ReturnType<typeof global.browser.permissions.getAll>>);

  await Download.renameAndDownload(webhookState({ selectedUrl: "https://cdn.example/cat.jpg" }));

  await vi.waitFor(() =>
    expect(Log.add).toHaveBeenCalledWith("webhook skipped: data permission not granted"),
  );
  expect(
    vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

test("does not deliver when the browser rejects the download", async () => {
  setCurrentBrowser("CHROME");
  enableWebhook();
  vi.mocked(global.browser.downloads.download).mockRejectedValue(new Error("disk full"));

  await expect(
    Download.renameAndDownload(webhookState({ selectedUrl: "https://cdn.example/cat.jpg" })),
  ).resolves.toEqual({ status: "failed" });

  expect(
    vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

test("a webhook failure does not change the successful download result or expose its URL", async () => {
  setCurrentBrowser("CHROME");
  enableWebhook();
  vi.mocked(global.fetch).mockRejectedValueOnce(
    new Error("request to https://hooks.example/save?token=secret failed"),
  );

  await expect(
    Download.renameAndDownload(webhookState({ selectedUrl: "https://cdn.example/cat.jpg" })),
  ).resolves.toMatchObject({ status: "started" });

  await vi.waitFor(() => expect(Log.add).toHaveBeenCalledWith("webhook delivery failed"));
  expect(Log.add).not.toHaveBeenCalledWith(
    "webhook delivery failed",
    expect.stringContaining("secret"),
  );
});
