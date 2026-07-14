// Focused execution coverage extracted from the pipeline suite.
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

  test("contains a downloads.download rejection and clears pending state", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    // a fully failed download registers no adopted record
    expect([...downloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    expect(Log.add).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
    expect([...Download.pendingStates.values()].flat()).not.toContain(state);
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

    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      state.info.url,
      expect.stringContaining("disk full"),
    );
  });

  test("cancels a browser download when preparation is aborted as it starts", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(global.browser.downloads.cancel).mockRejectedValue(new Error("already stopped"));
    vi.mocked(global.browser.downloads.download).mockImplementation(async () => {
      expect(ActiveTransfers.cancel("h-test")).toBe(true);
      return 101;
    });
    const state = makeState();

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(101);
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED", 101);
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
      expect(ActiveTransfers.cancel("h-test")).toBe(true);
      throw new Error("aborted by browser");
    });
    const state = makeState();

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED");
    expect(Notifier.reportFailure).not.toHaveBeenCalled();
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
    expect(SaveHistory.add).toHaveBeenCalledWith(
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

    expect(Log.add).toHaveBeenCalledWith(
      "download requested",
      expect.objectContaining({ url: expect.any(String), path: expect.any(String), route: null }),
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
    expect(SaveHistory.patch).toHaveBeenCalledWith("h-test", {
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
    Download.pendingStates.clear();

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
    Download.pendingStates.clear();

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
    vi.mocked(SaveHistory.setStatus).mockRejectedValue(new Error("history unavailable"));
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
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "RULE_NO_MATCH", 101);
    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
      "route-miss",
    );
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
    expect(state.info).toEqual({ filename: "item.bin" });
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

    expect(Download.finalFilenamesByDownloadId.get(202)).toBe("downloads/file.png");
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
    const { configureDownloadPorts: configureFreshDownloadPorts } =
      await import("../../src/downloads/ports.ts");
    const { backgroundRuntime: freshRuntime } = await import("../../src/background/runtime.ts");
    const { SaveHistory: freshHistory } = await import("../../src/background/history.ts");
    const { Log: freshLog } = await import("../../src/background/log.ts");
    configureFreshDownloadPorts({
      runtime: freshRuntime,
      history: freshHistory,
      log: freshLog,
      retry: dl.Download.retryViaFetch,
    });
    concurrentDownload = dl.Download;
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
    concurrentDownload.rememberPendingState(
      makeConcurrentState("https://x/same.png", "dirA", "a.png"),
    );
    concurrentDownload.rememberPendingState(
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
    expect(concurrentDownload.pendingStates.has("https://x/a.png")).toBe(false);

    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.rememberPendingState(
        makeConcurrentState(`https://x/${i}.png`, "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.pendingStates.size).toBe(60);
  });

  test("bounds queued attempts even when every request uses the same URL", () => {
    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.rememberPendingState(
        makeConcurrentState("https://x/same.png", "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.pendingStates.get("https://x/same.png")?.length).toBe(60);
  });
});

describe("Download.launch (fire-and-forget with a user-facing failure)", () => {
  test("swallows a pipeline rejection, logging and reporting it to the user", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = vi.fn(() => Promise.reject(new Error("kaboom")));
    try {
      await expect(
        Download.launch(makeState({ info: { suggestedFilename: "x.png" } })),
      ).resolves.toEqual({ status: "failed" });

      expect(Log.add).toHaveBeenCalledWith(
        "renameAndDownload failed",
        expect.stringContaining("kaboom"),
      );
      expect(Notifier.reportFailure).toHaveBeenCalledWith(
        "x.png",
        expect.stringContaining("kaboom"),
      );
    } finally {
      Download.renameAndDownload = orig;
    }
  });

  test("reports nothing on a successful pipeline run", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = vi.fn(() =>
      Promise.resolve({ status: "started" as const, downloadId: 1 }),
    );
    try {
      await Download.launch(makeState());
      expect(Notifier.reportFailure).not.toHaveBeenCalled();
    } finally {
      Download.renameAndDownload = orig;
    }
  });

  test("keeps a private launch failure out of the shared log", async () => {
    vi.spyOn(Download, "renameAndDownload").mockRejectedValue(new Error("private failure"));

    await Download.launch(
      makeState({
        info: { currentTab: { incognito: true }, suggestedFilename: undefined, url: undefined },
      }),
    );

    expect(Log.add).toHaveBeenCalledWith(
      "renameAndDownload failed",
      expect.stringContaining("private failure"),
      { privateContext: true },
    );
    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      "",
      expect.stringContaining("private failure"),
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

    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("disk full"),
    );
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "DOWNLOAD_API_FAILED");
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
    Download.ownedObjectUrls.set(404, "blob:owned-download");

    capturedDownloadChangedListener({ id: 404, state: { current: "complete" } });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-download");
    expect(Download.ownedObjectUrls.has(404)).toBe(false);
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
    vi.mocked(SaveHistory.add).mockReturnValue(null);
    const state = makeState({ info: { currentTab: { incognito: true } } });

    await Download.renameAndDownload(state);

    expect(SaveHistory.add).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
    expect(sessionStore.siPendingDownloads).toBeUndefined();
    expect(sessionStore.siFinalFilenames).toBeUndefined();
    expect(sessionStore.siDownloads?.[101]).toBeUndefined();
    expect(downloadState.records.get(101)).toMatchObject({
      privateContext: true,
      adopted: true,
    });
    expect(SaveHistory.setDownloadId).not.toHaveBeenCalled();
    expect(Log.add).not.toHaveBeenCalledWith("download requested", expect.anything());
    expect(downloaded).not.toHaveBeenCalled();
    expect(backgroundRuntime.lastDownloadState).toBeUndefined();
  });
});
