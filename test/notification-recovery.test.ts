import { loadNotification, adoptedIds, setupGlobals } from "./notification-session-fixture.ts";

describe("startup restore", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("does not touch persisted recovery state merely by importing the notifier", async () => {
    const sessionStore = { siPendingDownloads: 2 };
    setupGlobals(sessionStore, () => []);

    await import("../src/downloads/notification.ts");

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
        31: { adopted: true, historyEntryId: "h31", offscreenRequestId: "offscreen-31" },
        32: { adopted: true, historyEntryId: "h32" },
        33: { adopted: false, historyEntryId: "h33" },
      },
      siNotificationRecovery: {
        version: 1,
        token: "existing",
        deadline: 0,
        pendingDownloads: 0,
        adoptedDownloadIds: [31, 32, 33],
      },
    } as Record<string, any>;
    setupGlobals(sessionStore, (query) => {
      if (query.id === 31) return [{ id: 31, state: "complete", fileSize: 12 }];
      if (query.id === 32) return [{ id: 32, state: "complete", fileSize: 0, totalBytes: 9 }];
      return [{ id: 33, state: "complete", fileSize: 4 }];
    });

    await loadNotification();
    const { OffscreenClient } = await import("../src/platform/offscreen-client.ts");
    vi.spyOn(OffscreenClient, "release").mockRejectedValue(new Error("already released"));
    const { downloadPorts } = await import("../src/downloads/ports.ts");
    const setStatus = vi.spyOn(downloadPorts.history, "setStatus");
    await vi.advanceTimersByTimeAsync(0);

    expect(setStatus).toHaveBeenCalledWith("h31", "complete", 31, 12);
    expect(setStatus).toHaveBeenCalledWith("h32", "complete", 32, 9);
    expect(setStatus).not.toHaveBeenCalledWith("h33", expect.anything(), expect.anything());
    expect(OffscreenClient.release).toHaveBeenCalledWith("offscreen-31");
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
    const { sessionWriteState } = await import("../src/downloads/state.ts");
    await vi.waitFor(() => expect(sessionWriteState.queues.has("siPendingDownloads")).toBe(true));
    const newerQueue = Promise.resolve();
    sessionWriteState.queues.set("siPendingDownloads", newerQueue);
    releaseRead();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionWriteState.queues.get("siPendingDownloads")).toBe(newerQueue);
  });
});
