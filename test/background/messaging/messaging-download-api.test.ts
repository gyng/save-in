import {
  MESSAGE_TYPES,
  DOWNLOAD_TYPES,
  Download,
  Path,
  backgroundRuntime,
  Log,
  onMessage,
  onMessageExternal,
  trackedTab,
  setupGlobals,
  waitForCall,
} from "./messaging.fixture.ts";
import { parseRulesCollecting } from "../../../src/routing/rule-parser.ts";
import { options } from "../../../src/config/options-data.ts";
import * as DownloadDisposition from "../../../src/downloads/download-disposition.ts";

beforeEach(() => setupGlobals());

describe("handleDownloadMessage", () => {
  const request = (overrides = {}) => ({
    type: MESSAGE_TYPES.DOWNLOAD,
    body: Object.assign(
      {
        url: "https://x/file.png",
        info: { pageUrl: "https://x/", srcUrl: "https://x/file.png" },
      },
      overrides,
    ),
  });

  test("tolerates an external message with no info object", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { url: "https://x/file.png" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("rejects an omitted body as a missing URL", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.DOWNLOAD }, {}, sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "BAD_REQUEST",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("downloads with defaults when no previous download state exists", async () => {
    const sendResponse = vi.fn();
    expect(onMessage(request(), {}, sendResponse)).toBe(true);

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("keeps the message channel alive until the browser accepts the download", async () => {
    let finish!: (value: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.launchDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sendResponse = vi.fn();

    expect(onMessage(request(), {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish({ status: "started", downloadId: 7 });
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("acknowledges the primary media save without waiting for its deferred sidecar", async () => {
    options.saveSourceSidecar = true;
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://x/",
            srcUrl: "https://x/file.png",
            sourceKind: "image",
          },
        }),
        { id: global.browser.runtime.id },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.scratch.sourceSidecar).toEqual({
      sourceUrl: "https://x/file.png",
      pageUrl: "https://x/",
      title: "Tracked Tab",
    });
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  test("never writes a source sidecar for a private source-panel save", async () => {
    options.saveSourceSidecar = true;
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://private.example/gallery/",
            srcUrl: "https://x/private-file.png",
            sourceKind: "image",
          },
        }),
        {
          id: global.browser.runtime.id,
          tab: { id: 8, title: "Private gallery", incognito: true },
        },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("defers sidecar preparation until after the accepted primary save completes", async () => {
    options.saveSourceSidecar = true;
    const finalize = vi.spyOn(DownloadDisposition, "finalizeFullPath");
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://x/",
            srcUrl: "https://x/file.png",
            sourceKind: "image",
          },
        }),
        { id: global.browser.runtime.id },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(finalize).not.toHaveBeenCalled();
    expect(Log.addLogEntry).not.toHaveBeenCalledWith("source sidecar failed", expect.anything());
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  test("preserves a caller-supplied suggested filename", () => {
    onMessage(
      request({ info: { pageUrl: "https://x/", suggestedFilename: "caller-name.png" } }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.suggestedFilename).toBe("caller-name.png");
  });

  test("preserves source metadata supplied by an integration", () => {
    onMessage(
      request({
        info: {
          srcUrl: "https://x/file.png",
          mime: "image/png",
          mediaType: "image",
          sourceKind: "image",
        },
      }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info).toMatchObject({
      mime: "image/png",
      mediaType: "image",
      sourceKind: "image",
    });
  });

  test("reuses the last path and routing metadata, never filenames or routes", () => {
    const lastPath = new Path("images/cats");
    backgroundRuntime.lastDownloadState = {
      path: lastPath,
      scratch: { hasExtension: true },
      route: new Path("stale/route/from/other.png"),
      info: {
        comment: "0last",
        menuIndex: "1",
        suggestedFilename: "previous-download.png",
        filename: "previous-download.png",
      },
    };

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toBe(lastPath);
    // Inheriting the previous route, filename, or scratch would name this
    // download after the previous one (found live by the alt+click e2e)
    expect(state).not.toHaveProperty("route");
    expect(state.info.suggestedFilename).toBeUndefined();
    expect(state.info.filename).toBeUndefined();
    expect(state.scratch).toEqual({});
    // Routing metadata is kept so comment/menuindex rules stay usable
    expect(state.info.menuIndex).toBe("1");
    expect(state.info.comment).toBe("0last");
    expect(state.info.url).toBe("https://x/file.png");
  });

  test("falls back to the default path when the last state has none", () => {
    backgroundRuntime.lastDownloadState = { scratch: {}, info: {} } as any;

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBe("from-foxy-gestures");
  });

  test("does not let external info override pipeline-owned fields", () => {
    onMessage(
      request({
        info: {
          pageUrl: "https://x/",
          context: "forged",
          url: "javascript:forged",
          currentTab: { id: 99 },
        },
      }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("external downloads wait for cold-start initialization", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });
});

describe("automatic page-source downloads", () => {
  const request = {
    type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
    body: {
      pageUrl: "https://example.test/gallery/",
      sourceUrl: "https://cdn.test/original/cat.png",
      sourceKind: "image" as const,
    },
  };
  const configure = () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
sourceurl: /original/
into: automatic/:pagedomain:/
`).rules;
  };

  test("revalidates a candidate and launches it with the matching destination", async () => {
    configure();
    const sendResponse = vi.fn();
    const senderTab = {
      id: 7,
      url: "https://example.test/gallery/",
      title: "Gallery",
      incognito: false,
    };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    expect(Download.launchDownload).toHaveBeenCalledOnce();
    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.scratch.routeTemplateRaw).toBe("automatic/:pagedomain:/");
    expect(state.info).toMatchObject({
      currentTab: senderTab,
      context: DOWNLOAD_TYPES.AUTO,
      pageUrl: senderTab.url,
      sourceUrl: request.body.sourceUrl,
      sourceKind: "image",
      url: request.body.sourceUrl,
    });
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "started" },
    });
  });

  test("passes a matched rule's fetch template through to the launch scratch", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: ^https://cdn\\.test/original/([\\w.]+)$
capturegroups: sourceurl
fetch: https://cdn.test/full/:$1:
into: automatic/:$1:
`).rules;
    const sendResponse = vi.fn();
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.scratch.routeTemplateRaw).toBe("automatic/cat.png");
    expect(state.scratch.fetchTemplateRaw).toBe("https://cdn.test/full/cat.png");
  });

  test.each([
    ["the feature is disabled", () => (options.autoDownloadEnabled = false)],
    ["no rule matches", () => (options.filenamePatterns = [])],
    ["stored rules are malformed", () => (options.filenamePatterns = null as any)],
    ["the sender is private", () => undefined],
  ])("skips when %s", async (_label, arrange) => {
    configure();
    arrange();
    const sendResponse = vi.fn();
    const privateTab = _label === "the sender is private";
    onMessage(
      request,
      { tab: { id: 7, url: request.body.pageUrl, incognito: privateTab } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test.each(["not a URL", "ftp://cdn.test/file.png"])(
    "skips a non-HTTP source URL: %s",
    async (sourceUrl) => {
      configure();
      const sendResponse = vi.fn();
      onMessage(
        { ...request, body: { ...request.body, sourceUrl } },
        { tab: { id: 7, url: request.body.pageUrl } },
        sendResponse,
      );

      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    },
  );

  test("backstops a stale content script on a disabled site", async () => {
    configure();
    // The sender-tab page matches the per-site disable list, so a save request
    // from a content script that has not yet torn down must be refused.
    options.perSiteDisableList = "*://example.test/*";
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test("a malformed stored disable list never blocks automatic saves", async () => {
    configure();
    // Legacy or corrupted storage can hold a non-string here; the backstop must
    // fall back to "nothing disabled" rather than guessing a match.
    options.perSiteDisableList = ["*://example.test/*"] as unknown as string;
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
  });

  test("allows private automatic saves only when explicitly enabled", async () => {
    configure();
    options.autoDownloadPrivate = true;
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: request.body.pageUrl, incognito: true } },
      sendResponse,
    );
    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
  });

  describe("phase-B channel backstop", () => {
    // No sourcekind restriction: isolates the channel/kind gate from rule
    // matching, exactly like the content-side discovery-boundary fixtures.
    const configureBroad = () => {
      options.autoDownloadEnabled = true;
      options.autoDownloadPrivate = false;
      // options is a shared singleton across tests in this file; a prior row's
      // "then allows it" mutation must not leak into the next row's refusal.
      options.autoDownloadLinks = false;
      options.autoDownloadDocuments = false;
      options.autoDownloadBackgrounds = false;
      options.autoDownloadManifests = false;
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: cdn\\.test
into: automatic/:pagedomain:/
`).rules;
    };
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };
    const channelRequest = (sourceKind: string, sourceChannel: string) => ({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: {
        pageUrl: senderTab.url,
        sourceUrl: "https://cdn.test/candidate",
        sourceKind,
        sourceChannel,
      },
    });

    test.each([
      ["document", "anchor", "autoDownloadDocuments"],
      ["stream", "anchor", "autoDownloadDocuments"],
      ["image", "background", "autoDownloadBackgrounds"],
      ["stream", "resource-hint", "autoDownloadManifests"],
    ] as const)(
      "refuses a stale %s/%s candidate until %s is on, then allows it",
      async (sourceKind, sourceChannel, optionName) => {
        configureBroad();
        const refused = vi.fn();
        onMessage(channelRequest(sourceKind, sourceChannel), { tab: senderTab }, refused);
        await waitForCall(refused);
        expect(Download.launchDownload).not.toHaveBeenCalled();
        expect(refused).toHaveBeenCalledWith({
          type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
          body: { status: "skipped" },
        });

        (options as unknown as Record<string, boolean>)[optionName] = true;
        const allowed = vi.fn();
        onMessage(channelRequest(sourceKind, sourceChannel), { tab: senderTab }, allowed);
        await waitForCall(allowed);
        expect(Download.launchDownload).toHaveBeenCalledOnce();
      },
    );

    test("a .m3u8 anchor is not adopted merely because the manifests option is on", async () => {
      configureBroad();
      options.autoDownloadManifests = true;
      const sendResponse = vi.fn();
      onMessage(channelRequest("stream", "anchor"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("a resource-hint stream is not adopted merely because linked documents/streams is on", async () => {
      configureBroad();
      options.autoDownloadDocuments = true;
      const sendResponse = vi.fn();
      onMessage(channelRequest("stream", "resource-hint"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("a malformed stored channel option never blocks embedded media", async () => {
      configure();
      // Legacy or corrupted storage can hold a non-boolean here; the backstop
      // must fall back to "channel off" without throwing, and embedded media
      // (no sourceChannel) is unaffected either way.
      options.autoDownloadDocuments = "yes" as unknown as boolean;
      const sendResponse = vi.fn();
      onMessage(
        request,
        { tab: { id: 7, url: request.body.pageUrl, incognito: false } },
        sendResponse,
      );
      await waitForCall(sendResponse);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
    });
  });

  describe("phase-C data: backstop", () => {
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };
    const configureData = (sourcePattern = "^data:image/") => {
      options.autoDownloadEnabled = true;
      options.autoDownloadPrivate = false;
      options.autoDownloadDataUrls = false;
      options.perSiteDisableList = "";
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
sourceurl: ${sourcePattern}
into: automatic/
`).rules;
    };
    const dataRequest = (sourceUrl: string) => ({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: senderTab.url, sourceUrl, sourceKind: "image" as const },
    });

    test("refuses a data: source until the option is on, then launches it with the parsed mime", async () => {
      configureData();
      const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
      const refused = vi.fn();
      onMessage(dataRequest(dataUrl), { tab: senderTab }, refused);
      await waitForCall(refused);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });

      options.autoDownloadDataUrls = true;
      const allowed = vi.fn();
      onMessage(dataRequest(dataUrl), { tab: senderTab }, allowed);
      await waitForCall(allowed);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
      // The mediatype is parsed on the trusted side from the URL header, so
      // mime-based matching and :mimeext: naming resolve without a HEAD fetch.
      expect(state.info.mime).toBe("image/png");
      expect(state.info.url).toBe(dataUrl);
      expect(state.info.context).toBe(DOWNLOAD_TYPES.AUTO);
    });

    test("treats a data: URL with no parseable mediatype as application/octet-stream", async () => {
      configureData("^data:");
      options.autoDownloadDataUrls = true;
      const sendResponse = vi.fn();
      onMessage(dataRequest("data:;base64,SGVsbG8="), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.mime).toBe(
        "application/octet-stream",
      );
    });

    test("rejects an oversize data: source, logging one debug entry and never launching", async () => {
      configureData();
      options.autoDownloadDataUrls = true;
      const oversize = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024 + 10)}`;
      const sendResponse = vi.fn();
      onMessage(dataRequest(oversize), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(Log.addLogEntry).toHaveBeenCalledWith(
        "automatic data: source rejected: exceeds size cap",
        { length: oversize.length },
        { privateContext: false },
      );
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("never adopts a blob: source, even with the data: option on", async () => {
      configureData("^blob:");
      options.autoDownloadDataUrls = true;
      const sendResponse = vi.fn();
      onMessage(dataRequest("blob:https://example.test/2b8c"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });
  });
});

// Official versioned external API (#110)
