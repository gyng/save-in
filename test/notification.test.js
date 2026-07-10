const notification = (await import("../src/notification.js")).default;

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
    global.browser.notifications = {
      create: jest.fn(),
      clear: jest.fn(),
    };
  });

  afterEach(() => {
    global.options = undefined;
    jest.useRealTimers();
  });

  test("creates a notification and clears it after notifyDuration", () => {
    jest.useFakeTimers();
    global.options = { notifyDuration: 500 };

    notification.createExtensionNotification("Title", "Message", false);

    const [id, spec] = global.browser.notifications.create.mock.calls[0];
    expect(id).toMatch(/^save-in-not-/);
    expect(spec).toEqual({
      type: "basic",
      title: "Title",
      iconUrl: "icons/ic_archive_black_128px.png",
      message: "Message",
    });

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith(id);
  });

  test("falls back to i18n title/message and the error icon", () => {
    global.options = {};

    notification.createExtensionNotification(null, null, true);

    const [, spec] = global.browser.notifications.create.mock.calls[0];
    expect(spec.title).toBe("Translated<extensionName>");
    expect(spec.message).toBe("Translated<genericUnknownError>");
    expect(spec.iconUrl).toBe("icons/ic_error_outline_red_96px.png");
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("skips the auto-clear timer when options are missing", () => {
    global.options = undefined;

    notification.createExtensionNotification("T", "M", false);

    expect(global.browser.notifications.create).toHaveBeenCalled();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });
});
