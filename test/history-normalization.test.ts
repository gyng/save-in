import {
  hasLegacyDateOnlyTimestamp,
  migrateLegacyHistoryTimestamps,
  normalizeHistory,
} from "../src/background/history-normalization.ts";

describe("history normalization", () => {
  test("normalizes allowlisted fields and drops malformed entries", () => {
    expect(normalizeHistory([null, { id: 4 }, { id: "ok", downloadId: 7, extra: true }])).toEqual([
      { id: "ok", downloadId: 7 },
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
});
