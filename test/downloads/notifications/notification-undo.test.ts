// Undo last save (#102): the Chrome-only success-notification button and the
// shared undo semantics (removeFile, then erase, then mark — never delete).
import {
  browserState,
  Log,
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

  test("a rejecting undo handler is contained and logged", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockRejectedValue(new Error("storage gone"));
    sessionStore.siDownloads = { 7: { adopted: true, historyEntryId: "h-undo" } };

    // The registered listener wraps the handler in runEventTask, so a
    // rejection resolves after logging instead of surfacing to the host.
    await expect(onButtonClicked("7", 0)).resolves.toBeUndefined();

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "notification button event failed",
      expect.stringContaining("storage gone"),
    );
  });

  test("ignores other buttons and non-download notification ids", async () => {
    await onButtonClicked("7", 1);
    await onButtonClicked("save-in-not-general", 0);
    // Passes the numeral regex but exceeds the safe-integer range a download
    // id can hold.
    await onButtonClicked("99999999999999999999", 0);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });

  test("a lost session record falls back to the history entry and marks it", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    vi.spyOn(history, "getHistoryEntries").mockResolvedValue([
      { id: "h-fallback", url: "https://x/p.png", downloadId: 7, status: "complete" } as never,
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 7, url: "https://x/p.png" } as never,
    ]);
    // No siDownloads entry: the worker restarted and the per-download record
    // is gone, but the history entry still knows the download id.
    await onButtonClicked("7", 0);

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(7);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 7 });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-fallback", "undone", 7);
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("with no record and no history entry, undo proceeds and logs the unmarked entry", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    vi.spyOn(history, "getHistoryEntries").mockResolvedValue([]);

    await onButtonClicked("7", 0);

    // Chrome download ids are stable across sessions, so the undo itself is
    // safe; only the History mark has nothing to attach to.
    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(7);
    expect(history.setHistoryStatus).not.toHaveBeenCalled();
    expect(Log.addLogEntry).toHaveBeenCalledWith("undo could not mark history", { downloadId: 7 });
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("a reused id pointing at a foreign download is refused from the button", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    sessionStore.siDownloads = {
      7: { adopted: true, historyEntryId: "h-undo", url: "https://x/p.png" },
    };
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 7, url: "https://elsewhere/report.pdf", filename: "/dl/report.pdf" } as never,
    ]);

    await onButtonClicked("7", 0);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
    expect(history.setHistoryStatus).not.toHaveBeenCalled();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("a failed erase from the button neither marks nor clears", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    vi.mocked(global.browser.downloads.erase).mockRejectedValueOnce(new Error("shelf locked"));
    sessionStore.siDownloads = { 7: { adopted: true, historyEntryId: "h-undo" } };

    await onButtonClicked("7", 0);

    expect(history.setHistoryStatus).not.toHaveBeenCalled();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("a rejecting notification clear does not fail the undo", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    vi.mocked(global.browser.notifications.clear).mockRejectedValueOnce(new Error("gone"));
    sessionStore.siDownloads = { 7: { adopted: true, historyEntryId: "h-undo" } };

    await expect(onButtonClicked("7", 0)).resolves.toBeUndefined();

    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-undo", "undone", 7);
  });

  test("the button title falls back when the catalog has no entry", async () => {
    const localization = await import("../../../src/platform/localization.ts");
    vi.spyOn(localization, "getMessage").mockReturnValue("");
    await completeOwnDownload();

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ buttons: [{ title: "Undo save" }] }),
    );
  });
});
