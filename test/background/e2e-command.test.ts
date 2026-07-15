import { Download } from "../../src/downloads/download.ts";
import * as Notifier from "../../src/downloads/notification.ts";
import * as ActiveTransfers from "../../src/downloads/active-transfers.ts";
import { downloadsState } from "../../src/downloads/state.ts";
import { counterWriteState } from "../../src/background/state.ts";
import { backgroundRuntime } from "../../src/background/runtime.ts";
import {
  BACKGROUND_E2E_COMMAND,
  BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
  BACKGROUND_E2E_NOTIFICATION_COMMAND,
  BACKGROUND_E2E_RESET_COMMAND,
  handleBackgroundE2ECommand,
  handleBackgroundE2EContextMenuCommand,
  handleBackgroundE2ENotificationCommand,
  handleBackgroundE2EResetCommand,
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

test("resets worker-local state after each browser case", async () => {
  const controller = new AbortController();
  ActiveTransfers.registerActiveTransfer("history-7", controller);
  downloadsState.records.set(7, { adopted: true, filename: "old.txt" });
  downloadsState.hydration = Promise.resolve();
  backgroundRuntime.lastDownloadState = {
    path: { finalize: () => "stale", toString: () => "stale" },
    scratch: {},
    info: { comment: "stale", menuIndex: "4" },
  };
  counterWriteState.privateValue = 9;
  const previousReady = backgroundRuntime.ready;
  backgroundRuntime.ready = Promise.reject(new Error("prior initialization failed"));

  try {
    await expect(
      handleBackgroundE2EResetCommand({ type: BACKGROUND_E2E_RESET_COMMAND }),
    ).resolves.toEqual({
      type: BACKGROUND_E2E_RESET_COMMAND,
      body: { status: "OK" },
    });
  } finally {
    if (previousReady) backgroundRuntime.ready = previousReady;
    else delete backgroundRuntime.ready;
  }

  expect(controller.signal.aborted).toBe(true);
  expect(downloadsState.records.size).toBe(0);
  expect(downloadsState.hydration).toBeNull();
  expect(backgroundRuntime.lastDownloadState).toBeUndefined();
  expect(counterWriteState.privateValue).toBeUndefined();
  await expect(
    handleBackgroundE2EResetCommand({ type: BACKGROUND_E2E_RESET_COMMAND, body: {} }),
  ).resolves.toBeNull();
});

test("observes notification calls while preserving the native API call", async () => {
  const create = vi.mocked(global.browser.notifications.create);
  create.mockResolvedValue("download-7");
  installBackgroundE2ENotificationObserver();
  handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "reset" },
  });
  const observed = handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "wait", id: "7", timeoutMs: 1000 },
  });

  await global.browser.notifications.create("7", {
    type: "basic",
    iconUrl: "icons/save.png",
    title: "Saved",
    message: "notification-e2e.txt",
  });

  expect(create).toHaveBeenCalledOnce();
  await expect(observed).resolves.toEqual({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: {
      status: "OK",
      calls: [{ id: "7", title: "Saved", message: "notification-e2e.txt" }],
    },
  });
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

  handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "reset" },
  });
  create.mockRejectedValueOnce(new Error("native notification failed"));
  await expect(
    global.browser.notifications.create("8", {
      type: "basic",
      iconUrl: "icons/save.png",
      title: "Not saved",
      message: "failed.txt",
    }),
  ).rejects.toThrow("native notification failed");
  expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "get" },
    }),
  ).toMatchObject({ body: { status: "OK", calls: [] } });

  const resetWait = handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "wait", id: "9", timeoutMs: 1000 },
  });
  handleBackgroundE2ENotificationCommand({
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { action: "reset" },
  });
  await expect(resetWait).resolves.toMatchObject({
    body: { status: "ERROR", message: "Notification wait was reset" },
  });

  await expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "wait", id: "10", timeoutMs: 1 },
    }),
  ).resolves.toMatchObject({
    body: { status: "ERROR", message: "Timed out waiting for notification 10" },
  });
  expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "wait", id: "11", timeoutMs: 0 },
    }),
  ).toBeNull();
  expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "wait", id: "", timeoutMs: 1000 },
    }),
  ).toBeNull();
  expect(
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "wait", id: "12", timeoutMs: 300_001 },
    }),
  ).toBeNull();
});
