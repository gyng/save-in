import { beforeEach, describe, expect, test, vi } from "vitest";

import { Messaging } from "../src/background/messaging.ts";
import { Download } from "../src/downloads/download.ts";
import { MESSAGE_TYPES } from "../src/shared/constants.ts";
import { webExtensionApi } from "../src/platform/web-extension-api.ts";

const request = (body: Record<string, unknown>) =>
  ({
    type: MESSAGE_TYPES.DOWNLOAD,
    body,
  }) as any;

describe("external active-tab downloads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(Download, "launch").mockResolvedValue({ status: "skipped" });
    vi.spyOn(webExtensionApi.tabs, "query").mockResolvedValue([]);
  });

  test("advertises the additive capability", () => {
    const sendResponse = vi.fn();
    Messaging.handlePing({ type: MESSAGE_TYPES.PING }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.PONG,
      body: {
        version: 1,
        capabilities: expect.arrayContaining(["active_tab", "download", "ping"]),
      },
    });
  });

  test("resolves the active tab in the last-focused window", async () => {
    const activeTab = { id: 42, title: "Active Tab", url: "https://x/active" };
    vi.mocked(webExtensionApi.tabs.query).mockResolvedValueOnce([activeTab] as any);
    const sendResponse = vi.fn();

    await Messaging.handleDownloadMessage(
      request({ target: "activeTab", comment: "gesturefy", version: 1 }),
      {},
      sendResponse,
    );

    expect(webExtensionApi.tabs.query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
    const state = vi.mocked(Download.launch).mock.calls[0]![0]!;
    expect(state.info.url).toBe("https://x/active");
    expect(state.info.currentTab).toBe(activeTab);
    expect(state.info.comment).toBe("gesturefy");
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/active" },
    });
  });

  test("prefers the originating tab", async () => {
    const senderTab = { id: 9, title: "Origin", url: "https://x/origin" } as browser.tabs.Tab;

    await Messaging.handleDownloadMessage(
      request({ target: "activeTab" }),
      { tab: senderTab },
      vi.fn(),
    );

    expect(webExtensionApi.tabs.query).not.toHaveBeenCalled();
    const state = vi.mocked(Download.launch).mock.calls[0]![0]!;
    expect(state.info.url).toBe("https://x/origin");
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("gives an explicit URL precedence over the target", async () => {
    await Messaging.handleDownloadMessage(
      request({ url: "https://x/explicit", target: "activeTab" }),
      {},
      vi.fn(),
    );

    expect(webExtensionApi.tabs.query).not.toHaveBeenCalled();
    expect(vi.mocked(Download.launch).mock.calls[0]![0]!.info.url).toBe("https://x/explicit");
  });

  test("reports a missing active tab without launching", async () => {
    const sendResponse = vi.fn();

    await Messaging.handleDownloadMessage(request({ target: "activeTab" }), {}, sendResponse);

    expect(Download.launch).not.toHaveBeenCalled();
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
});
