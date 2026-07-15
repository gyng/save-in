// Focused retry coverage extracted from the pipeline suite.
import {
  ActiveTransfers,
  Download,
  downloadState,
  Log,
  makeState,
  Notifier,
  options,
  OffscreenClient,
  sessionStore,
  setCurrentBrowser,
} from "./download-flow.fixture.ts";
import * as RefererRules from "../../src/downloads/referer-rules.ts";

describe("automatic fetch fallback (retryViaFetch)", () => {
  const seedStartedDownload = async () => {
    const state = makeState({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    await Download.renameAndDownload(state);
  };

  beforeEach(() => {
    downloadState.records.clear();
    Download.pendingRetryFilenames.clear();
    options.fallbackFetch = true;
  });

  test("started downloads are recorded with what a retry needs", async () => {
    await seedStartedDownload();

    expect(downloadState.records.get(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
      pageUrl: "https://example.com/page",
      filename: "downloads/file.png",
      conflictAction: "uniquify",
      viaFetch: false,
      retried: false,
    });
  });

  test("does not fetch-retry an original URL whose protection cannot be preserved", async () => {
    await seedStartedDownload();
    await Download.rememberStartedDownload(101, { allowOriginalUrlFallback: false });
    vi.mocked(global.fetch).mockClear();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("retries a failed download once via a background fetch", async () => {
    await seedStartedDownload();
    options.includeFetchCredentials = true;

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(202));

    const retried = await Download.retryViaFetch(101);

    expect(retried).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/dir/file.png",
      expect.objectContaining({ credentials: "include", redirect: "follow" }),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: expect.stringMatching(/^blob:/),
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
    // The retry is adopted as its own download and marks itself so a second
    // failure cannot loop
    expect(downloadState.records.get(202)).toMatchObject({ viaFetch: true, adopted: true });
    expect(Object.values(sessionStore.siFinalFilenames || {}).flat()).toContain(
      "downloads/file.png",
    );

    // Only one retry per download
    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
  });

  test("re-derives Referer protection for the retry fetch", async () => {
    await seedStartedDownload();
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    vi.mocked(global.browser.downloads.download).mockResolvedValue(202);
    const withReferer = vi.spyOn(RefererRules, "withRequestReferer");

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(withReferer).toHaveBeenCalledWith(
      "https://example.com/dir/file.png",
      "https://example.com/page",
      expect.any(Function),
    );
  });

  test("retries without Referer protection when the feature is off", async () => {
    await seedStartedDownload();
    options.setRefererHeader = false;
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    vi.mocked(global.browser.downloads.download).mockResolvedValue(202);
    const withReferer = vi.spyOn(RefererRules, "withRequestReferer");

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(withReferer).not.toHaveBeenCalled();
  });

  test("keeps a source-sidecar retry quiet from its first browser event", async () => {
    await seedStartedDownload();
    await Download.rememberStartedDownload(101, { sourceSidecar: true });
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    vi.mocked(global.browser.downloads.download).mockResolvedValue(202);

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(Notifier.expectDownload).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), {
      privateContext: false,
      sourceSidecar: true,
    });
    expect(downloadState.records.get(202)).toMatchObject({
      adopted: true,
      sourceSidecar: true,
      viaFetch: true,
    });
  });

  test("keeps a Firefox private retry private and clears its transient filename", async () => {
    setCurrentBrowser("FIREFOX");
    const state = makeState({
      info: {
        url: "https://example.com/private/file.png",
        pageUrl: "https://example.com/private",
        currentTab: { incognito: true },
      },
    });
    await Download.renameAndDownload(state);
    options.includeFetchCredentials = true;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-retry");
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(202));

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/private/file.png",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "blob:private-retry",
      filename: "downloads/file.png",
      conflictAction: "uniquify",
      incognito: true,
    });
    expect(Download.pendingRetryFilenames.has("blob:private-retry")).toBe(false);
    expect(sessionStore.siDownloads?.[202]).toBeUndefined();
  });

  test("omits credentials from fallback fetching unless enabled", async () => {
    await seedStartedDownload();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(203));

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/dir/file.png",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
  });

  test("cleans pending retry state when the browser rejects the retry", async () => {
    await seedStartedDownload();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-rejected");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("denied")));

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(sessionStore.siPendingDownloads).toBe(0);
    expect(sessionStore.siFinalFilenames).toEqual({});
    expect(Download.pendingRetryFilenames.has("blob:retry-rejected")).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:retry-rejected");
  });

  test("does not save an HTTP error body as fetched content", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, blob: vi.fn() })) as any;

    await expect(Download.acquireFetchedUrl("https://x/error")).resolves.toEqual({
      url: "https://x/error",
      source: "fetch-fallback-direct",
    });
    expect(Log.addLogEntry).toHaveBeenCalledWith("fetch download failed", "Error: HTTP 503");
  });

  test("survives a service worker restart: retry works from the persisted record", async () => {
    await seedStartedDownload();

    // the record is persisted to storage.session alongside the in-memory map
    expect(sessionStore.siDownloads[101]!).toMatchObject({
      url: "https://example.com/dir/file.png",
      filename: "downloads/file.png",
    });

    // a restart wipes the in-memory map; storage.session survives
    downloadState.records.clear();
    expect(await Download.getStartedDownload(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(303));

    // the fetch-retry still works even though the in-memory record is gone
    await expect(Download.retryViaFetch(101)).resolves.toBe(true);
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("never retries downloads that already went through a fetch", async () => {
    downloadState.records.set(7, {
      url: "https://x/y.png",
      filename: "y.png",
      viaFetch: true,
      retried: false,
    });
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(7)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when the option is disabled", async () => {
    await seedStartedDownload();
    options.fallbackFetch = false;
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an HTTP error response does not start a second download", async () => {
    await seedStartedDownload();
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 })) as any;
    (global.browser.downloads as any).download = vi.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("holds and releases a retry that has no history transfer owner", async () => {
    await seedStartedDownload();
    const record = downloadState.records.get(101)!;
    delete record.historyEntryId;
    const hold = vi.spyOn(ActiveTransfers, "holdTransferKeepalive");
    const release = vi.spyOn(ActiveTransfers, "releaseTransferKeepalive");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:untracked-retry");
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    vi.mocked(global.browser.downloads.download).mockResolvedValue(212);

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(hold).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(hold.mock.calls[0]![0]);
    expect(Download.ownedObjectUrls.get(212)).toBe("blob:untracked-retry");
  });

  test("cancels a replacement accepted after its transfer was aborted", async () => {
    await seedStartedDownload();
    const historyEntryId = downloadState.records.get(101)!.historyEntryId!;
    const register = vi.spyOn(ActiveTransfers, "registerActiveTransfer");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:aborted-retry");
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    let acceptDownload!: (id: number) => void;
    vi.mocked(global.browser.downloads.download)
      .mockClear()
      .mockReturnValue(
        new Promise<number>((resolve) => {
          acceptDownload = resolve;
        }),
      );
    global.browser.downloads.cancel = vi.fn(() => Promise.reject(new Error("already gone")));

    const retry = Download.retryViaFetch(101);
    await vi.waitFor(() => expect(global.browser.downloads.download).toHaveBeenCalledOnce());
    const controller = register.mock.calls.at(-1)![1];
    controller.abort();
    acceptDownload(213);

    await expect(retry).resolves.toBe(false);
    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(213);
    expect(ActiveTransfers.getActiveTransfer(historyEntryId)).toBeUndefined();
  });

  test("releases offscreen content when the replacement download is rejected", async () => {
    await seedStartedDownload();
    vi.spyOn(OffscreenClient, "canUse").mockReturnValue(true);
    vi.spyOn(OffscreenClient, "fetchContent").mockResolvedValue({
      downloadUrl: "blob:offscreen-retry",
      offscreenRequestId: "offscreen-request",
    } as any);
    vi.spyOn(OffscreenClient, "release").mockRejectedValue(new Error("worker stopped"));
    vi.mocked(global.browser.downloads.download).mockRejectedValue(new Error("denied"));

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(OffscreenClient.release).toHaveBeenCalledWith("offscreen-request");
    expect(Download.pendingRetryFilenames.has("blob:offscreen-retry")).toBe(false);
  });

  test("adopts a successful offscreen retry without claiming ownership of its URL", async () => {
    await seedStartedDownload();
    vi.spyOn(OffscreenClient, "canUse").mockReturnValue(true);
    vi.spyOn(OffscreenClient, "fetchContent").mockResolvedValue({
      downloadUrl: "blob:offscreen-success",
      offscreenRequestId: "offscreen-success-request",
    } as any);
    vi.mocked(global.browser.downloads.download).mockResolvedValue(215);

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(Download.ownedObjectUrls.has(215)).toBe(false);
    expect(downloadState.records.get(215)).toMatchObject({
      adopted: true,
      viaFetch: true,
      offscreenRequestId: "offscreen-success-request",
    });
  });

  test("treats an aborted in-flight fetch as handled", async () => {
    await seedStartedDownload();
    const register = vi.spyOn(ActiveTransfers, "registerActiveTransfer");
    vi.spyOn(OffscreenClient, "canUse").mockReturnValue(true);
    let rejectFetch!: (error: Error) => void;
    vi.spyOn(OffscreenClient, "fetchContent").mockReturnValue(
      new Promise((_, reject) => {
        rejectFetch = reject;
      }) as ReturnType<typeof OffscreenClient.fetchContent>,
    );

    const retry = Download.retryViaFetch(101);
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    register.mock.calls[0]![1].abort();
    rejectFetch(new Error("aborted"));

    await expect(retry).resolves.toBe(true);
    expect(Log.addLogEntry).not.toHaveBeenCalledWith("fallback fetch failed", expect.anything());
  });

  test("records a private fetch failure without exposing it to shared state", async () => {
    setCurrentBrowser("FIREFOX");
    await Download.renameAndDownload(
      makeState({
        info: {
          url: "https://example.com/private/file.png",
          currentTab: { incognito: true },
        },
      }),
    );
    global.fetch = vi.fn(() => Promise.reject(new Error("network denied"))) as any;

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(Log.addLogEntry).toHaveBeenCalledWith("fallback fetch failed", "Error: network denied", {
      privateContext: true,
    });
  });

  test("keeps Chrome's transient filename until its synchronous listener consumes it", async () => {
    setCurrentBrowser("CHROME");
    await seedStartedDownload();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chrome-retry");
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    vi.mocked(global.browser.downloads.download).mockResolvedValue(214);

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(Download.pendingRetryFilenames.get("blob:chrome-retry")).toBe("downloads/file.png");
  });

  test("unknown download ids resolve false", async () => {
    await expect(Download.retryViaFetch(999)).resolves.toBe(false);
  });

  test("does not retry an incomplete persisted record", async () => {
    downloadState.records.set(101, { pageUrl: "https://example.com/page" });
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an immediately rejected downloads.download falls back to fetch once", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi
      .fn()
      .mockRejectedValueOnce(new Error("data: URLs are not supported"))
      .mockResolvedValue(303);
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;

    await Download.renameAndDownload(makeState());

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.browser.downloads.download).mock.calls[1]![0]!.url).toMatch(/^blob:/);
    expect(downloadState.records.get(303)).toMatchObject({ viaFetch: true });
  });

  test("immediate rejection does not fall back when disabled", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("nope")));
    global.fetch = vi.fn() as any;

    await Download.renameAndDownload(makeState());

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
