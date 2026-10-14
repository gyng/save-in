import {
  MESSAGE_TYPES,
  Messaging,
  options,
  Download,
  Notifier,
  ExternalDownloadRejections,
  onMessage,
  onMessageExternal,
  setupGlobals,
  trackedTab,
  waitForCall,
} from "./messaging.fixture.ts";
import { setCurrentTab } from "../../../src/platform/current-tab.ts";

beforeEach(() => setupGlobals());

describe("external DOWNLOAD API v1", () => {
  const download = (body: Record<string, any>) => ({ type: MESSAGE_TYPES.DOWNLOAD, body });

  test("PING returns the version and capabilities on both listeners", () => {
    for (const listener of [onMessageExternal, onMessage]) {
      const sendResponse = vi.fn();
      listener({ type: MESSAGE_TYPES.PING }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.PONG,
        body: { version: 1, capabilities: expect.arrayContaining(["download", "ping"]) },
      });
    }
  });

  test("echoes a caller-supplied version back", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        download({ url: "https://x/f.png", version: 1 }),
        { id: "trusted-extension" },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/f.png" },
    });
  });

  test("rejects a missing url with BAD_REQUEST and does not download", () => {
    const sendResponse = vi.fn();
    onMessageExternal(download({ info: {} }), { id: "trusted-extension" }, sendResponse);
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

  test("rejects an unfetchable scheme with INVALID_URL", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      download({ url: "javascript:alert(1)" }),
      { id: "trusted-extension" },
      sendResponse,
    );
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INVALID_URL",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("isValidDownloadUrl accepts fetchable schemes and rejects the rest", () => {
    expect(Messaging.isValidDownloadUrl("https://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("http://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("ftp://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("data:text/plain,hi")).toBe(true);
    expect(Messaging.isValidDownloadUrl("blob:https://x/uuid")).toBe(true);
    expect(Messaging.isValidDownloadUrl("file:///etc/passwd")).toBe(false);
    expect(Messaging.isValidDownloadUrl("javascript:1")).toBe(false);
    expect(Messaging.isValidDownloadUrl("not a url")).toBe(false);
    expect(Messaging.isValidDownloadUrl(undefined)).toBe(false);
  });

  test("records and notifies downloads from extensions the user has not allowed", async () => {
    const sendResponse = vi.fn();
    vi.mocked(global.browser.tabs.query).mockResolvedValueOnce([
      { id: 7, url: "https://private.example/account?token=secret" },
    ] as any);

    expect(
      onMessageExternal(
        download({ target: "activeTab" }),
        { id: "untrusted-extension" },
        sendResponse,
      ),
    ).toBe(true);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(global.browser.tabs.query).not.toHaveBeenCalled();
    await waitForCall(sendResponse);
    expect(ExternalDownloadRejections.record).toHaveBeenCalledWith("untrusted-extension", {
      target: "activeTab",
    });
    expect(Notifier.reportExternalDownloadRejection).toHaveBeenCalledWith("untrusted-extension");
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "UNAUTHORIZED",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("records an empty request body from an extension that is not allowed", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        { type: MESSAGE_TYPES.DOWNLOAD },
        { id: "untrusted-extension" },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(ExternalDownloadRejections.record).toHaveBeenCalledWith("untrusted-extension", {});
  });

  test("does not persist private rejected requests", async () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      download({ url: "https://private.example/secret" }),
      { id: "untrusted-extension", tab: { incognito: true } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(ExternalDownloadRejections.record).not.toHaveBeenCalled();
    expect(Notifier.reportExternalDownloadRejection).not.toHaveBeenCalled();
  });

  describe("private tabs", () => {
    const privateTab = {
      id: 5,
      title: "Private",
      url: "https://private.example/",
      incognito: true,
    };
    const errorBody = (error: string) => ({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.ERROR, error, message: expect.any(String), version: 1 },
    });

    test("refuses a private active tab without echoing its URL", async () => {
      vi.mocked(global.browser.tabs.query).mockResolvedValueOnce([privateTab] as any);
      const sendResponse = vi.fn();

      expect(
        onMessageExternal(
          download({ target: "activeTab" }),
          { id: "trusted-extension" },
          sendResponse,
        ),
      ).toBe(true);
      await waitForCall(sendResponse);

      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(errorBody("BAD_REQUEST"));
      expect(JSON.stringify(sendResponse.mock.calls)).not.toContain("private.example");
    });

    test("does not attribute a tabless request to a private tracked tab", async () => {
      setCurrentTab(privateTab);
      const sendResponse = vi.fn();

      onMessageExternal(
        download({ url: "https://x/f.png" }),
        { id: "trusted-extension" },
        sendResponse,
      );
      await waitForCall(sendResponse);

      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.currentTab).toBeNull();
    });

    test("still attributes a tabless request to a regular tracked tab", async () => {
      const sendResponse = vi.fn();

      onMessageExternal(
        download({ url: "https://x/f.png" }),
        { id: "trusted-extension" },
        sendResponse,
      );
      await waitForCall(sendResponse);

      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.currentTab).toBe(
        trackedTab,
      );
    });

    test("refuses a blob URL that is not tied to the caller's tab", async () => {
      const sendResponse = vi.fn();

      onMessageExternal(
        download({ url: "BLOB:https://x/0b8c" }),
        { id: "trusted-extension" },
        sendResponse,
      );
      await waitForCall(sendResponse);

      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(errorBody("INVALID_URL"));
    });

    test("accepts a blob URL that is the selected active tab's page", async () => {
      const activeTab = { id: 7, url: "blob:https://x/0b8c", incognito: false };
      vi.mocked(global.browser.tabs.query).mockResolvedValueOnce([activeTab] as any);
      const sendResponse = vi.fn();

      onMessageExternal(
        download({ target: "activeTab" }),
        { id: "trusted-extension" },
        sendResponse,
      );
      await waitForCall(sendResponse);

      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.currentTab).toBe(activeTab);
    });

    test("accepts a blob URL from the caller's own tab", async () => {
      const callerTab = { id: 6, url: "https://x/", incognito: false };
      const sendResponse = vi.fn();

      onMessageExternal(
        download({ url: "blob:https://x/0b8c" }),
        { id: "trusted-extension", tab: callerTab },
        sendResponse,
      );
      await waitForCall(sendResponse);

      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.currentTab).toBe(callerTab);
    });
  });

  test("matches external extension ids as trimmed, exact allowlist lines", async () => {
    options.externalDownloadAllowlist = "other-extension\n  trusted-extension  \n";
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(
        download({ url: "https://x/allowed.png" }),
        { id: "trusted-extension" },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
  });

  test("an unknown external message type returns UNKNOWN_TYPE", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: "WAT" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: "WAT",
      body: { status: MESSAGE_TYPES.ERROR, error: "UNKNOWN_TYPE", version: 1 },
    });
  });

  test("a malformed external value without a type cannot be correlated", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ body: {} }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test("a known external message with a malformed body returns BAD_REQUEST", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      { type: MESSAGE_TYPES.DOWNLOAD, body: { url: 42, info: "not an object" } },
      {},
      sendResponse,
    );
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.ERROR, error: "BAD_REQUEST", version: 1 },
    });
  });

  test("PING advertises the schema and validate capabilities", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.PING }, {}, sendResponse);
    const { capabilities } = sendResponse.mock.calls[0]![0]!.body;
    expect(capabilities).toEqual(expect.arrayContaining(["schema", "validate"]));
    expect(capabilities).not.toContain("apply_config");
  });

  test("rate-limits repeated validation requests per caller", () => {
    const sender = { id: "rate-limit-boundary" };
    for (let index = 0; index < 20; index += 1) {
      onMessageExternal({ type: MESSAGE_TYPES.VALIDATE }, sender, vi.fn());
    }
    const sendResponse = vi.fn();

    onMessageExternal({ type: MESSAGE_TYPES.VALIDATE }, sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.VALIDATE,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "RATE_LIMITED",
        message: "Too many validation requests",
        version: 1,
      },
    });
  });

  test("rejects oversized WebMCP validation before parsing", () => {
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.VALIDATE,
        body: { filenamePatterns: "x".repeat(32_769), validationSource: "webmcp" },
      },
      { id: "webmcp-boundary" },
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.VALIDATE,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "BAD_REQUEST",
        message: "Validation rules are too large",
      },
    });
  });
});

// Scriptable / AI-assisted config API (#89, docs/integrating/INTEGRATIONS.md §4)
