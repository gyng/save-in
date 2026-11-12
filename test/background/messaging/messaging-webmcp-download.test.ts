import {
  MESSAGE_TYPES,
  Download,
  Messaging,
  onMessage,
  onMessageExternal,
  setCurrentTab,
  setupGlobals,
  waitForCall,
} from "./messaging.fixture.ts";
import { options } from "../../../src/config/options-data.ts";

beforeEach(setupGlobals);

// The WebMCP tool sends DOWNLOAD from the options page, which opens in a tab,
// so the browser reports Save In's own settings tab as the sender tab.
describe("WebMCP download requests", () => {
  const optionsUrl = "moz-extension://save-in-test/src/options.html";
  const optionsPage = () => ({
    id: global.browser.runtime.id,
    url: optionsUrl,
    frameId: 0,
    tab: { id: 5, title: "Save In settings", url: optionsUrl },
  });
  const webMcpBody = (body: Record<string, unknown> = {}) => ({
    url: "https://x/file.png",
    info: { pageUrl: "https://x/", srcUrl: "https://x/file.png", sourceKind: "image" },
    source: "webmcp",
    ...body,
  });
  const webMcpRequest = (body: Record<string, unknown> = {}) => ({
    type: MESSAGE_TYPES.DOWNLOAD,
    body: webMcpBody(body),
  });
  const badRequest = {
    type: MESSAGE_TYPES.DOWNLOAD,
    body: {
      status: MESSAGE_TYPES.ERROR,
      error: "BAD_REQUEST",
      message: expect.any(String),
      version: 1,
    },
  };

  test("does not treat the options tab as the page being saved", async () => {
    options.saveSourceSidecar = true;
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(onMessage(webMcpRequest(), optionsPage(), sendResponse)).toBe(true);
    await waitForCall(sendResponse);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    // Neither the settings tab nor the ambient tracked tab names the page.
    expect(state.info.currentTab).toBeNull();
    expect(state.info.webhookEligible).toBe(false);
    expect(state.scratch.sourceSidecar).toBeUndefined();
    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("keeps an unmarked save from Save In's own page tied to its sender tab", async () => {
    const sendResponse = vi.fn();
    const body = webMcpBody({ source: undefined });

    expect(onMessage({ type: MESSAGE_TYPES.DOWNLOAD, body }, optionsPage(), sendResponse)).toBe(
      true,
    );
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toMatchObject({ title: "Save In settings" });
    expect(state.info.webhookEligible).toBe(true);
  });

  test.each([
    [
      "a content script",
      { id: "save-in-test", url: "https://x/", tab: { id: 9, url: "https://x/" } },
    ],
    ["another extension's page", { id: "other", url: "moz-extension://other/page.html" }],
    ["a sender without a URL", { id: "save-in-test" }],
  ])("refuses the WebMCP marker from %s", (_label, sender) => {
    const sendResponse = vi.fn();

    onMessage(webMcpRequest({ version: 1 }), sender, sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(badRequest);
  });

  test("refuses the WebMCP marker from an external caller, even an allowed one", () => {
    // The marker withdraws the ambient tab, and with it the private marker a
    // save made while a private window has focus must keep.
    const sendResponse = vi.fn();

    onMessageExternal(webMcpRequest(), { id: "trusted-extension" }, sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(badRequest);
  });

  test("ignores any other source value, as unknown keys always were", async () => {
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(
        webMcpRequest({ source: "my-extension" }),
        { id: "trusted-extension" },
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

  test("never lets the marker shed an external caller's private marker", async () => {
    setCurrentTab({ id: 3, title: "Private page", incognito: true });
    const sendResponse = vi.fn();

    await Messaging.handleDownloadMessage(
      { type: MESSAGE_TYPES.DOWNLOAD, body: webMcpBody() } as never,
      { id: "trusted-extension" },
      sendResponse,
      false,
      true,
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toEqual({ incognito: true });
  });

  test("resolves a marked activeTab request from the browser, not the options tab", async () => {
    vi.mocked(global.browser.tabs.query).mockResolvedValue([
      { id: 42, url: "https://active.example/", title: "Active" } as browser.tabs.Tab,
    ]);
    const sendResponse = vi.fn();

    expect(
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { target: "activeTab", source: "webmcp" } },
        optionsPage(),
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.url).toBe("https://active.example/");
    expect(state.info.currentTab).toMatchObject({ id: 42 });
  });
});
