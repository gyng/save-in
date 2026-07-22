import { loadNotification, adoptedIds, setupGlobals } from "./session.fixture.ts";

describe("startup restore", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("does not touch persisted recovery state merely by importing the notifier", async () => {
    const sessionStore = { siPendingDownloads: 2 };
    setupGlobals(sessionStore, () => []);

    await import("../../../src/downloads/notification.ts");

    expect(global.browser.storage.session.get).not.toHaveBeenCalled();
  });

  test("prunes downloads that completed while the worker was dead", async () => {
    vi.useFakeTimers();
    const sessionStore = {
      siDownloads: {
        11: { adopted: true, historyEntryId: "h11" },
        12: { adopted: true, historyEntryId: "h12" },
        13: { adopted: true, historyEntryId: "h13" },
      },
    };
    setupGlobals(sessionStore, (query) => {
      if (query.id === 11) return [{ id: 11, state: "complete" }];
      if (query.id === 12) return [{ id: 12, state: "in_progress" }];
      return []; // 13 vanished entirely
    });

    await loadNotification();
    await vi.advanceTimersByTimeAsync(10000);

    // only the still-live download stays adopted; the record (and its
    // historyEntryId) is retained, just no longer watched
    expect(adoptedIds(sessionStore)).toEqual([12]);
    expect(sessionStore.siDownloads[11]!).toMatchObject({ adopted: false, historyEntryId: "h11" });
  });

  test("does not throw when storage.session is unavailable (older Firefox)", async () => {
    setupGlobals({}, () => []);
    (global.browser.storage as any).session = undefined;

    await expect(loadNotification()).resolves.toBeDefined();
  });

  test("keeps adoption when every download is still live", async () => {
    vi.useFakeTimers();
    const sessionStore = { siDownloads: { 12: { adopted: true, historyEntryId: "h12" } } };
    setupGlobals(sessionStore, () => [{ id: 12, state: "in_progress" }]);

    await loadNotification();
    await vi.advanceTimersByTimeAsync(10000);

    // A live download keeps its adoption; only the durable recovery lease is
    // written, not the download record itself.
    expect(adoptedIds(sessionStore)).toEqual([12]);
    expect(
      (global.browser.storage.session.set as ReturnType<typeof vi.fn>).mock.calls.some(
        ([update]) => "siDownloads" in update,
      ),
    ).toBe(false);
  });

  test("clears adoption when the download lookup fails", async () => {
    vi.useFakeTimers();
    const sessionStore = { siDownloads: { 21: { adopted: true } } };
    setupGlobals(sessionStore, () => []);
    (global.browser.downloads as any).search = vi.fn(() => Promise.reject(new Error("boom")));

    await loadNotification();
    await vi.advanceTimersByTimeAsync(10000);

    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("clears a stale pending count after the grace window", async () => {
    vi.useFakeTimers();
    try {
      const sessionStore = { siPendingDownloads: 3 };
      setupGlobals(sessionStore, () => []);

      await loadNotification();

      // honored immediately after startup so an in-flight download can recover
      expect(sessionStore.siPendingDownloads).toBe(3);

      // ...but a stale leak is cleared once the grace window elapses
      await vi.advanceTimersByTimeAsync(10000);
      expect(sessionStore.siPendingDownloads).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears an anonymous private-download guard after the grace window", async () => {
    vi.useFakeTimers();
    try {
      const sessionStore = { siPrivatePendingDownloads: 2 } as Record<string, any>;
      setupGlobals(sessionStore, () => []);

      await loadNotification();

      expect(sessionStore.siPrivatePendingDownloads).toBe(2);
      expect(sessionStore.siNotificationRecovery).toMatchObject({
        privatePendingDownloads: 2,
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(sessionStore.siPrivatePendingDownloads).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancels delayed recovery during an e2e worker-state reset", async () => {
    vi.useFakeTimers();
    const sessionStore = { siPendingDownloads: 3 } as Record<string, any>;
    setupGlobals(sessionStore, () => []);

    await loadNotification();
    const { resetNotificationRecoveryState } =
      await import("../../../src/downloads/notification.ts");
    await resetNotificationRecoveryState();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sessionStore.siPendingDownloads).toBe(3);
  });

  test("finishes an expired pending recovery after the worker died before its timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const sessionStore = { siPendingDownloads: 3 } as Record<string, any>;
    setupGlobals(sessionStore, () => []);

    await loadNotification();
    expect(sessionStore.siPendingDownloads).toBe(3);
    expect(sessionStore.siNotificationRecovery).toMatchObject({ pendingDownloads: 3 });

    // Suspending an MV3 background discards its timers but not storage.session.
    vi.clearAllTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
    vi.resetModules();
    setupGlobals(sessionStore, () => []);

    await loadNotification();

    expect(sessionStore.siPendingDownloads).toBe(0);
  });

  test("caps a persisted recovery deadline at one grace window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const sessionStore = {
      siPendingDownloads: 2,
      siNotificationRecovery: {
        version: 1,
        token: "future-lease",
        deadline: Date.now() + 24 * 60 * 60 * 1000,
        pendingDownloads: 2,
        adoptedDownloadIds: [],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => []);

    await loadNotification();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sessionStore.siPendingDownloads).toBe(0);
    expect(sessionStore.siNotificationRecovery).toBeUndefined();
  });

  test("does not fold newer downloads into an expired recovery lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const sessionStore = { siPendingDownloads: 1 } as Record<string, any>;
    setupGlobals(sessionStore, () => []);

    await loadNotification();
    expect(sessionStore.siNotificationRecovery).toMatchObject({ pendingDownloads: 1 });

    // A second request starts after the lease snapshot, then the worker dies
    // before its downloads.onCreated event arrives.
    sessionStore.siPendingDownloads = 2;
    vi.clearAllTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
    vi.resetModules();
    setupGlobals(sessionStore, () => []);

    await loadNotification();

    expect(sessionStore.siPendingDownloads).toBe(1);
  });

  test("finishes adopted-record recovery after the worker died before its timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const sessionStore = {
      siDownloads: { 11: { adopted: true, historyEntryId: "h11" } },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => [{ id: 11, state: "complete" }]);

    await loadNotification();
    expect(sessionStore.siNotificationRecovery).toMatchObject({ adoptedDownloadIds: [11] });

    vi.clearAllTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:11Z"));
    vi.resetModules();
    setupGlobals(sessionStore, () => [{ id: 11, state: "complete" }]);

    await loadNotification();
    // Startup leaves the waking onChanged task first in line.
    expect(adoptedIds(sessionStore)).toEqual([11]);
    await vi.advanceTimersByTimeAsync(0);

    expect(adoptedIds(sessionStore)).toEqual([]);
    expect(sessionStore.siNotificationRecovery).toBeUndefined();
  });

  test("replaces malformed recovery metadata instead of trusting partial persisted state", async () => {
    vi.useFakeTimers();
    const sessionStore = {
      siPendingDownloads: 2,
      siNotificationRecovery: {
        version: 2,
        token: "old",
        deadline: Number.POSITIVE_INFINITY,
        adoptedDownloadIds: "invalid",
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => []);

    await loadNotification();

    expect(sessionStore.siNotificationRecovery).toMatchObject({
      version: 1,
      pendingDownloads: 2,
      adoptedDownloadIds: [],
    });
  });

  test("reconciles completed history bytes and releases offscreen content", async () => {
    vi.useFakeTimers();
    const sessionStore = {
      siDownloads: {
        31: {
          adopted: true,
          historyEntryId: "h31",
          offscreenRequestId: "offscreen-31",
          pendingHistoryMove: { historyId: "old-h31", downloadId: 30 },
          pendingSourceSidecar: { sourceUrl: "https://x/source" },
        },
        32: { adopted: true, historyEntryId: "h32" },
        33: { adopted: false, historyEntryId: "h33" },
      },
      siNotificationRecovery: {
        version: 1,
        token: "existing",
        deadline: 0,
        pendingDownloads: 0,
        // A malformed duplicate must not replay terminal cleanup twice.
        adoptedDownloadIds: [31, 31, 32, 33],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, (query) => {
      if (query.id === 31) return [{ id: 31, state: "complete", fileSize: 12 }];
      if (query.id === 32) return [{ id: 32, state: "complete", fileSize: 0, totalBytes: 9 }];
      return [{ id: 33, state: "complete", fileSize: 4 }];
    });

    await loadNotification();
    const { OffscreenClient } = await import("../../../src/platform/offscreen-client.ts");
    vi.spyOn(OffscreenClient, "release").mockRejectedValue(new Error("already released"));
    const { downloadPorts } = await import("../../../src/downloads/ports.ts");
    const setStatus = vi.spyOn(downloadPorts.history, "setStatus");
    await vi.advanceTimersByTimeAsync(0);

    expect(setStatus).toHaveBeenCalledWith("h31", "complete", 31, 12);
    expect(setStatus).toHaveBeenCalledWith("h32", "complete", 32, 9);
    expect(setStatus).not.toHaveBeenCalledWith("h33", expect.anything(), expect.anything());
    expect(global.browser.downloads.search).toHaveBeenCalledWith({ id: 31 });
    expect(
      vi.mocked(global.browser.downloads.search).mock.calls.filter(([query]) => query.id === 31),
    ).toHaveLength(1);
    expect(OffscreenClient.release).toHaveBeenCalledWith("offscreen-31");
    expect(sessionStore.siDownloads[31]).not.toHaveProperty("offscreenRequestId");
    expect(sessionStore.siDownloads[31]).not.toHaveProperty("pendingHistoryMove");
    expect(sessionStore.siDownloads[31]).not.toHaveProperty("pendingSourceSidecar");
  });

  test("recovers inactive no-row History Move intent after a terminal-event race", async () => {
    vi.useFakeTimers();
    const sessionStore = {
      siDownloads: {
        36: {
          adopted: false,
          pendingHistoryMove: {
            historyId: "old-h35",
            downloadId: 35,
            filename: "old/photo.png",
          },
        },
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, (query) =>
      query.id === 36
        ? [{ id: 36, state: "complete", fileSize: 12 }]
        : [{ id: 35, state: "complete", exists: false, filename: "/downloads/photo.png" }],
    );

    await loadNotification();
    expect(sessionStore.siNotificationRecovery.adoptedDownloadIds).toEqual([36]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 35 });
    expect(sessionStore.siDownloads[36]).not.toHaveProperty("pendingHistoryMove");
    expect(sessionStore.siDownloads[36]).toMatchObject({ adopted: false });
  });

  test("contains a recovered record disappearing during browser lookup", async () => {
    vi.useFakeTimers();
    let liveDownloadState: typeof import("../../../src/downloads/download-state-instances.ts").downloadsState;
    const sessionStore = {
      siDownloads: { 35: { adopted: true, historyEntryId: "h35" } },
      siNotificationRecovery: {
        version: 1,
        token: "existing",
        deadline: 0,
        pendingDownloads: 0,
        adoptedDownloadIds: [35],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => {
      liveDownloadState.records.delete(35);
      return [{ id: 35, state: "complete", fileSize: 12 }];
    });

    await loadNotification();
    ({ downloadsState: liveDownloadState } =
      await import("../../../src/downloads/download-state-instances.ts"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sessionStore.siNotificationRecovery).toBeUndefined();
  });

  test("retires a failed delayed recovery task", async () => {
    vi.useFakeTimers();
    const sessionStore = {
      siDownloads: { 34: { adopted: true, historyEntryId: "h34" } },
      siNotificationRecovery: {
        version: 1,
        token: "existing",
        deadline: 0,
        pendingDownloads: 0,
        adoptedDownloadIds: [34],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => [{ id: 34, state: "complete", fileSize: 12 }]);
    const { downloadPorts } = await import("../../../src/downloads/ports.ts");
    vi.spyOn(downloadPorts.history, "setStatus").mockRejectedValue(
      new Error("history unavailable"),
    );

    await loadNotification();
    await vi.advanceTimersByTimeAsync(0);
    const { resetNotificationRecoveryState } =
      await import("../../../src/downloads/notification.ts");

    await expect(resetNotificationRecoveryState()).resolves.toBeUndefined();
  });

  test("merges newly adopted downloads into an existing recovery lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const sessionStore = {
      siDownloads: { 41: { adopted: true } },
      siNotificationRecovery: {
        version: 1,
        token: "existing",
        deadline: Date.now() + 10_000,
        pendingDownloads: 0,
        adoptedDownloadIds: [],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, () => [{ id: 41, state: "in_progress" }]);

    await loadNotification();

    expect(sessionStore.siNotificationRecovery.adoptedDownloadIds).toEqual([41]);
  });

  test("does not remove a recovery lease replaced by a newer worker", async () => {
    vi.useFakeTimers();
    const sessionStore = { siPendingDownloads: 1 } as Record<string, any>;
    setupGlobals(sessionStore, () => []);
    await loadNotification();
    sessionStore.siNotificationRecovery = {
      ...sessionStore.siNotificationRecovery,
      token: "new-worker",
    };

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sessionStore.siNotificationRecovery.token).toBe("new-worker");
  });

  test("does not delete a newer pending-download write queue", async () => {
    vi.useFakeTimers();
    const sessionStore = { siPendingDownloads: 1 } as Record<string, any>;
    setupGlobals(sessionStore, () => []);
    await loadNotification();
    let releaseRead!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const originalGet = vi.mocked(global.browser.storage.session.get).getMockImplementation()!;
    vi.mocked(global.browser.storage.session.get).mockImplementation(async (key) => {
      if (key === "siPendingDownloads") await pendingRead;
      return originalGet(key);
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const { sessionWriteState } =
      await import("../../../src/downloads/download-state-instances.ts");
    await vi.waitFor(() => expect(sessionWriteState.queues.has("siPendingDownloads")).toBe(true));
    const newerQueue = Promise.resolve();
    sessionWriteState.queues.set("siPendingDownloads", newerQueue);
    releaseRead();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionWriteState.queues.get("siPendingDownloads")).toBe(newerQueue);
  });

  // 232a5887 stopped updateSession rebasing a read-modify-write onto getSession's
  // degraded {}. This is the same read-modify-write written out by hand, so it
  // needs the same rule: a rejected read of the count made the minuend 0, and
  // the write still landed, erasing every download the recovery did not account
  // for. The count cannot be recomputed from a read that failed, so the write is
  // skipped and the stored value left for the next pass to reconcile.
  test("a failed pending read leaves the pending counter alone", async () => {
    const sessionStore: Record<string, any> = {
      siPendingDownloads: 5,
      siNotificationRecovery: {
        version: 1,
        token: "tok",
        deadline: Date.now() - 1,
        pendingDownloads: 3,
        adoptedDownloadIds: [],
      },
    };
    setupGlobals(sessionStore, () => []);
    const originalGet = vi.mocked(global.browser.storage.session.get).getMockImplementation()!;
    vi.mocked(global.browser.storage.session.get).mockImplementation((key: any) =>
      key === "siPendingDownloads"
        ? Promise.reject(new Error("session read failed"))
        : originalGet(key),
    );

    await loadNotification();

    // Five were pending; three belong to this recovery. Rebasing onto the failed
    // read wrote max(0, 0 - 3) and lost the other two.
    expect(sessionStore.siPendingDownloads).toBe(5);
  });
});
