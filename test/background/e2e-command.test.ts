import { Download } from "../../src/downloads/download.ts";
import { Notifier } from "../../src/downloads/notification.ts";
import {
  BACKGROUND_E2E_COMMAND,
  BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
  BACKGROUND_E2E_NOTIFICATION_COMMAND,
  handleBackgroundE2ECommand,
  handleBackgroundE2EContextMenuCommand,
  handleBackgroundE2ENotificationCommand,
  installBackgroundE2ENotificationObserver,
} from "../../src/background/e2e-command.ts";

test("starts one pipeline download without registering a duplicate expectation", async () => {
  const launch = vi.spyOn(Download, "launch").mockResolvedValue({
    status: "started",
    downloadId: 7,
  });
  const expectDownload = vi.spyOn(Notifier, "expectDownload");

  const response = await handleBackgroundE2ECommand({
    type: BACKGROUND_E2E_COMMAND,
    body: {
      content: "browser test",
      suggestedFilename: "bridge.txt",
    },
  });

  expect(response).toEqual({
    type: BACKGROUND_E2E_COMMAND,
    body: { status: "OK", result: { status: "started", downloadId: 7 } },
  });
  expect(launch).toHaveBeenCalledOnce();
  expect(expectDownload).not.toHaveBeenCalled();
});

test("ignores messages outside the e2e command protocol", async () => {
  await expect(handleBackgroundE2ECommand({ type: "WAKE_WARM" })).resolves.toBeNull();
});

test("rejects a malformed download command at the test bridge", async () => {
  await expect(
    handleBackgroundE2ECommand({
      type: BACKGROUND_E2E_COMMAND,
      body: {
        path: 42,
        suggestedFilename: "bridge.txt",
      },
    }),
  ).resolves.toBeNull();
});

test("waits for the production context-menu handler before acknowledging the command", async () => {
  let release: (() => void) | undefined;
  const dispatch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let settled = false;
  const response = handleBackgroundE2EContextMenuCommand(
    {
      type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
      body: { info: { menuItemId: "save-in-0" } },
    },
    dispatch,
  ).then((value) => {
    settled = true;
    return value;
  });

  await Promise.resolve();
  expect(dispatch).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  release?.();
  await expect(response).resolves.toEqual({
    type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
    body: { status: "OK" },
  });
});

test("rejects a malformed context-menu command before dispatch", async () => {
  const dispatch = vi.fn(() => Promise.resolve());

  await expect(
    handleBackgroundE2EContextMenuCommand(
      {
        type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
        body: { info: { menuItemId: "save-in-0", pageUrl: 42 } },
      },
      dispatch,
    ),
  ).resolves.toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});

test("returns a command error when context-menu dispatch fails", async () => {
  const dispatch = vi.fn(() => Promise.reject(new Error("click failed")));

  await expect(
    handleBackgroundE2EContextMenuCommand(
      {
        type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
        body: { info: { menuItemId: "save-in-0" } },
      },
      dispatch,
    ),
  ).resolves.toEqual({
    type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
    body: { status: "ERROR", message: "click failed" },
  });
});

test("observes notification calls while preserving the native API call", async () => {
  const create = vi.mocked(global.browser.notifications.create);
  create.mockResolvedValue("download-7");
  installBackgroundE2ENotificationObserver();
  handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "reset" },
  });

  await global.browser.notifications.create("7", {
    type: "basic",
    iconUrl: "icons/save.png",
    title: "Saved",
    message: "notification-e2e.txt",
  });

  expect(create).toHaveBeenCalledOnce();
  expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "get" },
    }),
  ).toEqual({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: {
      status: "OK",
      calls: [{ id: "7", title: "Saved", message: "notification-e2e.txt" }],
    },
  });
});
