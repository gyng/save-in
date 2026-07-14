import {
  MESSAGE_TYPES,
  DOWNLOAD_TYPES,
  Download,
  Path,
  backgroundRuntime,
  onMessage,
  onMessageExternal,
  trackedTab,
  setupGlobals,
} from "./messaging-fixture.ts";
import { parseRulesCollecting } from "../src/routing/rule-parser.ts";
import { options } from "../src/config/options-data.ts";

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
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("downloads with defaults when no previous download state exists", async () => {
    const sendResponse = vi.fn();
    expect(onMessage(request(), {}, sendResponse)).toBe(true);

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("keeps the message channel alive until the browser accepts the download", async () => {
    let finish!: (value: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.renameAndDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sendResponse = vi.fn();

    expect(onMessage(request(), {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish({ status: "started", downloadId: 7 });
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("preserves a caller-supplied suggested filename", () => {
    onMessage(
      request({ info: { pageUrl: "https://x/", suggestedFilename: "caller-name.png" } }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
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
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(Download.renameAndDownload).toHaveBeenCalledOnce();
    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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

  test.each([
    ["the feature is disabled", () => (options.autoDownloadEnabled = false)],
    ["no rule matches", () => (options.filenamePatterns = [])],
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

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Download.renameAndDownload).toHaveBeenCalledOnce();
  });
});

// Official versioned external API (#110)
