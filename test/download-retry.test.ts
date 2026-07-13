// Focused retry coverage extracted from the pipeline suite.
import {
  Download,
  downloadState,
  Log,
  makeState,
  options,
  sessionStore,
  setCurrentBrowser,
} from "./download-flow-fixture.ts";

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
    expect(Log.add).toHaveBeenCalledWith("fetch download failed", "Error: HTTP 503");
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
