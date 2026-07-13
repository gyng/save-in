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

test.each([
  ["path", { path: 42 }],
  ["content", { content: 42 }],
  ["url", { url: 42 }],
  ["shortcutUrl", { shortcutUrl: 42 }],
  ["pageUrl", { pageUrl: 42 }],
  ["modifiers", { modifiers: ["Ctrl", 42] }],
])("rejects a malformed %s download field at the wire boundary", async (_field, body) => {
  await expect(
    handleBackgroundE2ECommand({
      type: BACKGROUND_E2E_COMMAND,
      body: {
        ...body,
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

test.each([
  ["frameUrl", { info: { menuItemId: "save-in-0", frameUrl: 42 } }],
  ["mediaType", { info: { menuItemId: "save-in-0", mediaType: 42 } }],
  ["srcUrl", { info: { menuItemId: "save-in-0", srcUrl: 42 } }],
  ["linkUrl", { info: { menuItemId: "save-in-0", linkUrl: 42 } }],
  ["pageUrl", { info: { menuItemId: "save-in-0", pageUrl: 42 } }],
  ["selectionText", { info: { menuItemId: "save-in-0", selectionText: 42 } }],
  ["linkText", { info: { menuItemId: "save-in-0", linkText: 42 } }],
  ["modifiers", { info: { menuItemId: "save-in-0", modifiers: ["Ctrl", 42] } }],
  ["tab", { info: { menuItemId: "save-in-0" }, tab: "tab" }],
  ["tab.id", { info: { menuItemId: "save-in-0" }, tab: { id: "1" } }],
  ["tab.title", { info: { menuItemId: "save-in-0" }, tab: { title: 42 } }],
  ["tab.url", { info: { menuItemId: "save-in-0" }, tab: { url: 42 } }],
  ["tab.incognito", { info: { menuItemId: "save-in-0" }, tab: { incognito: "yes" } }],
])("rejects a malformed context-menu %s field before dispatch", async (_field, body) => {
  const dispatch = vi.fn(() => Promise.resolve());

  await expect(
    handleBackgroundE2EContextMenuCommand(
      {
        type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
        body,
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
