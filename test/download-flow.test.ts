// End-to-end smoke coverage for the explicit resolve/acquire/download pipeline.
import {
  capturedListener,
  Download,
  downloadState,
  makeState,
  Notifier,
  options,
  SaveHistory,
  setCurrentBrowser,
} from "./download-flow-fixture.ts";

describe("pipeline stages", () => {
  test("marks saves from an incognito tab as private at the history boundary", () => {
    const state = makeState({ info: { currentTab: { incognito: true } } });

    Download.createDownloadPlan(state);

    expect(SaveHistory.add).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
  });

  test("runs RESOLVE, ACQUIRE, and DOWNLOAD in order with explicit values", async () => {
    const calls: string[] = [];
    const state = makeState();
    const plan = {
      state,
      finalFullPath: "downloads/file.png",
      prompt: false,
      historyEntryId: "h-test",
    };
    const acquired = {
      url: "blob:resolved",
      source: "fetched" as const,
      ownedObjectUrl: "blob:resolved",
    };

    vi.spyOn(Download, "resolveDownloadPlan").mockImplementation(async () => {
      calls.push("resolve");
      return plan;
    });
    vi.spyOn(Download, "acquireDownloadUrl").mockImplementation(async (received) => {
      calls.push("acquire");
      expect(received).toBe(plan);
      return acquired;
    });
    vi.spyOn(Download, "executeBrowserDownload").mockImplementation(
      async (receivedPlan, receivedAcquired) => {
        calls.push("download");
        expect(receivedPlan).toBe(plan);
        expect(receivedAcquired).toBe(acquired);
        return { status: "started", downloadId: 101 };
      },
    );

    await Download.renameAndDownload(state);

    expect(calls).toEqual(["resolve", "acquire", "download"]);
  });

  test("reports and cleans up a rejected acquisition", async () => {
    const state = makeState({
      info: { contentPromise: Promise.reject(new Error("content unavailable")) },
    });

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "failed" });
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(Download.pendingStates.get(state.info.url) || []).not.toContain(state);
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "DOWNLOAD_PREPARATION_FAILED");
    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      "downloads/file.png",
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

  test("preserves Firefox Referer when extension fetch falls back to the original URL", async () => {
    setCurrentBrowser("FIREFOX");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    options.fetchViaFetch = true;
    const state = makeState({ info: { pageUrl: "https://gallery.example/view" } });
    global.fetch = vi.fn((url, init) => {
      if ((init as RequestInit | undefined)?.method === "HEAD") {
        return Promise.resolve({ headers: { has: () => false, get: () => null } });
      }
      return Promise.reject(new Error(`fetch blocked: ${url}`));
    }) as any;

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "started", downloadId: 101 });
    expect(global.fetch).not.toHaveBeenCalled();
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
    Download.rememberPendingState(state);
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

    expect(SaveHistory.patch).toHaveBeenCalledWith("h-test", {
      mechanism: "fetch-downloads-api",
    });

    expect(Download.pendingStates.get(state.info.url)).toBeUndefined();
    expect(Download.pendingStates.get("blob:fetched-file")).toEqual([state]);

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
