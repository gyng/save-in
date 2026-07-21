import { options, loadNotification, setupGlobals } from "./session.fixture.ts";

// The outcome webhooks are wired into the same onChanged listener the
// notifications use, so they are proved the same way: through the real handler,
// against a record the real start path wrote.
describe("download outcome webhooks", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;

  const install = async (opts: Record<string, any>) => {
    vi.resetModules();
    sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();
    Object.assign(options, {
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/save",
      webhookOnStart: false,
      webhookOnComplete: true,
      webhookOnFailed: false,
      webhookAllowInsecure: false,
      ...opts,
    });
    onCreated = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]![0];
    onChanged = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls[0]![0];
  };

  const startTracked = async (item: Record<string, any>, record: Record<string, any> = {}) => {
    sessionStore.siPendingDownloads = 1;
    await onCreated(Object.assign({ byExtensionId: "save-in" }, item));
    if (Object.keys(record).length) {
      const downloads = await import("../../../src/downloads/download-execution.ts");
      downloads.rememberStartedDownload(item.id, record);
    }
  };

  const bodies = (fetchMock: any) =>
    fetchMock.mock.calls.map((call: any) => JSON.parse(String(call[1].body)));

  test("posts the resolved path once the download completes", async () => {
    await install({});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    await startTracked(
      { id: 7, filename: "/dl/pic.png", url: "https://x/p.png" },
      { webhookEligible: true, adopted: true, url: "https://x/p.png" },
    );

    await onChanged({
      id: 7,
      state: { previous: "in_progress", current: "complete" },
      filename: { current: "/dl/Images/pic(1).png" },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(bodies(fetchMock)[0]).toMatchObject({
      event: "complete",
      id: 7,
      url: "https://x/p.png",
      path: "/dl/Images/pic(1).png",
    });
  });

  // The record is all this path has. A record whose start path did not grant
  // webhook eligibility is not one to report on, including an opted-in private
  // recovery record that retains privateContext.
  test("stays quiet for a download the start path did not clear", async () => {
    await install({});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    await startTracked(
      { id: 8, filename: "/dl/pic.png", url: "https://x/p.png" },
      { adopted: true, url: "https://x/p.png" },
    );

    await onChanged({
      id: 8,
      state: { previous: "in_progress", current: "complete" },
      filename: { current: "/dl/pic.png" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
