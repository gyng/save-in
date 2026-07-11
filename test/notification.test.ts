// option.ts is import-side-effect-free now (Task #2: the seed is deferred out of
// module eval), so import the real options bag and mutate it directly instead of
// bridging through a globalThis getter. It starts empty; each test sets what it
// needs and clears afterwards.
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
      create: jest.fn(),
      clear: jest.fn(),
    };
  });

  afterEach(() => {
    setOptions();
    jest.useRealTimers();
  });

  test("creates a notification and clears it after notifyDuration", () => {
    jest.useFakeTimers();
    setOptions({ notifyDuration: 500 });

    notification.createExtensionNotification("Title", "Message", false);

    const [id, spec] = vi.mocked(global.browser.notifications.create).mock.calls[0];
    expect(id).toMatch(/^save-in-not-/);
    expect(spec).toEqual({
      type: "basic",
      title: "Title",
      iconUrl: "icons/notification-info.svg",
      message: "Message",
    });

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith(id);
  });

  test("falls back to i18n title/message and the error icon", () => {
    setOptions({});

    notification.createExtensionNotification(null, null, true);

    const [, spec] = vi.mocked(global.browser.notifications.create).mock.calls[0];
    expect(spec.title).toBe("Translated<extensionName>");
    expect(spec.message).toBe("Translated<genericUnknownError>");
    expect(spec.iconUrl).toBe("icons/notification-error.svg");
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("skips the auto-clear timer when notifyDuration is unset", () => {
    setOptions({});

    notification.createExtensionNotification("T", "M", false);

    expect(global.browser.notifications.create).toHaveBeenCalled();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });
});
