// Focused execution coverage extracted from the pipeline suite.
import { DOWNLOAD_TYPES } from "../../src/shared/constants.ts";
import {
  backgroundRuntime,
  ActiveTransfers,
  capturedDownloadChangedListener,
  capturedListener,
  Download,
  downloaded,
  downloadState,
  extensionSessionStorage,
  hostBrowser,
  Log,
  makeState,
  Notifier,
  OffscreenClient,
  options,
  Path,
  router,
  routingRule,
  SaveHistory,
  SessionState,
  sessionStore,
  setCurrentBrowser,
  Variable,
} from "./download-flow.fixture.ts";

describe("renameAndDownload: browserDownload", () => {
  test("passes Firefox private context without a conflicting cookie store", async () => {
    setCurrentBrowser("FIREFOX");
    const state = makeState({
      info: { currentTab: { incognito: true, cookieStoreId: "firefox-private" } },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        incognito: true,
      }),
    );
    const [downloadOptions] = vi.mocked(global.browser.downloads.download).mock.calls[0]!;
    expect(downloadOptions).not.toHaveProperty("cookieStoreId");
  });

  test("persists session state, downloads, and tracks the result", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(555));

    const state = makeState();
    await Download.renameAndDownload(state);

    // pending counter + per-URL filename map are updated (see the session-
    // restart recovery tests for the values)
    expect(SessionState.updateSession).toHaveBeenCalledWith(
      expect.anything(),
      extensionSessionStorage,
      "siPendingDownloads",
      expect.any(Function),
    );
    expect(SessionState.updateSession).toHaveBeenCalledWith(
      expect.anything(),
      extensionSessionStorage,
      "siFinalFilenames",
      expect.any(Function),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: state.info.url,
      saveAs: false,
      conflictAction: "uniquify",
    });
    // download.js adopts its own download (the record is what the notifier
    // watches for a completion toast)
    expect(downloadState.records.get(555)).toMatchObject({ adopted: true });
    // incremented then cleared -> back to 0, and the filename key removed
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
    expect(sessionStore.siFinalFilenames).toEqual({});
  });

  test("does not persist a data payload as a filename-map key or download-record URL", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(556));
    const url = `data:image/png;base64,${"A".repeat(4000)}`;
    const state = makeState({ info: { url } });
    const plan = Download.createDownloadPlan(state);

    await Download.executeBrowserDownload(plan, { url, source: "direct" });

    expect(SessionState.updateSession).not.toHaveBeenCalledWith(
      expect.anything(),
      extensionSessionStorage,
      "siFinalFilenames",
      expect.any(Function),
    );
    expect([...downloadState.records.entries()]).toContainEqual([
      556,
      expect.not.objectContaining({ url }),
    ]);
    expect(downloadState.records.get(556)).toMatchObject({ adopted: true });
    expect(sessionStore.siDownloads[556]).toMatchObject({ adopted: true });
    expect(sessionStore.siDownloads[556]).not.toHaveProperty("url");
  });

  test("contains a downloads.download rejection and clears pending state", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    // a fully failed download registers no adopted record
    expect([...downloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    expect(Log.addLogEntry).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
    expect([...Download.downloadRuntime.pendingStates.values()].flat()).not.toContain(state);
  });

  test("releases offscreen content after a terminal browser rejection", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    vi.spyOn(OffscreenClient, "release").mockRejectedValue(new Error("worker stopped"));
    vi.mocked(global.browser.downloads.download).mockRejectedValue(new Error("disk full"));
    const state = makeState();
    const plan = Download.createDownloadPlan(state);

    await expect(
      Download.executeBrowserDownload(plan, {
        url: "blob:offscreen-content",
        source: "fetched",
        offscreenRequestId: "offscreen-request",
      }),
    ).resolves.toEqual({ status: "failed" });

    expect(OffscreenClient.release).toHaveBeenCalledWith("offscreen-request");
  });

  test("uses the source URL when an empty-path browser download fails", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    vi.mocked(global.browser.downloads.download).mockRejectedValue(new Error("disk full"));
    const state = makeState();
    const plan = {
      state,
      finalFullPath: "",
      prompt: false,
      historyEntryId: "h-test",
    };

    await expect(
      Download.executeBrowserDownload(plan, { url: state.info.url, source: "direct" }),
    ).resolves.toEqual({ status: "failed" });

    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      state.info.url,
      expect.stringContaining("disk full"),
    );
  });

  test("cancels a browser download when preparation is aborted as it starts", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(global.browser.downloads.cancel).mockRejectedValue(new Error("already stopped"));
    vi.mocked(global.browser.downloads.download).mockImplementation(async () => {
      expect(ActiveTransfers.cancelActiveTransfer("h-test")).toBe(true);
      return 101;
    });
    const state = makeState();

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(101);
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED", 101);
  });

  test("rejects before browser setup when acquisition is already aborted", async () => {
    const state = makeState();
    const plan = Download.createDownloadPlan(state);
    const signal = { aborted: true, reason: undefined } as AbortSignal;

    await expect(
      Download.executeBrowserDownload(plan, { url: state.info.url, source: "direct" }, signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(Notifier.expectDownload).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  // acquireDownloadUrl converts a data: payload without an abort signal, so a
  // cancel landing during that conversion is only seen by the check that
  // follows acquisition — outside executeBrowserDownload's own containment.
  test("contains an abort that lands as a data: acquisition completes", async () => {
    setCurrentBrowser("FIREFOX");
    vi.mocked(global.fetch).mockResolvedValue({
      headers: { has: () => false, get: () => null },
      blob: async () => ({ type: "image/png" }),
    } as any);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      expect(ActiveTransfers.cancelActiveTransfer("h-test")).toBe(true);
      return "blob:from-data";
    });
    const state = makeState({
      info: { url: "data:image/png;base64,AAAA", suggestedFilename: "x.png" },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED");
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
    // The acquired blob is released and the preparation row retired, so the
    // options page cannot keep a stuck cancellable row or pin the keepalive.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:from-data");
    expect(state.info.abortSignal).toBeUndefined();
    expect(ActiveTransfers.cancelActiveTransfer("h-test")).toBe(false);
  });

  test("treats an invalid acquired URL as ineligible for HTTP fallback", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { url: "not a URL" } });
    const plan = Download.createDownloadPlan(state);

    await expect(
      Download.executeBrowserDownload(plan, { url: "not a URL", source: "direct" }),
    ).resolves.toEqual({ status: "started", downloadId: 101 });

    expect(downloadState.records.get(101)?.allowOriginalUrlFallback).toBe(false);
  });

  test("contains a browser rejection caused by cancellation", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(global.browser.downloads.download).mockImplementation(async () => {
      expect(ActiveTransfers.cancelActiveTransfer("h-test")).toBe(true);
      throw new Error("aborted by browser");
    });
    const state = makeState();

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED");
    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });

  test("does not fetch-retry a generated object URL after browser rejection", async () => {
    setCurrentBrowser("FIREFOX");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("generated content");
    const state = makeState({ info: { url, suggestedFilename: "generated.txt" } });
    vi.mocked(global.browser.downloads.download).mockRejectedValueOnce(new Error("disk full"));
    const fetchSpy = vi.mocked(global.fetch);

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalledWith(url, { credentials: "include" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test("stores _ as the recovery filename for an empty planned path", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(Path.sanitizeFilename).mockReturnValue(null as any);

    const state = makeState({ path: { finalize: () => null } });
    await Download.renameAndDownload(state);

    // the filename-map update stores "_" for this download's URL
    const fnameUpdate = vi
      .mocked(SessionState.updateSession)
      .mock.calls.find((call: any) => call[2] === "siFinalFilenames");
    expect(fnameUpdate![3]({})).toEqual({ [state.info.url]: "_" });
    const [downloadOptions] = vi.mocked(global.browser.downloads.download).mock.calls[0]!;
    expect(downloadOptions).not.toHaveProperty("filename");
  });

  test("emits downloaded, records lastDownloadState, and saves history", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(downloaded).toHaveBeenCalledWith(state);
    expect(backgroundRuntime.lastDownloadState).toBe(state);
    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        routed: false,
        initiatedAt: state.info.now?.toISOString(),
        info: expect.objectContaining({ sourceUrl: state.info.sourceUrl }),
        variables: expect.objectContaining({
          filename: "file.png",
          initialfilename: "file.png",
        }),
      }),
      { privateContext: false },
    );
  });

  test("keeps a source sidecar out of primary state and history", async () => {
    setCurrentBrowser("CHROME");
    const primary = makeState({ path: { finalize: () => "images" } });
    backgroundRuntime.lastDownloadState = primary;
    const sidecar = makeState({
      info: { context: DOWNLOAD_TYPES.SIDECAR },
    });

    await Download.renameAndDownload(sidecar);

    expect(backgroundRuntime.lastDownloadState).toBe(primary);
    expect(downloaded).not.toHaveBeenCalled();
    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(downloadState.records.get(101)).toMatchObject({
      adopted: true,
      sourceSidecar: true,
    });
    expect(downloadState.records.get(101)).not.toHaveProperty("historyEntryId");
    expect(Notifier.expectDownload).toHaveBeenCalledWith(
      sidecar.info.url,
      expect.objectContaining({ sourceSidecar: true }),
    );
  });

  test("persists sidecar intent with an unprompted primary download", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({
      scratch: {
        sourceSidecar: {
          sourceUrl: "https://example.com/source.png",
          pageUrl: "https://example.com/gallery/",
          title: "Gallery",
        },
      },
    });

    await Download.renameAndDownload(state);

    expect(downloadState.records.get(101)?.pendingSourceSidecar).toEqual({
      sourceUrl: "https://example.com/source.png",
      pageUrl: "https://example.com/gallery/",
      title: "Gallery",
    });
    expect(Notifier.expectDownload).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({
        pendingSourceSidecar: expect.objectContaining({
          sourceUrl: "https://example.com/source.png",
        }),
      }),
    );
  });

  test("does not persist sidecar intent when the primary opens Save As", async () => {
    setCurrentBrowser("CHROME");
    options.prompt = true;
    const state = makeState({
      scratch: { sourceSidecar: { sourceUrl: "https://example.com/source.png" } },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: true }),
    );
    expect(downloadState.records.get(101)).not.toHaveProperty("pendingSourceSidecar");
    expect(Notifier.expectDownload).toHaveBeenCalledWith(
      state.info.url,
      expect.not.objectContaining({ pendingSourceSidecar: expect.anything() }),
    );
  });

  test("does not surface a source-sidecar browser rejection", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    vi.mocked(global.browser.downloads.download).mockRejectedValue(new Error("disk full"));

    await expect(
      Download.renameAndDownload(makeState({ info: { context: DOWNLOAD_TYPES.SIDECAR } })),
    ).resolves.toEqual({ status: "failed" });

    expect(SaveHistory.addHistoryEntry).not.toHaveBeenCalled();
    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });
});

describe("renameAndDownload: notification triggers", () => {
  test("notifies on rule match when a route was found and notifyOnRuleMatch is enabled", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchedTitle",
      "file.png\n⬇\nmatched/route.txt",
      false,
      "route-match",
    );
  });

  test("does not notify on rule match when notifyOnRuleMatch is disabled", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = false;

    await Download.renameAndDownload(makeState());
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("does not emit one route notification per automatic source", async () => {
    setCurrentBrowser("CHROME");
    options.notifyOnRuleMatch = true;
    const state = makeState({
      info: { context: "AUTO" },
      scratch: { routeTemplateRaw: "automatic/" },
    });

    await Download.renameAndDownload(state);

    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("notifies failure when unmatched files are skipped and no route matched", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.notifyOnFailure = true;

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
      "route-miss",
    );
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("truncates a data URL in the unmatched-route notification", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.notifyOnFailure = true;
    const getMessage = vi.fn((key: string) => key);
    (global.browser.i18n as any).getMessage = getMessage;
    const url = `data:image/png;base64,${"A".repeat(4000)}`;

    await Download.renameAndDownload(makeState({ info: { url } }));

    expect(getMessage).toHaveBeenCalledWith("notificationRuleMatchFailedExclusiveMessage", [
      "data:image/png;base64,…",
    ]);
    expect(getMessage.mock.calls.flatMap((call) => call.slice(1)).join(" ")).not.toContain(url);
  });

  test("preserves a long HTTP URL in the unmatched-route notification", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.notifyOnFailure = true;
    const getMessage = vi.fn((key: string) => key);
    (global.browser.i18n as any).getMessage = getMessage;
    const url = `https://cdn.test/${"A".repeat(4000)}.png`;

    await Download.renameAndDownload(makeState({ info: { url } }));

    expect(getMessage).toHaveBeenCalledWith("notificationRuleMatchFailedExclusiveMessage", [url]);
  });

  test("does not notify failure when unmatched files are allowed", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = false;
    options.notifyOnFailure = true;

    await Download.renameAndDownload(makeState());
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("renameAndDownload: Log integration", () => {
  test("logs 'download requested' when Log is defined", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "download requested",
      expect.objectContaining({ url: expect.any(String), path: expect.any(String), route: null }),
    );
  });

  test("keeps an automatic data payload out of logs and the browser filename", async () => {
    setCurrentBrowser("CHROME");
    const marker = "TOP_SECRET_PAYLOAD";
    const url = `data:image/png;base64,${marker.repeat(300)}`;

    await Download.renameAndDownload(
      makeState({
        info: { url, context: "AUTO", suggestedFilename: "download", mime: "image/png" },
      }),
    );

    expect(JSON.stringify(vi.mocked(Log.addLogEntry).mock.calls)).not.toContain(marker);
    expect(JSON.stringify(vi.mocked(global.browser.downloads.download).mock.calls)).not.toContain(
      marker,
    );
  });

  test("does not throw when the download pipeline runs", async () => {
    setCurrentBrowser("CHROME");

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: backgroundRuntime.debug", () => {
  test("logs debug info when backgroundRuntime.debug is set", async () => {
    setCurrentBrowser("CHROME");
    backgroundRuntime.debug = true;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await Download.renameAndDownload(makeState());

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    backgroundRuntime.debug = false;
  });

  test("redacts automatic data payloads from debug console output", async () => {
    setCurrentBrowser("CHROME");
    backgroundRuntime.debug = true;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const marker = "TOP_SECRET_DEBUG_PAYLOAD";
    const url = `data:image/png;base64,${marker.repeat(100)}`;

    await Download.renameAndDownload(
      makeState({
        info: { url, sourceUrl: url, context: "AUTO", suggestedFilename: "download" },
      }),
    );

    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(marker);
    expect(consoleSpy).toHaveBeenCalledWith({
      context: "AUTO",
      url: "data:image/png;base64,…",
    });
    backgroundRuntime.debug = false;
  });
});

describe("onDeterminingFilename listener: sync path", () => {
  test("suggests the finalized path from the URL-correlated state", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    const returned = capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "from-download-item.bin",
      },
      suggest,
    );

    expect(returned).toBe(false);
    expect(suggest).toHaveBeenCalledWith({
      filename: Download.finalizeFullPath(state),
      conflictAction: options.conflictAction,
    });
  });

  test("prefers Chrome's HTTP filename over the initial suggestion", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "from-download-item.bin",
      },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/from-download-item.bin",
      conflictAction: "uniquify",
    });
    expect(SaveHistory.patchHistoryEntry).toHaveBeenCalledWith("h-test", {
      finalFullPath: "downloads/from-download-item.bin",
    });
  });

  test("reevaluates filename rules with Chrome's actual filename", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "server-name.pdf" ? "pdf/:filename:" : null,
    );
    const state = makeState({ path: new Path.Path("downloads") });
    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    const returned = capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name.pdf",
      },
      suggest,
    );
    expect(returned).toBe(true);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
      ),
    );
    await vi.waitFor(() =>
      expect(downloadState.records.get(101)?.filename).toBe("downloads/pdf/server-name.pdf"),
    );
  });

  test("defers an exclusive actual-filename rule until Chrome resolves the filename", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "server-name.pdf" ? "pdf/:filename:" : null,
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/download" },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });
    expect(state.scratch.deferredRouteRequirement).toBe(true);

    const suggest = vi.fn();
    expect(
      capturedListener(
        {
          id: 101,
          byExtensionId: global.browser.runtime.id,
          url: state.info.url,
          filename: "server-name.pdf",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
      ),
    );
  });

  test("defers finalfilename and matches Chrome's browser-resolved name", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("finalfilename")];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.resolvedFilename === "server-name.pdf" ? "pdf/:filename:" : null,
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: {
        url: "https://example.com/download",
        suggestedFilename: "suggested-name.txt",
      },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });
    expect(state.scratch.deferredRouteRequirement).toBe(true);

    const suggest = vi.fn();
    expect(
      capturedListener(
        {
          id: 101,
          byExtensionId: global.browser.runtime.id,
          url: state.info.url,
          filename: "server-name.pdf",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(router.matchRules).toHaveBeenCalledWith(
        options.filenamePatterns,
        expect.objectContaining({ resolvedFilename: "server-name.pdf" }),
        expect.anything(),
      ),
    );
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
      ),
    );
  });

  test("rechecks finalfilename even when Chrome keeps the pre-final name", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule("finalfilename"), routingRule("filename")];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.resolvedFilename === "server-name.pdf" ? "resolved/:filename:" : "fallback/:filename:",
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/server-name.pdf" },
    });

    await Download.renameAndDownload(state);
    expect(state.info.filename).toBe("server-name.pdf");

    const suggest = vi.fn();
    expect(
      capturedListener(
        {
          id: 101,
          byExtensionId: global.browser.runtime.id,
          url: state.info.url,
          filename: "server-name.pdf",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/resolved/server-name.pdf" }),
      ),
    );
  });

  test("resolves MIME only when Chrome's final filename loses its extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("application/pdf");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("pdf");
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename?.endsWith(".pdf") || info.mimeExtension === "pdf" ? "pdf/:filename:" : null,
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/file.pdf" },
    });

    await Download.renameAndDownload(state);
    expect(Variable.resolveMime).not.toHaveBeenCalled();

    const suggest = vi.fn();
    capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name",
      },
      suggest,
    );

    await vi.waitFor(() => expect(Variable.resolveMime).toHaveBeenCalledWith(state.info));
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
      ),
    );
  });

  // The persisted state carries an optional filename, so a record written by an
  // older version can come back without one. Recovering it against a download
  // Chrome also resolved namelessly leaves the MIME type as the only thing to
  // route on, rather than a name to test for an extension.
  test("resolves MIME when a recovered route and Chrome both have no filename", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("pdf");
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.mimeExtension === "pdf" ? "pdf/" : null,
    );
    let resolveDownload!: (downloadId: number) => void;
    global.browser.downloads.download = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/download" },
    });

    const launch = Download.renameAndDownload(state);
    await vi.waitFor(() => expect(sessionStore.siDeferredRoutes).toBeDefined());
    // An older record simply never stored the field.
    for (const entry of Object.values<any>(sessionStore.siDeferredRoutes))
      for (const record of [entry].flat()) delete record.state.info.filename;
    Download.downloadRuntime.pendingStates.clear();

    const suggest = vi.fn();
    capturedListener(
      { id: 101, byExtensionId: global.browser.runtime.id, url: state.info.url, filename: "" },
      suggest,
    );

    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ filename: "downloads/pdf" })),
    );
    resolveDownload(101);
    await launch;
  });

  test("re-evaluates an automatic destination with Chrome's server filename", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({
      path: new Path.Path("."),
      scratch: { routeTemplateRaw: "automatic/:filename:" },
      info: {
        context: "AUTO",
        pageUrl: "https://gallery.example/",
        url: "https://cdn.example/file.pdf",
      },
    });

    await Download.renameAndDownload(state);
    const suggest = vi.fn();
    expect(
      capturedListener(
        {
          id: 101,
          byExtensionId: global.browser.runtime.id,
          url: state.info.url,
          filename: "server-name.pdf",
        },
        suggest,
      ),
    ).toBe(true);

    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "automatic/server-name.pdf" }),
      ),
    );
    expect(router.matchRules).not.toHaveBeenCalled();
  });

  test("preserves deferred exclusive rejection across a service-worker restart", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "file.pdf" ? "pdf/:filename:" : null,
    );
    const cancel = vi.fn(() => Promise.resolve());
    global.browser.downloads.cancel = cancel;
    let resolveDownload!: (downloadId: number) => void;
    global.browser.downloads.download = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/file.pdf" },
    });

    const launch = Download.renameAndDownload(state);
    await vi.waitFor(() => expect(sessionStore.siDeferredRoutes).toBeDefined());
    Download.downloadRuntime.pendingStates.clear();

    const suggest = vi.fn();
    capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name.exe",
      },
      suggest,
    );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(101));
    expect(suggest).toHaveBeenCalledWith();
    resolveDownload(101);
    await expect(launch).resolves.toEqual({ status: "started", downloadId: 101 });
    await vi.waitFor(() => expect(sessionStore.siDeferredRoutes).toEqual({}));
  });

  test("recovers an automatic destination after a service-worker restart", async () => {
    setCurrentBrowser("CHROME");
    let resolveDownload!: (downloadId: number) => void;
    global.browser.downloads.download = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const state = makeState({
      path: new Path.Path("."),
      scratch: { routeTemplateRaw: "automatic/:filename:" },
      info: {
        context: "AUTO",
        pageUrl: "https://gallery.example/",
        url: "https://cdn.example/file.pdf",
      },
    });

    const launch = Download.renameAndDownload(state);
    await vi.waitFor(() => expect(sessionStore.siDeferredRoutes).toBeDefined());
    Download.downloadRuntime.pendingStates.clear();

    const suggest = vi.fn();
    capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name.pdf",
      },
      suggest,
    );

    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "automatic/server-name.pdf" }),
      ),
    );
    resolveDownload(101);
    await expect(launch).resolves.toEqual({ status: "started", downloadId: 101 });
    await vi.waitFor(() => expect(sessionStore.siDeferredRoutes).toEqual({}));
  });

  test.each([
    { label: "private state", incognito: true, persistedFilename: false },
    { label: "a legacy filename entry", incognito: false, persistedFilename: true },
  ])(
    "fails closed when exclusive routing has only $label",
    async ({ incognito, persistedFilename }) => {
      setCurrentBrowser("CHROME");
      options.routeSkipUnmatched = true;
      const url = "https://example.com/unrecoverable-download";
      if (persistedFilename) sessionStore.siFinalFilenames = { [url]: "downloads/server-name.exe" };
      const cancel = vi.fn(() => Promise.resolve());
      global.browser.downloads.cancel = cancel;

      const suggest = vi.fn();
      expect(
        capturedListener(
          {
            id: 101,
            byExtensionId: global.browser.runtime.id,
            url,
            filename: "server-name.exe",
            incognito,
          },
          suggest,
        ),
      ).toBe(true);

      await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(101));
      expect(suggest).toHaveBeenCalledWith();
      if (persistedFilename) {
        await vi.waitFor(() => expect(sessionStore.siFinalFilenames).toEqual({}));
      }
    },
  );

  test("cancels a deferred exclusive download when the resolved filename still misses", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.notifyOnFailure = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "file.pdf" ? "pdf/:filename:" : null,
    );
    const cancel = vi.fn(() => Promise.reject(new Error("already stopped")));
    global.browser.downloads.cancel = cancel;
    vi.mocked(SaveHistory.setHistoryStatus).mockRejectedValue(new Error("history unavailable"));
    const state = makeState({
      path: new Path.Path("downloads"),
      info: { url: "https://example.com/file.pdf" },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });

    const suggest = vi.fn();
    capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name.exe",
      },
      suggest,
    );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(101));
    expect(suggest).toHaveBeenCalledWith();
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "RULE_NO_MATCH", 101);
    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
      "route-miss",
    );
  });

  test("truncates a data URL in a deferred route-miss notification", async () => {
    setCurrentBrowser("CHROME");
    options.routeSkipUnmatched = true;
    options.notifyOnFailure = true;
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.mocked(router.matchRules).mockReturnValue(null);
    const getMessage = vi.fn((key: string) => key);
    (global.browser.i18n as any).getMessage = getMessage;
    const url = `data:image/png;base64,${"B".repeat(4000)}`;
    const state = makeState({ path: new Path.Path("downloads"), info: { url } });

    await Download.renameAndDownload(state);
    capturedListener(
      {
        id: 102,
        byExtensionId: global.browser.runtime.id,
        url,
        filename: "server-name.exe",
      },
      vi.fn(),
    );

    await vi.waitFor(() =>
      expect(getMessage).toHaveBeenCalledWith("notificationRuleMatchFailedExclusiveMessage", [
        "data:image/png;base64,…",
      ]),
    );
    expect(getMessage.mock.calls.flatMap((call) => call.slice(1)).join(" ")).not.toContain(url);
  });

  test("keeps the state's filename when the download item has none", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    capturedListener(
      { byExtensionId: global.browser.runtime.id, url: state.info.url, filename: undefined },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
  });

  test("recreates missing state info from the download item", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const url = state.info.url;
    // Clearing info simulates a queued state that lost its metadata before the event.
    delete state.info;

    const suggest = vi.fn();
    const returned = capturedListener(
      { byExtensionId: global.browser.runtime.id, url, filename: "item.bin" },
      suggest,
    );

    expect(returned).toBe(false);
    expect(state.info).toEqual({ filename: "item.bin", resolvedFilename: "item.bin" });
    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/item.bin",
      conflictAction: "uniquify",
    });
  });

  test("remembers a numeric download id on the synchronous filename path", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();
    await Download.renameAndDownload(state);
    const suggest = vi.fn();

    expect(
      capturedListener(
        {
          id: 202,
          byExtensionId: global.browser.runtime.id,
          url: state.info.url,
          filename: "file.png",
        },
        suggest,
      ),
    ).toBe(false);

    expect(Download.downloadRuntime.finalFilenamesByDownloadId.get(202)).toBe("downloads/file.png");
  });
});

describe("concurrent downloads (pendingStates)", () => {
  let concurrentDownload: any;
  let listener: any;

  beforeEach(async () => {
    vi.resetModules();
    setCurrentBrowser("CHROME");
    global.chrome = {
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    } as any;
    Object.assign(hostBrowser, {
      runtime: { id: "self-extension-id" },
      downloads: { download: vi.fn(() => Promise.resolve(1)) },
      // The file-level beforeEach of earlier describes touches these
      i18n: { getMessage: vi.fn((k: string) => k) },
      // No storage.session: SessionState.available() is false, so the real
      // session wrapper no-ops (these tests don't assert persistence)
      storage: { local: {} },
    } as any);
    global.browser = hostBrowser;

    // A fresh module graph (real deps at their defaults): filenamePatterns "" so
    // nothing routes, conflictAction "uniquify", and the identity-ish real Path.
    // Register onDeterminingFilename from this fresh instance before capture.
    const dl = await import("../../src/downloads/download.ts");
    const dlExecution = await import("../../src/downloads/download-execution.ts");
    const dlRuntimeInstance = await import("../../src/downloads/download-runtime-instance.ts");
    const { configureDownloadPorts: configureFreshDownloadPorts } =
      await import("../../src/downloads/ports.ts");
    const { backgroundRuntime: freshRuntime } = await import("../../src/background/runtime.ts");
    const freshHistory = await import("../../src/background/history.ts");
    const freshLog = await import("../../src/background/log.ts");
    configureFreshDownloadPorts({
      runtime: freshRuntime,
      history: {
        add: (...a: Parameters<typeof freshHistory.addHistoryEntry>) =>
          freshHistory.addHistoryEntry(...a),
        patch: (...a: Parameters<typeof freshHistory.patchHistoryEntry>) =>
          freshHistory.patchHistoryEntry(...a),
        setDownloadId: (...a: Parameters<typeof freshHistory.setHistoryDownloadId>) =>
          freshHistory.setHistoryDownloadId(...a),
        setStatus: (...a: Parameters<typeof freshHistory.setHistoryStatus>) =>
          freshHistory.setHistoryStatus(...a),
        entries: () => freshHistory.getHistoryEntries(),
        anchorStartTime: (...a: Parameters<typeof freshHistory.anchorHistoryDownloadStartTime>) =>
          freshHistory.anchorHistoryDownloadStartTime(...a),
      },
      log: {
        add: (...args: Parameters<typeof freshLog.addLogEntry>) => freshLog.addLogEntry(...args),
      },
      retry: dl.retryViaFetch,
      sourceSidecar: () => Promise.resolve(),
    });
    concurrentDownload = { ...dlExecution, ...dlRuntimeInstance, ...dl };
    dl.registerDownloadListener();
    [[listener]] = vi.mocked(
      (global.chrome as any).downloads.onDeterminingFilename.addListener,
    ).mock.calls;
  });

  const makeConcurrentState = (url: string, dir: string, name: string) => ({
    path: { finalize: () => dir },
    scratch: {},
    info: { url, suggestedFilename: name, pageUrl: `https://page/${dir}`, modifiers: [] },
  });

  test("overlapping downloads each resolve to their own filename", () => {
    // B starts before A's onDeterminingFilename fires: with a single global
    // slot, A would be suggested B's path
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/a.png", "dirA", "a.png"));
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/b.png", "dirB", "b.png"));

    const suggestA = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, suggestA);
    expect(suggestA).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirA/a.png" }));

    const suggestB = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/b.png" }, suggestB);
    expect(suggestB).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirB/b.png" }));
  });

  test("same-URL downloads are consumed in request order", () => {
    concurrentDownload.downloadRuntime.rememberPendingState(
      makeConcurrentState("https://x/same.png", "dirA", "a.png"),
    );
    concurrentDownload.downloadRuntime.rememberPendingState(
      makeConcurrentState("https://x/same.png", "dirB", "b.png"),
    );

    const suggestA = vi.fn();
    listener(
      { byExtensionId: "self-extension-id", url: "https://x/same.png", filename: "a.png" },
      suggestA,
    );
    expect(suggestA).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirA/a.png" }));

    const suggestB = vi.fn();
    listener(
      { byExtensionId: "self-extension-id", url: "https://x/same.png", filename: "b.png" },
      suggestB,
    );
    expect(suggestB).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirB/b.png" }));
  });

  test("consumed entries are removed and the map stays bounded", () => {
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/a.png", "dirA", "a.png"));
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, vi.fn());
    expect(concurrentDownload.downloadRuntime.pendingStates.has("https://x/a.png")).toBe(false);

    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.downloadRuntime.rememberPendingState(
        makeConcurrentState(`https://x/${i}.png`, "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.downloadRuntime.pendingStates.size).toBe(60);
  });

  test("bounds queued attempts even when every request uses the same URL", () => {
    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.downloadRuntime.rememberPendingState(
        makeConcurrentState("https://x/same.png", "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.downloadRuntime.pendingStates.get("https://x/same.png")?.length).toBe(
      60,
    );
  });
});

// A state without a URL makes the real renameAndDownload reject in planning
// (requireDownloadUrl); launchDownload's containment is exercised without
// stubbing same-module pipeline internals.
describe("launchDownload (fire-and-forget with a user-facing failure)", () => {
  test("swallows a pipeline rejection, logging and reporting it to the user", async () => {
    await expect(
      Download.launchDownload(makeState({ info: { suggestedFilename: "x.png", url: undefined } })),
    ).resolves.toEqual({ status: "failed" });

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "renameAndDownload failed",
      expect.stringContaining("Download URL is required"),
    );
    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      "x.png",
      expect.stringContaining("Download URL is required"),
    );
  });

  test("keeps a rejected source-sidecar launch quiet", async () => {
    await expect(
      Download.launchDownload(
        makeState({ info: { context: DOWNLOAD_TYPES.SIDECAR, url: undefined } }),
      ),
    ).resolves.toEqual({ status: "failed" });

    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });

  test("reports nothing on a successful pipeline run", async () => {
    const result = await Download.launchDownload(makeState());

    expect(result.status).toBe("started");
    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });

  test("keeps a private launch failure out of the shared log", async () => {
    await Download.launchDownload(
      makeState({
        info: { currentTab: { incognito: true }, suggestedFilename: undefined, url: undefined },
      }),
    );

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "renameAndDownload failed",
      expect.stringContaining("Download URL is required"),
      { privateContext: true },
    );
    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      "",
      expect.stringContaining("Download URL is required"),
    );
  });
});

describe("terminal browserDownload failure surfaces to the user", () => {
  test("reports a failure when downloads.download rejects and the fallback is off", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    await Download.renameAndDownload(makeState());

    expect(Notifier.reportDownloadFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("disk full"),
    );
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "DOWNLOAD_API_FAILED");
  });

  test("does not report a rule match after a terminal browser rejection", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    options.notifyOnRuleMatch = true;
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/file.png");
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("denied")));

    await Download.renameAndDownload(makeState());

    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("owned object URL lifecycle", () => {
  test("revokes an owned object URL when its browser download terminates", () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    Download.downloadRuntime.ownedObjectUrls.set(404, "blob:owned-download");

    capturedDownloadChangedListener({ id: 404, state: { current: "complete" } });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-download");
    expect(Download.downloadRuntime.ownedObjectUrls.has(404)).toBe(false);
  });

  test("ignores nonterminal changes and terminal changes without an object URL", () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    capturedDownloadChangedListener({ id: 1, state: { current: "in_progress" } });
    capturedDownloadChangedListener({ id: 2, error: { current: "NETWORK_FAILED" } });

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe("private browsing persistence", () => {
  test("keeps private save metadata out of local and session storage", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(SaveHistory.addHistoryEntry).mockReturnValue(null);
    const state = makeState({ info: { currentTab: { incognito: true } } });

    await Download.renameAndDownload(state);

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
    expect(sessionStore.siPendingDownloads).toBeUndefined();
    expect(sessionStore.siFinalFilenames).toBeUndefined();
    expect(sessionStore.siDownloads?.[101]).toBeUndefined();
    expect(downloadState.records.get(101)).toMatchObject({
      privateContext: true,
      adopted: true,
    });
    expect(SaveHistory.setHistoryDownloadId).not.toHaveBeenCalled();
    expect(Log.addLogEntry).not.toHaveBeenCalledWith("download requested", expect.anything());
    expect(downloaded).not.toHaveBeenCalled();
    expect(backgroundRuntime.lastDownloadState).toBeUndefined();
  });
});
