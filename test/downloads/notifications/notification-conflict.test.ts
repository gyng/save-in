// A save Save In cancels because the file already exists is neither a failure,
// a cancellation nor a completion. These tests drive the real event handlers,
// recovery and session state around that deliberate discard.
import {
  adoptedIds,
  loadNotification,
  options,
  SaveHistory,
  setupGlobals,
} from "./session.fixture.ts";

type ConflictModule = typeof import("../../../src/downloads/conflict-resolution.ts");

const loadConflict = (): Promise<ConflictModule> =>
  import("../../../src/downloads/conflict-resolution.ts");

const historyStatuses = () =>
  vi.mocked(SaveHistory.setHistoryStatus).mock.calls.map((call: unknown[]) => call[1]);

describe("deltas of a download checked for an existing file", () => {
  let sessionStore: Record<string, any>;
  let onChanged: (delta: unknown) => Promise<void>;
  let item: { id: number; state: string; filename?: string };

  beforeEach(async () => {
    vi.resetModules();
    sessionStore = {};
    item = { id: 31, state: "complete", filename: "/dl/e2e/a(1).png" };
    setupGlobals(sessionStore, () => [item]);
    await loadNotification();
    Object.assign(options, { notifyOnSuccess: true, notifyOnFailure: true, promptOnFailure: true });
    vi.spyOn(SaveHistory, "setHistoryStatus").mockResolvedValue(undefined);
    [[onChanged]] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls as any;
  });

  const adopt = async (conflictCheck: string) => {
    const { mergeTrackedDownload } = await import("../../../src/downloads/expected-downloads.ts");
    await mergeTrackedDownload(31, {
      adopted: true,
      conflictCheck,
      historyEntryId: "h31",
      url: "https://x.example/a.png",
      filename: "e2e/a.png",
    });
  };

  // A tiny file completes before Save In has read the name Firefox chose.
  test("hold an early completion, then drop it when the save is discarded", async () => {
    const conflict = await loadConflict();
    const check = conflict.beginConflictCheck();
    await adopt(check.token);

    const delta = onChanged({ id: 31, state: { previous: "in_progress", current: "complete" } });
    await conflict.discardConflictingDownload(
      31,
      { action: "skip", historyEntryId: "h31" },
      vi.fn(),
    );
    check.settle(true);
    await delta;

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(historyStatuses()).not.toContain("complete");
    // The finished duplicate is deleted, not just forgotten.
    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(31);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 31 });
    expect(adoptedIds(sessionStore)).toEqual([]);
    expect(sessionStore.siConflictCancels).toEqual({});
  });

  // A delta can read the record before the discard removes it and only ask
  // after the check has settled; the in-memory proof still answers.
  test("a late delta of a discarded download is still recognised", async () => {
    const conflict = await loadConflict();
    const check = conflict.beginConflictCheck();
    await conflict.discardConflictingDownload(31, { action: "skip" }, vi.fn());
    check.settle(true);

    await expect(conflict.isDiscardedConflictDownload(31, check.token)).resolves.toBe(true);
    await expect(conflict.isDiscardedConflictDownload(32, check.token)).resolves.toBe(false);
  });

  test("report the save normally once the check finds no conflict", async () => {
    const conflict = await loadConflict();
    const check = conflict.beginConflictCheck();
    await adopt(check.token);

    const delta = onChanged({ id: 31, state: { previous: "in_progress", current: "complete" } });
    check.settle(false);
    await delta;

    expect(historyStatuses()).toContain("complete");
    expect(global.browser.notifications.create).toHaveBeenCalled();
  });

  // The cancel itself raises USER_CANCELED; it must not reach History, a
  // failure notification or the failure Save As prompt.
  test("ignore the cancellation the discard itself causes", async () => {
    const conflict = await loadConflict();
    const check = conflict.beginConflictCheck();
    await adopt(check.token);
    item = { id: 31, state: "interrupted" };

    let delta: Promise<void> | undefined;
    vi.mocked(global.browser.downloads.cancel).mockImplementationOnce(async () => {
      delta = onChanged({
        id: 31,
        error: { current: "USER_CANCELED" },
        state: { previous: "in_progress", current: "interrupted" },
      });
    });
    await conflict.discardConflictingDownload(31, { action: "ask" }, vi.fn());
    check.settle(true);
    await delta;

    expect(historyStatuses()).toEqual([]);
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  });

  test("a restarted background drops deltas of a duplicate its predecessor was discarding", async () => {
    sessionStore.siConflictCancels = { 31: { action: "skip", historyEntryId: "h31" } };
    await adopt("previous-instance:token");

    await onChanged({
      id: 31,
      error: { current: "USER_CANCELED" },
      state: { previous: "in_progress", current: "interrupted" },
    });

    expect(historyStatuses()).toEqual([]);
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });

  test("an inherited token without a marker is an ordinary save", async () => {
    await adopt("previous-instance:token");

    await onChanged({ id: 31, state: { previous: "in_progress", current: "complete" } });

    expect(historyStatuses()).toContain("complete");
  });
});

describe("existing-file discard", () => {
  let sessionStore: Record<string, any>;
  let state: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    sessionStore = {};
    state = "interrupted";
    setupGlobals(sessionStore, () => (state ? [{ id: 5, state }] : []));
    await loadNotification();
  });

  test("persists the intent before canceling, without a URL or path", async () => {
    const conflict = await loadConflict();
    let markerAtCancel: unknown;
    vi.mocked(global.browser.downloads.cancel).mockImplementationOnce(async () => {
      markerAtCancel = structuredClone(sessionStore.siConflictCancels);
    });

    await conflict.discardConflictingDownload(5, { action: "skip", historyEntryId: "h5" }, vi.fn());

    expect(markerAtCancel).toEqual({ 5: { action: "skip", historyEntryId: "h5" } });
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 5 });
    expect(sessionStore.siConflictCancels).toEqual({});
  });

  // Measured: a tiny file can complete first and cancel() then throws
  // "Download N is already complete"; removeFile leaves only the original.
  test("removes a duplicate that finished before the cancel landed", async () => {
    const conflict = await loadConflict();
    state = "complete";
    vi.mocked(global.browser.downloads.cancel).mockRejectedValueOnce(
      new Error("Download 5 is already complete"),
    );

    await conflict.discardConflictingDownload(5, { action: "skip" }, vi.fn());

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(5);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 5 });
  });

  test("keeps a duplicate it could not delete visible in the download list", async () => {
    const conflict = await loadConflict();
    state = "complete";
    vi.mocked(global.browser.downloads.removeFile).mockRejectedValueOnce(new Error("locked"));
    const log = vi.fn();

    await conflict.discardConflictingDownload(5, { action: "skip" }, log);

    expect(log).toHaveBeenCalledWith("existing-file duplicate removal failed", "Error: locked");
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });

  test("survives a failed state lookup and erase", async () => {
    const conflict = await loadConflict();
    vi.mocked(global.browser.downloads.search).mockRejectedValueOnce(new Error("gone"));
    vi.mocked(global.browser.downloads.erase).mockRejectedValueOnce(new Error("busy"));
    const log = vi.fn();

    await conflict.discardConflictingDownload(5, { action: "ask" }, log);

    expect(log).toHaveBeenCalledWith("existing-file duplicate lookup failed", "Error: gone");
    expect(log).toHaveBeenCalledWith("existing-file duplicate erase failed", "Error: busy");
    expect(sessionStore.siConflictCancels).toEqual({});
  });
});

describe("existing-file check", () => {
  beforeEach(async () => {
    vi.resetModules();
    setupGlobals({}, () => [{ id: 9, filename: "/dl/e2e/a(1).png" }]);
    await loadNotification();
  });

  test("finds Firefox's rename of the requested file", async () => {
    const conflict = await loadConflict();
    await expect(conflict.findNameConflict(9, "e2e/a.png", vi.fn())).resolves.toBe(
      "/dl/e2e/a(1).png",
    );
    await expect(conflict.findNameConflict(9, "e2e/b.png", vi.fn())).resolves.toBeNull();
  });

  test("fails open: an unreadable item saves as before", async () => {
    const conflict = await loadConflict();
    vi.mocked(global.browser.downloads.search).mockRejectedValueOnce(new Error("no item"));
    const log = vi.fn();

    await expect(conflict.findNameConflict(9, "e2e/a.png", log)).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith("existing-file check failed", "Error: no item");

    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([]);
    await expect(conflict.findNameConflict(9, "e2e/a.png", log)).resolves.toBeNull();
  });
});

describe("cold-start recovery of an interrupted discard", () => {
  let sessionStore: Record<string, any>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    sessionStore = {
      siDownloads: {
        41: { adopted: true, historyEntryId: "h41", conflictCheck: "dead:1" },
        42: { adopted: true, historyEntryId: "h42", conflictCheck: "dead:2" },
      },
      siConflictCancels: {
        41: { action: "skip", historyEntryId: "h41" },
        42: { action: "ask", historyEntryId: "h42" },
        // Malformed entries are dropped, never acted on.
        nope: { action: "skip" },
        43: { action: "destroy" },
        44: "skip",
      },
    };
    setupGlobals(sessionStore, (query) =>
      query.id === 41
        ? [{ id: 41, state: "in_progress" }]
        : query.id === 42
          ? [{ id: 42, state: "complete" }]
          : [],
    );
  });

  test("finishes the discard and settles only Skip's History row", async () => {
    await loadNotification();
    const conflict = await loadConflict();
    const setStatus = vi.fn(() => Promise.resolve());

    const settled = await conflict.recoverConflictCancels(setStatus, vi.fn());

    expect(settled).toEqual(new Set(["h41"]));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith("h41", "CONFLICT_SKIPPED");
    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(41);
    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(42);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 41 });
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 42 });
    expect(global.browser.downloads.cancel).not.toHaveBeenCalledWith(43);
    expect(sessionStore.siConflictCancels).toEqual({});
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("contains a History failure while settling a Skip", async () => {
    await loadNotification();
    const conflict = await loadConflict();
    const log = vi.fn();

    await conflict.recoverConflictCancels(() => Promise.reject(new Error("full")), log);

    expect(log).toHaveBeenCalledWith("existing-file skip history failed", "Error: full");
  });

  // Notification recovery runs on its own clock; it must not call an erased
  // duplicate "lost" before conflict recovery settles it.
  test("adopted-download reconciliation leaves a marked duplicate to conflict recovery", async () => {
    await loadNotification();
    vi.spyOn(SaveHistory, "setHistoryStatus").mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(historyStatuses()).not.toContain("DOWNLOAD_STATE_LOST");
    expect(historyStatuses()).not.toContain("complete");
  });

  test("reset forgets this instance's discards", async () => {
    await loadNotification();
    const conflict = await loadConflict();
    await conflict.discardConflictingDownload(7, { action: "skip" }, vi.fn());
    conflict.resetConflictResolutionState();

    await expect(conflict.isDiscardedConflictDownload(7, undefined)).resolves.toBe(false);
  });
});
