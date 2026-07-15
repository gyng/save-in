// End-to-end smoke coverage for the explicit resolve/acquire/download pipeline.
import {
  capturedListener,
  BrowserDownloadRouting,
  Download,
  downloadState,
  makeState,
  Notifier,
  options,
  Path,
  SaveHistory,
  setCurrentBrowser,
} from "./download-flow.fixture.ts";

describe("pipeline stages", () => {
  test("marks saves from an incognito tab as private at the history boundary", () => {
    const state = makeState({ info: { currentTab: { incognito: true } } });

    Download.createDownloadPlan(state);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
  });

  test("updates an existing history row when planning is repeated", () => {
    const state = makeState();
    Download.createDownloadPlan(state);
    Download.createDownloadPlan(state);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledOnce();
    expect(SaveHistory.patchHistoryEntry).toHaveBeenCalledWith(
      "h-test",
      expect.objectContaining({ finalFullPath: "downloads" }),
    );
  });

  test("registers the ordinary browser-download routing adapter", async () => {
    await expect(
      BrowserDownloadRouting.route({
        url: "https://example.test/file.png",
        filename: "file.png",
      }),
    ).resolves.toBeNull();
  });

  // The RESOLVE → ACQUIRE → DOWNLOAD order is now enforced lexically inside
  // renameAndDownload; the durable contract is that each stage's output feeds
  // the next, exercised here through the real pipeline.
  test("hands the resolved plan through acquisition to the browser download", async () => {
    const state = makeState();

    const plan = await Download.resolveDownloadPlan(state);
    expect(plan).not.toBeNull();
    const acquired = await Download.acquireDownloadUrl(plan!);
    const result = await Download.executeBrowserDownload(plan!, acquired);

    expect(result).toEqual({ status: "started", downloadId: expect.any(Number) });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: acquired.url }),
    );
  });

  test("reports and cleans up a rejected acquisition", async () => {
    const state = makeState({
      info: { contentPromise: Promise.reject(new Error("content unavailable")) },
    });

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "failed" });
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(Download.downloadRuntime.pendingStates.get(state.info.url) || []).not.toContain(state);
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith(
      "h-test",
      "DOWNLOAD_PREPARATION_FAILED",
    );
    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      "downloads/file.png",
      expect.stringContaining("content unavailable"),
    );
  });

  test("keeps a rejected source-sidecar acquisition quiet", async () => {
    const state = makeState({
      info: {
        context: "SIDECAR",
        contentPromise: Promise.reject(new Error("sidecar content unavailable")),
      },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });

  test("revokes a generated URL when acquisition fails", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed-acquisition");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(Path.sanitizeFilename).mockReturnValue(null as any);
    const url = Download.makeObjectUrl("content");
    const state = makeState({
      path: { finalize: () => null },
      info: { url, contentPromise: Promise.reject(new Error("content unavailable")) },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    expect(Download.downloadRuntime.generatedObjectUrls.has(url)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      url,
      expect.stringContaining("content unavailable"),
    );
  });

  test("does not fetch-retry a Firefox download after attaching Referer", async () => {
    setCurrentBrowser("FIREFOX");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    options.fallbackFetch = true;
    const state = makeState({ info: { pageUrl: "https://gallery.example/view" } });
    vi.mocked(global.browser.downloads.download).mockRejectedValueOnce(new Error("network"));
    const fetchSpy = vi.mocked(global.fetch);

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "failed" });
    expect(fetchSpy).not.toHaveBeenCalledWith(state.info.url, { credentials: "include" });
  });

  test("protects Firefox metadata but keeps the redirect-safe native download (#193)", async () => {
    setCurrentBrowser("FIREFOX");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    options.fetchViaFetch = true;
    const state = makeState({ info: { pageUrl: "https://gallery.example/view" } });
    const updateRules = vi.mocked(global.browser.declarativeNetRequest.updateSessionRules);
    updateRules.mockClear();
    updateRules.mockResolvedValue();
    global.fetch = vi.fn((url, init) => {
      if ((init as RequestInit | undefined)?.method === "HEAD") {
        return Promise.resolve({ headers: { has: () => false, get: () => null } });
      }
      return Promise.reject(new Error(`fetch blocked: ${url}`));
    }) as any;

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "started", downloadId: 101 });
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(updateRules).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ addRules: [expect.any(Object)] }),
    );
    expect(updateRules).toHaveBeenLastCalledWith({ removeRuleIds: [66_000_001] });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        headers: [{ name: "Referer", value: "https://gallery.example/view" }],
      }),
    );
    expect(downloadState.records.get(101)?.allowOriginalUrlFallback).toBe(false);
  });

  test("correlates fetched URLs with Chrome's filename event", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "fetched.png" } });
    Download.downloadRuntime.rememberPendingState(state);
    const plan = {
      state,
      finalFullPath: "downloads/fetched.png",
      prompt: false,
      historyEntryId: "h-test",
    };

    await Download.executeBrowserDownload(plan, {
      url: "blob:fetched-file",
      source: "fetched",
    });

    expect(SaveHistory.patchHistoryEntry).toHaveBeenCalledWith("h-test", {
      mechanism: "fetch-downloads-api",
    });

    expect(Download.downloadRuntime.pendingStates.get(state.info.url)).toBeUndefined();
    expect(Download.downloadRuntime.pendingStates.get("blob:fetched-file")).toEqual([state]);

    const suggest = vi.fn();
    capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: "blob:fetched-file",
        filename: "file",
      },
      suggest,
    );
    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/fetched.png",
      conflictAction: "uniquify",
    });
  });
});
