import * as ActiveTransfers from "../../src/downloads/active-transfers.ts";
import { ACTIVE_TRANSFERS_SESSION_KEY } from "../../src/shared/storage-keys.ts";

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  ActiveTransfers.clearActiveTransfers();
  vi.useRealTimers();
});

test("cancels an active preparation by its history ID", () => {
  const controller = new AbortController();
  ActiveTransfers.registerActiveTransfer("h1", controller);

  expect(ActiveTransfers.cancelActiveTransfer("h1")).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancelActiveTransfer("missing")).toBe(false);
});

test("finishing an old controller does not remove its replacement", () => {
  const first = new AbortController();
  const second = new AbortController();
  ActiveTransfers.registerActiveTransfer("h1", first);
  ActiveTransfers.registerActiveTransfer("h1", second);
  ActiveTransfers.finishActiveTransfer("h1", first);

  expect(first.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancelActiveTransfer("h1")).toBe(true);
  expect(second.signal.aborted).toBe(true);
});

test("reset aborts every transfer and drains persistence", async () => {
  const publicController = new AbortController();
  const privateController = new AbortController();
  ActiveTransfers.registerActiveTransfer("h1", publicController);
  ActiveTransfers.holdTransferKeepalive(privateController);

  await ActiveTransfers.resetActiveTransfers();

  expect(publicController.signal.aborted).toBe(true);
  expect(privateController.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancelActiveTransfer("h1")).toBe(false);
  expect(browser.storage.session.set).toHaveBeenCalled();
});

test("keeps the service worker alive while a transfer is active", async () => {
  vi.useFakeTimers();
  const getPlatformInfo = vi.fn(() => Promise.resolve({ os: "win" }));
  Object.assign(globalThis.browser.runtime, { getPlatformInfo });
  const controller = new AbortController();

  ActiveTransfers.registerActiveTransfer("h1", controller);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).toHaveBeenCalled();

  ActiveTransfers.finishActiveTransfer("h1", controller);
  getPlatformInfo.mockClear();
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).not.toHaveBeenCalled();
});

test("keeps transfers alive when the host has no platform-info capability", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis.browser.runtime, { getPlatformInfo: undefined });
  const controller = new AbortController();

  ActiveTransfers.registerActiveTransfer("h1", controller);
  await vi.advanceTimersByTimeAsync(25_000);

  ActiveTransfers.finishActiveTransfer("h1", controller);
});

test("updates a registration in place and exposes only durable fields", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const controller = new AbortController();
  ActiveTransfers.registerActiveTransfer("h1", controller);
  expect(ActiveTransfers.getActiveTransfer("h1")).toEqual({ updatedAt: Date.now() });

  vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
  ActiveTransfers.registerActiveTransfer("h1", controller, {
    requestId: "request-1",
    downloadId: 7,
  });
  expect(ActiveTransfers.getActiveTransfer("h1")).toEqual({
    requestId: "request-1",
    downloadId: 7,
    updatedAt: Date.now(),
  });
  expect(ActiveTransfers.getActiveTransfer("missing")).toBeUndefined();
  expect(() => ActiveTransfers.updateActiveTransfer("missing", { downloadId: 9 })).not.toThrow();

  await vi.waitFor(() =>
    expect(browser.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [ACTIVE_TRANSFERS_SESSION_KEY]: expect.objectContaining({
          h1: expect.objectContaining({ requestId: "request-1", downloadId: 7 }),
        }),
      }),
    ),
  );
});

test("holds private transfers without persisting an identifying record", async () => {
  vi.useFakeTimers();
  const getPlatformInfo = vi.fn(() => Promise.reject(new Error("worker stopping")));
  Object.assign(globalThis.browser.runtime, { getPlatformInfo });
  const controller = new AbortController();

  ActiveTransfers.holdTransferKeepalive(controller);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).toHaveBeenCalledOnce();
  expect(browser.storage.session.set).not.toHaveBeenCalled();

  ActiveTransfers.releaseTransferKeepalive(controller);
  getPlatformInfo.mockClear();
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).not.toHaveBeenCalled();
});

test("recovers only normalized durable transfer records and removes the snapshot", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [ACTIVE_TRANSFERS_SESSION_KEY]: {
      complete: { requestId: "req", downloadId: 4, updatedAt: 10 },
      minimal: { updatedAt: 11 },
      nullish: null,
      array: [],
      missingTimestamp: { requestId: "bad" },
      nonFiniteTimestamp: { requestId: "bad", updatedAt: Number.POSITIVE_INFINITY },
      negativeTimestamp: { requestId: "bad", updatedAt: -1 },
      fractionalTimestamp: { requestId: "bad", updatedAt: 12.5 },
      unsafeTimestamp: { requestId: "bad", updatedAt: Number.MAX_SAFE_INTEGER + 1 },
      invalidDownloadId: { requestId: "req-2", downloadId: Number.NaN, updatedAt: 12 },
      fractionalDownloadId: { downloadId: 4.5, updatedAt: 13 },
      blankRequestId: { requestId: "  ", updatedAt: 14 },
      "": { requestId: "missing-history-id", updatedAt: 15 },
      "   ": { requestId: "blank-history-id", updatedAt: 16 },
    },
  });
  vi.mocked(browser.storage.session.remove).mockResolvedValue();

  await expect(ActiveTransfers.recoverActiveTransfers()).resolves.toEqual({
    complete: { requestId: "req", downloadId: 4, updatedAt: 10 },
    minimal: { updatedAt: 11 },
    invalidDownloadId: { requestId: "req-2", updatedAt: 12 },
    fractionalDownloadId: { updatedAt: 13 },
    blankRequestId: { updatedAt: 14 },
  });
  expect(browser.storage.session.remove).toHaveBeenCalledWith(ACTIVE_TRANSFERS_SESSION_KEY);
});

test.each([null, "invalid", []])("normalizes a malformed transfer snapshot %j", async (stored) => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [ACTIVE_TRANSFERS_SESSION_KEY]: stored,
  });
  vi.mocked(browser.storage.session.remove).mockResolvedValue();
  await expect(ActiveTransfers.recoverActiveTransfers()).resolves.toEqual({});
});

test("keeps the snapshot a failed read could not return", async () => {
  // Recovery reads to consume, so a read that degrades to {} and removes anyway
  // destroys the very records it could not see. Unlike the pending counter this
  // state has no second source: every interrupted transfer would keep its
  // pre-interruption status forever, and no later startup could recover it.
  vi.mocked(browser.storage.session.get).mockRejectedValue(new Error("session unavailable"));
  vi.mocked(browser.storage.session.remove).mockResolvedValue();

  await expect(ActiveTransfers.recoverActiveTransfers()).resolves.toEqual({});
  expect(browser.storage.session.remove).not.toHaveBeenCalled();
});

test("contains a failed removal instead of failing cold-start recovery", async () => {
  // recoverColdStartState awaits this, and every menu handler awaits the init
  // promise it settles. A transient remove rejection must not brick every save
  // for the rest of the worker's life; the other cold-start members all contain
  // their own storage failures the same way.
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [ACTIVE_TRANSFERS_SESSION_KEY]: { h1: { requestId: "req", updatedAt: 10 } },
  });
  vi.mocked(browser.storage.session.remove).mockRejectedValue(new Error("session unavailable"));

  await expect(ActiveTransfers.recoverActiveTransfers()).resolves.toEqual({
    h1: { requestId: "req", updatedAt: 10 },
  });
});
