// "When a file already exists" through the real save pipeline: Firefox's
// emulated Ask and Skip, and every path that must save exactly as before.
import {
  Download,
  downloadState,
  makeState,
  Notifier,
  options,
  SaveHistory,
  sessionStore,
  setCurrentBrowser,
} from "./download-flow.fixture.ts";
import { DOWNLOAD_TYPES } from "../../src/shared/constants.ts";

const DOWNLOADS = "/home/me/Downloads";
// Whatever the fixture routes to, the rename is derived from the requested name.
const requestedFilename = () => {
  const [[request]] = vi.mocked(global.browser.downloads.download).mock.calls as any;
  return String(request.filename);
};
const renamed = (requested: string) =>
  `${DOWNLOADS}/${requested.replace(/(\.[^.]*)?$/, (ext) => `(1)${ext}`)}`;

// The item Firefox created for each id, as downloads.search reports it.
let items: Record<number, { filename?: string; state: string }>;
const reportFirefoxItems = (rename: (requested: string) => string) => {
  vi.mocked(global.browser.downloads.search).mockImplementation(async (query: any) => {
    const item = items[query.id];
    if (item) return [{ id: query.id, ...item }] as any;
    return [{ id: query.id, filename: rename(requestedFilename()), state: "in_progress" }] as any;
  });
};

// Chrome names an HTTP download in onDeterminingFilename, after the request.
const startFilenameResolvedLaunch = async (state: ReturnType<typeof makeState>) => {
  const launch = Download.renameAndDownload(state);
  await vi.waitFor(() => expect(global.browser.downloads.download).toHaveBeenCalled());
  return { launch };
};

const statuses = () => vi.mocked(SaveHistory.setHistoryStatus).mock.calls.map((call) => call[1]);

beforeEach(() => {
  items = {};
  setCurrentBrowser("FIREFOX");
  options.notifyOnFailure = true;
  (global.browser.downloads as any).erase = vi.fn(() => Promise.resolve([]));
  (global.browser.downloads as any).removeFile = vi.fn(() => Promise.resolve());
  reportFirefoxItems(renamed);
});

describe("Skip", () => {
  beforeEach(() => {
    options.conflictAction = "skip";
  });

  test("discards Firefox's renamed copy, records it and says so once", async () => {
    let markerAtCancel: unknown;
    vi.mocked(global.browser.downloads.cancel).mockImplementation(async () => {
      markerAtCancel = structuredClone(sessionStore.siConflictCancels);
      items[101] = { state: "interrupted" };
    });

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({ status: "skipped" });

    const [[request]] = vi.mocked(global.browser.downloads.download).mock.calls as any;
    // Firefox has no "skip"; its uniquify is what reveals the existing file.
    expect(request).toMatchObject({ saveAs: false, conflictAction: "uniquify" });
    expect(markerAtCancel).toEqual({ 101: { action: "skip", historyEntryId: "h-test" } });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 101 });
    expect(sessionStore.siConflictCancels).toEqual({});
    expect(statuses()).toEqual(["CONFLICT_SKIPPED"]);
    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationConflictSkippedTitle",
      "notificationConflictSkippedMessage",
      false,
      Notifier.EXTENSION_NOTIFICATION_STREAMS.CONFLICT_SKIP,
      { privateContext: false },
    );
    // A skipped save is not a started one: no retry record, webhook or binding.
    expect(SaveHistory.setHistoryDownloadId).not.toHaveBeenCalled();
  });

  test("deletes a tiny copy that finished before the cancel", async () => {
    vi.mocked(global.browser.downloads.cancel).mockImplementation(async () => {
      items[101] = { state: "complete" };
      throw new Error("Download 101 is already complete");
    });

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({ status: "skipped" });

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(101);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 101 });
    expect(statuses()).toEqual(["CONFLICT_SKIPPED"]);
  });

  test("stays quiet when failure notifications are off", async () => {
    options.notifyOnFailure = false;

    await Download.renameAndDownload(makeState());

    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
    expect(statuses()).toEqual(["CONFLICT_SKIPPED"]);
  });

  test("does not identify a private item or admit it to History", async () => {
    options.persistPrivateActivity = false;

    await Download.renameAndDownload(makeState({ info: { currentTab: { incognito: true } } }));

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationConflictSkippedTitle",
      "notificationPrivateConflictSkippedMessage",
      false,
      Notifier.EXTENSION_NOTIFICATION_STREAMS.CONFLICT_SKIP,
      { privateContext: true },
    );
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalledWith(
      expect.any(String),
      "CONFLICT_SKIPPED",
    );
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 101 });
  });

  test("a sidecar skips silently", async () => {
    await Download.renameAndDownload(makeState({ info: { context: DOWNLOAD_TYPES.SIDECAR } }));

    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 101 });
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("contains a History failure", async () => {
    vi.mocked(SaveHistory.setHistoryStatus).mockRejectedValueOnce(new Error("full"));

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({ status: "skipped" });
  });
});

describe("Ask each time, emulated on Firefox", () => {
  beforeEach(() => {
    // Firefox only ever held "prompt" through an imported Chrome profile; it
    // used to save as uniquify and now asks.
    options.conflictAction = "prompt";
  });

  test("replaces the renamed copy with a Save As dialog for the same file", async () => {
    vi.mocked(global.browser.downloads.download)
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({
      status: "started",
      downloadId: 102,
    });

    const [[first], [second]] = vi.mocked(global.browser.downloads.download).mock.calls as any;
    // Firefox fails a native "prompt" outright (#89, #217).
    expect(first).toMatchObject({ saveAs: false, conflictAction: "uniquify" });
    expect(second).toMatchObject({
      url: first.url,
      filename: first.filename,
      saveAs: true,
      // Uniquify would make Firefox's picker propose name(1).ext, since the
      // file is known to exist; the picker itself confirms the replacement.
      conflictAction: "overwrite",
    });
    // A later network retry has no dialog, so it must never overwrite.
    expect(downloadState.records.get(102)?.conflictAction).toBe("uniquify");
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 101 });
    // The dialog replaces the check, so the replacement is never re-examined.
    expect(global.browser.downloads.download).toHaveBeenCalledTimes(2);
    expect(global.browser.downloads.cancel).not.toHaveBeenCalledWith(102);
    expect(SaveHistory.setHistoryDownloadId).toHaveBeenCalledWith("h-test", 102);
    expect(statuses()).toEqual([]);
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("dismissing the dialog cancels the save without fetching or asking again", async () => {
    vi.mocked(global.browser.downloads.download).mockImplementation(async (request: any) => {
      if (request.saveAs) throw new Error("Download canceled by the user");
      return 101;
    });

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({ status: "skipped" });

    expect(
      vi
        .mocked(global.browser.downloads.download)
        .mock.calls.map(([request]: any) => request.saveAs),
    ).toEqual([false, true]);
    expect(
      vi.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method !== "HEAD"),
    ).toEqual([]);
    expect(statuses()).toEqual(["USER_CANCELED"]);
    expect(Notifier.reportDownloadFailure).not.toHaveBeenCalled();
  });
});

describe("saves exactly as before", () => {
  test.each(["uniquify", "overwrite"])("Firefox %s never checks", async (action) => {
    options.conflictAction = action as "uniquify" | "overwrite";

    await expect(Download.renameAndDownload(makeState())).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ conflictAction: action }),
    );
    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  test("a name Firefox changed for another reason is not a conflict", async () => {
    options.conflictAction = "skip";
    reportFirefoxItems((requested) => `${DOWNLOADS}/${requested.replace(/\.png$/, "_(1).png")}`);

    await expect(Download.renameAndDownload(makeState())).resolves.toMatchObject({
      status: "started",
    });

    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(statuses()).toEqual([]);
  });

  test("an unreadable item fails open", async () => {
    options.conflictAction = "skip";
    vi.mocked(global.browser.downloads.search).mockRejectedValue(new Error("no item"));

    await expect(Download.renameAndDownload(makeState())).resolves.toMatchObject({
      status: "started",
    });

    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  test("a Save As dialog the user already gets is never second-guessed", async () => {
    options.conflictAction = "skip";
    options.prompt = true;

    await expect(Download.renameAndDownload(makeState())).resolves.toMatchObject({
      status: "started",
    });

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  // Chrome loads a stored "skip" as uniquify; even an unnormalized bag must not
  // hand Chrome an action it rejects or cancel anything.
  test("Chrome passes only native actions and never checks", async () => {
    setCurrentBrowser("CHROME");
    options.conflictAction = "skip";

    const { launch } = await startFilenameResolvedLaunch(makeState());
    void launch;

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ conflictAction: "uniquify" }),
    );
    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
  });
});
