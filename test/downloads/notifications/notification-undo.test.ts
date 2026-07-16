// Undo last save (#102): the Chrome-only success-notification button and the
// shared undo semantics (removeFile, then erase, then mark — never delete).
import {
  browserState,
  Notifier,
  options,
  loadNotification,
  setupGlobals,
} from "./session.fixture.ts";

describe("undo on the success notification", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;
  let onButtonClicked: any;

  beforeEach(async () => {
    vi.resetModules();
    browserState.current = "CHROME";
    sessionStore = {};
    setupGlobals(sessionStore, () => [{ id: 7, fileSize: 2048, mime: "image/png" }]);
    await loadNotification();
    Object.assign(options, {
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 0,
      promptOnFailure: false,
    });
    onCreated = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]![0];
    onChanged = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls[0]![0];
    onButtonClicked = vi.mocked(global.browser.notifications.onButtonClicked.addListener).mock
      .calls[0]![0];
  });

  const completeOwnDownload = async (item: Record<string, unknown> = {}) => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "C:\\dl\\pic.png",
      url: "https://x/p.png",
      ...item,
    });
    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
  };

  test("Chrome success notification carries the Undo button", async () => {
    await completeOwnDownload();

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ buttons: [{ title: "Translated<notificationUndoSave>" }] }),
    );
  });

  test("Firefox success notification omits buttons entirely", async () => {
    browserState.current = "FIREFOX";
    await completeOwnDownload();

    const [, details] = vi.mocked(global.browser.notifications.create).mock.calls[0]!;
    expect(details).toMatchObject({ type: "basic" });
    expect(Object.keys(details as object)).not.toContain("buttons");
  });

  test("private records get no Undo button even on Chrome", async () => {
    Notifier.expectDownload("https://x/p.png", { privateContext: true });
    await completeOwnDownload({ incognito: true });

    const [, details] = vi.mocked(global.browser.notifications.create).mock.calls[0]!;
    expect(Object.keys(details as object)).not.toContain("buttons");
  });

  test("button click removes the file, erases the shelf entry, and marks history", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    sessionStore.siDownloads = { 7: { adopted: true, historyEntryId: "h-undo" } };

    await onButtonClicked("7", 0);

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(7);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 7 });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-undo", "undone", 7);
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("a file already removed out-of-band still erases and marks", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    vi.mocked(global.browser.downloads.removeFile).mockRejectedValueOnce(new Error("file missing"));
    sessionStore.siDownloads = { 7: { adopted: true, historyEntryId: "h-undo" } };

    await onButtonClicked("7", 0);

    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 7 });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-undo", "undone", 7);
  });

  test("ignores other buttons and non-download notification ids", async () => {
    await onButtonClicked("7", 1);
    await onButtonClicked("save-in-not-general", 0);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });
});
