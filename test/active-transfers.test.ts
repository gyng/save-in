import { ActiveTransfers } from "../src/downloads/active-transfers.ts";
import { ACTIVE_TRANSFERS_SESSION_KEY } from "../src/shared/storage-keys.ts";

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  ActiveTransfers.clear();
  vi.useRealTimers();
});

test("cancels an active preparation by its history ID", () => {
  const controller = new AbortController();
  ActiveTransfers.register("h1", controller);

  expect(ActiveTransfers.cancel("h1")).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancel("missing")).toBe(false);
});

test("finishing an old controller does not remove its replacement", () => {
  const first = new AbortController();
  const second = new AbortController();
  ActiveTransfers.register("h1", first);
  ActiveTransfers.register("h1", second);
  ActiveTransfers.finish("h1", first);

  expect(first.signal.aborted).toBe(true);
  expect(ActiveTransfers.cancel("h1")).toBe(true);
  expect(second.signal.aborted).toBe(true);
});

test("keeps the service worker alive while a transfer is active", async () => {
  vi.useFakeTimers();
  const getPlatformInfo = vi.fn(() => Promise.resolve({ os: "win" }));
  Object.assign(globalThis.browser.runtime, { getPlatformInfo });
  const controller = new AbortController();

  ActiveTransfers.register("h1", controller);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).toHaveBeenCalled();

  ActiveTransfers.finish("h1", controller);
  getPlatformInfo.mockClear();
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).not.toHaveBeenCalled();
});

test("updates a registration in place and exposes only durable fields", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const controller = new AbortController();
  ActiveTransfers.register("h1", controller);
  expect(ActiveTransfers.get("h1")).toEqual({ updatedAt: Date.now() });

  vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
  ActiveTransfers.register("h1", controller, { requestId: "request-1", downloadId: 7 });
  expect(ActiveTransfers.get("h1")).toEqual({
    requestId: "request-1",
    downloadId: 7,
    updatedAt: Date.now(),
  });
  expect(ActiveTransfers.get("missing")).toBeUndefined();
  expect(() => ActiveTransfers.update("missing", { downloadId: 9 })).not.toThrow();

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

  ActiveTransfers.hold(controller);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(getPlatformInfo).toHaveBeenCalledOnce();
  expect(browser.storage.session.set).not.toHaveBeenCalled();

  ActiveTransfers.release(controller);
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

  await expect(ActiveTransfers.recover()).resolves.toEqual({
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
  await expect(ActiveTransfers.recover()).resolves.toEqual({});
});
