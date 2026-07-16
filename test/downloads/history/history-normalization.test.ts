import {
  hasLegacyDateOnlyTimestamp,
  migrateLegacyHistoryTimestamps,
  normalizeHistory,
  normalizeHistoryTimestamp,
} from "../../../src/shared/history-normalization.ts";

describe("history normalization", () => {
  test("normalizes allowlisted fields and drops malformed entries", () => {
    expect(normalizeHistory([null, { id: 4 }, { id: "ok", downloadId: 7, extra: true }])).toEqual([
      { id: "ok", downloadId: 7 },
    ]);
  });

  test("keeps the undone status through normalization", () => {
    // Undo marks entries rather than deleting them; a persisted undone entry
    // must survive the storage round-trip
    expect(normalizeHistory([{ id: "u1", status: "undone", downloadId: 3 }])).toEqual([
      { id: "u1", status: "undone", downloadId: 3 },
    ]);
  });

  test("detects and migrates legacy local date-only timestamps", () => {
    const stored = [{ id: "old", timestamp: "2024-02-29" }];
    expect(hasLegacyDateOnlyTimestamp(stored)).toBe(true);
    expect(migrateLegacyHistoryTimestamps(stored)[0]).toEqual({
      id: "old",
      timestamp: new Date(2024, 1, 29).toISOString(),
    });
  });

  test("normalizes every supported nested field and filters malformed nested values", () => {
    expect(
      normalizeHistory([
        {
          id: "full",
          timestamp: "2024-03-01T12:00:00.000Z",
          initiatedAt: "2024-03-01",
          url: "https://example.test/file.jpg",
          finalFullPath: "images/file.jpg",
          status: "complete",
          routed: true,
          observedBrowserDownload: false,
          mechanism: "downloads-api",
          downloadId: 12,
          fileSize: 42,
          info: { sourceUrl: "https://example.test/file.jpg", ignored: 7 },
          state: { info: { pageUrl: "https://example.test/", context: false } },
          menu: { id: "images", title: "Images", path: 9 },
          variables: { filename: "file.jpg", ignored: 2 },
        },
      ]),
    ).toEqual([
      {
        id: "full",
        timestamp: "2024-03-01T12:00:00.000Z",
        initiatedAt: new Date(2024, 2, 1).toISOString(),
        url: "https://example.test/file.jpg",
        finalFullPath: "images/file.jpg",
        status: "complete",
        routed: true,
        observedBrowserDownload: false,
        mechanism: "downloads-api",
        downloadId: 12,
        fileSize: 42,
        info: { sourceUrl: "https://example.test/file.jpg" },
        state: { info: { pageUrl: "https://example.test/" } },
        menu: { id: "images", title: "Images" },
        variables: { filename: "file.jpg" },
      },
    ]);
  });

  test("drops empty nested records and invalid numeric fields", () => {
    expect(
      normalizeHistory([
        {
          id: "invalid-shapes",
          info: { sourceUrl: 1 },
          state: { info: { pageUrl: false } },
          menu: { title: null },
          variables: { filename: 3 },
          downloadId: 1.5,
          fileSize: Number.POSITIVE_INFINITY,
          mechanism: "unknown",
        },
        {
          id: "negative-numbers",
          downloadId: -1,
          fileSize: -1,
        },
        {
          id: "invalid-byte-counts",
          fileSize: 1.5,
        },
        {
          id: "unsafe-byte-count",
          fileSize: Number.MAX_SAFE_INTEGER + 1,
        },
      ]),
    ).toEqual([
      { id: "invalid-shapes" },
      { id: "negative-numbers" },
      { id: "invalid-byte-counts" },
      { id: "unsafe-byte-count" },
    ]);
  });

  test("leaves invalid and already-qualified timestamps unchanged", () => {
    expect(normalizeHistoryTimestamp("2024-02-30")).toBe("2024-02-30");
    expect(normalizeHistoryTimestamp("2024-02-29T00:00:00.000Z")).toBe("2024-02-29T00:00:00.000Z");
  });

  test("handles malformed migration containers without inventing entries", () => {
    expect(normalizeHistory({ id: "not-an-array" })).toEqual([]);
    expect(hasLegacyDateOnlyTimestamp(null)).toBe(false);
    expect(hasLegacyDateOnlyTimestamp([null, { timestamp: 7 }, { timestamp: "already-utc" }])).toBe(
      false,
    );
    expect(migrateLegacyHistoryTimestamps("not-an-array")).toEqual([]);
    expect(migrateLegacyHistoryTimestamps([null, "unchanged", { timestamp: 7 }])).toEqual([
      null,
      "unchanged",
      { timestamp: 7 },
    ]);
  });
});
