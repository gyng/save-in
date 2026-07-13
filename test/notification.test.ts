// option.ts is import-side-effect-free, so tests can mutate the real options bag
// directly. Each test sets the fields it needs and clears them afterwards.
import { options } from "../src/config/options-data.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import { Notifier as notification } from "../src/downloads/notification.ts";

const setOptions = (overrides: Partial<SaveInOptions> = {}) => {
  const mutableOptions = options as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutableOptions)) delete mutableOptions[key];
  Object.assign(mutableOptions, overrides);
};

test("checks for download failures on Firefox", () => {
  const notFailure = {
    state: { current: "complete", previous: "in_progress" },
  };
  expect(notification.isDownloadFailure(notFailure, false)).toBe(false);

  const failure = {
    state: { current: "interrupted", previous: "in_progress" },
  };
  expect(notification.isDownloadFailure(failure, false)).toBe(true);
});

test("checks for download failures on Chrome", () => {
  const notFailure = {};
  expect(notification.isDownloadFailure(notFailure, true)).toBeFalsy();

  const failure = { error: "some error" };
  expect(notification.isDownloadFailure(failure, true)).toBeTruthy();
});

test("an error delta is a failure on Firefox too", () => {
  const failure = { error: { current: "NETWORK_FAILED" } };
  expect(notification.isDownloadFailure(failure, false)).toBeTruthy();
});

test("a paused or resumable interruption is not a failure on Firefox (§8.4, #28)", () => {
  // paused download: interrupted but paused.current === true
  expect(
    notification.isDownloadFailure(
      { state: { current: "interrupted" }, paused: { current: true } },
      false,
    ),
  ).toBeFalsy();

  // resumable stall: interrupted but canResume.current === true
  expect(
    notification.isDownloadFailure(
      { state: { current: "interrupted" }, canResume: { current: true } },
      false,
    ),
  ).toBeFalsy();

  // even with an error reason, a resumable interruption is not surfaced as failed
  expect(
    notification.isDownloadFailure(
      {
        state: { current: "interrupted" },
        error: { current: "NETWORK_FAILED" },
        canResume: { current: true },
      },
      false,
    ),
  ).toBeFalsy();
});

describe("createExtensionNotification", () => {
  beforeEach(() => {
    (global.browser as any).notifications = {
      create: vi.fn(),
      clear: vi.fn(),
    };
  });

  afterEach(() => {
    setOptions();
    vi.useRealTimers();
  });

  test("creates a notification and clears it after notifyDuration", () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 500 });

    notification.createExtensionNotification("Title", "Message", false, "route-match");
    vi.advanceTimersByTime(250);

    const [id, spec] = vi.mocked(global.browser.notifications.create).mock.calls[0]!;
    expect(id).toBe("save-in-not-route-match");
    expect(spec).toEqual({
      type: "basic",
      title: "Title",
      iconUrl: "icons/ic_archive_black_128px.png",
      message: "Message",
    });

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith(id);
  });

  test("falls back to i18n title/message and the error icon", () => {
    vi.useFakeTimers();
    setOptions({});

    notification.createExtensionNotification(null, null, true, "download-failure");
    vi.advanceTimersByTime(250);

    const [, spec] = vi.mocked(global.browser.notifications.create).mock.calls[0]!;
    expect(spec.title).toBe("Translated<extensionName>");
    expect(spec.message).toBe("Translated<genericUnknownError>");
    expect(spec.iconUrl).toBe("icons/ic_archive_black_128px.png");
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("skips the auto-clear timer when notifyDuration is unset", () => {
    vi.useFakeTimers();
    setOptions({});

    notification.createExtensionNotification("T", "M", false, "link-preferred");
    vi.advanceTimersByTime(250);

    expect(global.browser.notifications.create).toHaveBeenCalled();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("treats zero as the browser default duration", () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 0 });
    notification.createExtensionNotification("T", "M", undefined, "link-preferred");
    vi.runAllTimers();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("coalesces rapid updates to one stable notification stream", () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 0 });

    notification.createExtensionNotification("Routing", "first", false, "route-match");
    notification.createExtensionNotification("Routing", "second", false, "route-match");
    notification.createExtensionNotification("Routing", "latest", false, "route-match");

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "save-in-not-route-match",
      expect.objectContaining({ message: "latest" }),
    );
  });

  test("keeps independent notification streams separate", () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 0 });

    notification.createExtensionNotification("Routing", "matched", false, "route-match");
    notification.createExtensionNotification("Download", "failed", true, "download-failure");
    vi.advanceTimersByTime(250);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.browser.notifications.create).mock.calls.map(([id]) => id)).toEqual([
      "save-in-not-route-match",
      "save-in-not-download-failure",
    ]);
  });

  test("reports a rejected external download immediately with a stable notification id", async () => {
    setOptions({ notifyDuration: 0 });

    await notification.reportExternalDownloadRejection("blocked-extension");

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "save-in-not-external-download-rejection",
      expect.objectContaining({
        type: "basic",
        title: "External download blocked",
        message: "Blocked a request from blocked-extension. Click to review it in Options.",
      }),
    );
  });

  test("opens options when the rejected-download notification is clicked", async () => {
    global.browser.runtime.openOptionsPage = vi.fn(() => Promise.resolve());

    await notification.onNotificationClicked("save-in-not-external-download-rejection");

    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalledOnce();
  });

  test("restarts auto-clear timing when a stream is updated", () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 500 });

    notification.createExtensionNotification("Routing", "first", false, "route-match");
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(300);
    notification.createExtensionNotification("Routing", "updated", false, "route-match");
    vi.advanceTimersByTime(250);

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(global.browser.notifications.clear).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("save-in-not-route-match");
  });

  test("keeps the same stream id after the background module reloads", async () => {
    vi.useFakeTimers();
    setOptions({ notifyDuration: 0 });

    notification.createExtensionNotification("Routing", "before reload", false, "route-match");
    vi.advanceTimersByTime(250);

    vi.resetModules();
    const [{ Notifier: reloadedNotifier }, { options: reloadedOptions }] = await Promise.all([
      import("../src/downloads/notification.ts"),
      import("../src/config/options-data.ts"),
    ]);
    Object.assign(reloadedOptions, { notifyDuration: 0 });
    reloadedNotifier.createExtensionNotification("Routing", "after reload", false, "route-match");
    vi.advanceTimersByTime(250);

    expect(vi.mocked(global.browser.notifications.create).mock.calls.map(([id]) => id)).toEqual([
      "save-in-not-route-match",
      "save-in-not-route-match",
    ]);
  });
});
