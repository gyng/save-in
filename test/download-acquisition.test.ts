// Focused acquisition coverage extracted from the pipeline suite.
import {
  ActiveTransfers,
  Download,
  getFilenameFromContentDispositionHeader,
  Log,
  makeState,
  OffscreenClient,
  options,
  router,
  routingRule,
  SaveHistory,
  setCurrentBrowser,
  Variable,
} from "./download-flow-fixture.ts";

describe("renameAndDownload: shared :sha256: fetch reuse", () => {
  test("cancels an in-progress content preparation from its History entry", async () => {
    vi.spyOn(Variable, "applyVariables").mockImplementationOnce((_path, info) => {
      if (!info) throw new Error("Expected download metadata");
      info.onContentFetchStart?.("request-test");
      return new Promise((_resolve, reject) => {
        info.abortSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Canceled", "AbortError")),
          { once: true },
        );
      });
    });
    const state = makeState();

    const task = Download.renameAndDownload(state);
    await vi.waitFor(() => expect(SaveHistory.add).toHaveBeenCalled());
    expect(ActiveTransfers.cancel("h-test")).toBe(true);

    await expect(task).resolves.toEqual({ status: "skipped" });
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED");
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("reuses the already-fetched download URL instead of fetching the file again", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({
      info: {
        contentPromise: Promise.resolve({
          downloadUrl: "data:application/octet-stream;base64,eA==",
        }),
      },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "data:application/octet-stream;base64,eA==" }),
    );
  });

  test("falls back to the normal download when the shared fetch failed (null content)", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { contentPromise: Promise.resolve(null) } });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });
});

describe("renameAndDownload: Chrome vs Firefox entry", () => {
  test("Chrome path skips the HEAD request and downloads immediately", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);
    expect(global.fetch).not.toHaveBeenCalled();

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.not.objectContaining({ filename: expect.anything() }),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });

  test("Firefox path performs a HEAD request and applies the Content-Disposition filename", async () => {
    setCurrentBrowser("FIREFOX");
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("server-name.pdf");
    global.fetch = vi.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="server-name.pdf"' },
      }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({
        method: "HEAD",
        credentials: "omit",
        redirect: "follow",
      }),
    );
    expect(getFilenameFromContentDispositionHeader).toHaveBeenCalledWith(
      'attachment; filename="server-name.pdf"',
      {
        allowQuotedExtendedValue: true,
        unescapeExtendedValueAgain: true,
      },
    );

    expect(state.info.filename).toBe("server-name.pdf");
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("server-name.pdf") }),
    );
  });

  test("Firefox routes an extensionless PHP download by its Content-Disposition name (#178)", async () => {
    setCurrentBrowser("FIREFOX");
    options.filenamePatterns = [routingRule("actualfileext")];
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("release.torrent");
    global.fetch = vi.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="release.torrent"' },
      }),
    ) as any;
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "release.torrent" ? "_torrents/:filename:" : null,
    );

    const state = makeState({ info: { url: "https://downloads.example/td.php?token=secret" } });
    await Download.renameAndDownload(state);

    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/_torrents/release.torrent" }),
    );
  });

  test("Firefox path keeps the original filename when the Content-Disposition has no usable name", async () => {
    setCurrentBrowser("FIREFOX");
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue(null as any);
    global.fetch = vi.fn(() =>
      Promise.resolve({ headers: { has: () => true, get: () => "attachment" } }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.info.filename).toBe("file.png");
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path keeps the original filename when Content-Disposition is absent", async () => {
    setCurrentBrowser("FIREFOX");
    global.fetch = vi.fn(() =>
      Promise.resolve({ headers: { has: () => false, get: () => null } }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.info.filename).toBe("file.png");
    expect(getFilenameFromContentDispositionHeader).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path downloads anyway when the HEAD request rejects", async () => {
    setCurrentBrowser("FIREFOX");
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: fetchViaFetch", () => {
  test("Chrome fetches a matching Referer-protected download through DNR and offscreen", async () => {
    setCurrentBrowser("CHROME");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    const updateRules = vi.mocked(global.chrome.declarativeNetRequest.updateSessionRules);
    updateRules.mockClear();
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetchContent;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetchContent = vi.fn(() =>
      Promise.resolve({
        sha256: "",
        downloadUrl: "blob:referer-protected",
        offscreenRequestId: "referer-r1",
      }),
    );
    try {
      const state = makeState({ info: { pageUrl: "https://gallery.example/view#private" } });
      await Download.renameAndDownload(state);

      expect(state.info.contentFetchDisabled).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(OffscreenClient.fetchContent).toHaveBeenCalledWith(
        state.info.url,
        "omit",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(updateRules).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          addRules: [
            expect.objectContaining({
              action: expect.objectContaining({
                requestHeaders: [
                  expect.objectContaining({ value: "https://gallery.example/view" }),
                ],
              }),
            }),
          ],
        }),
      );
      expect(updateRules).toHaveBeenLastCalledWith({
        removeRuleIds: [66_000_001],
      });
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: "blob:referer-protected" }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetchContent = origFetch;
    }
  });

  test("History cancellation aborts fetch acquisition before downloads.download", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    global.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          );
        }),
    ) as any;
    const state = makeState();

    const task = Download.renameAndDownload(state);
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(ActiveTransfers.cancel("h-test")).toBe(true);

    await expect(task).resolves.toEqual({ status: "skipped" });
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED");
  });
  test("keeps a fetched blob associated with Firefox private downloads", async () => {
    setCurrentBrowser("FIREFOX");
    options.fetchViaFetch = true;
    options.includeFetchCredentials = true;
    global.fetch = vi.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    ) as any;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fetched-content");

    const state = makeState({
      info: { currentTab: { incognito: true, cookieStoreId: "firefox-private" } },
    });
    await Download.renameAndDownload(state);

    const [downloadOptions] = vi.mocked(global.browser.downloads.download).mock.calls[0]!;
    expect(downloadOptions).toHaveProperty("incognito", true);
    expect(downloadOptions).not.toHaveProperty("cookieStoreId");
    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
  });

  test("fetches the URL, converts the blob to an object URL, then downloads it", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    global.fetch = vi.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    ) as any;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fetched-content");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
    expect(Log.add).not.toHaveBeenCalledWith("fetch download failed", expect.anything());
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^blob:/) }),
    );
  });

  test("Chrome offscreen: fetches via the offscreen document and downloads the blob URL", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetchContent;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetchContent = vi.fn(() =>
      Promise.resolve({ sha256: "", downloadUrl: "blob:offscreen-url", offscreenRequestId: "r1" }),
    );
    try {
      const state = makeState();
      await Download.renameAndDownload(state);

      expect(OffscreenClient.fetchContent).toHaveBeenCalledWith(
        state.info.url,
        "omit",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: "blob:offscreen-url" }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetchContent = origFetch;
    }
  });

  test("Chrome offscreen: omits credentials for private fetches even when enabled", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    options.includeFetchCredentials = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetchContent;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetchContent = vi.fn(() =>
      Promise.resolve({ sha256: "", downloadUrl: "blob:private-offscreen-url" }),
    );
    try {
      const state = makeState({ info: { currentTab: { incognito: true } } });
      await Download.renameAndDownload(state);

      expect(OffscreenClient.fetchContent).toHaveBeenCalledWith(
        state.info.url,
        "omit",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetchContent = origFetch;
    }
  });

  test("Chrome offscreen: falls back to a direct download when the offscreen fetch fails", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetchContent;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetchContent = vi.fn(() => Promise.reject(new Error("offscreen boom")));
    try {
      const state = makeState();
      await Download.renameAndDownload(state);

      expect(Log.add).toHaveBeenCalledWith(
        "offscreen fetch failed",
        expect.stringContaining("offscreen boom"),
      );
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: state.info.url }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetchContent = origFetch;
    }
  });
});
