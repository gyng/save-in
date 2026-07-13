import { Download } from "../src/downloads/download.ts";
import { Notifier } from "../src/downloads/notification.ts";
import {
  BACKGROUND_E2E_COMMAND,
  BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
  handleBackgroundE2ECommand,
  handleBackgroundE2EContextMenuCommand,
} from "../src/background/e2e-command.ts";

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

test("rejects malformed optional download fields at the wire boundary", async () => {
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

test("rejects malformed context-menu fields before dispatch", async () => {
  const dispatch = vi.fn(() => Promise.resolve());

  await expect(
    handleBackgroundE2EContextMenuCommand(
      {
        type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
        body: {
          info: { menuItemId: "save-in-0", pageUrl: 42 },
          tab: { id: "1" },
        },
      },
      dispatch,
    ),
  ).resolves.toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});
