import { lowersHistoryRetention } from "../../../src/options/history/history-retention-model.ts";

test.each([undefined, null, "", false, "invalid", -1, 10001])(
  "checks a reduction against the effective default for stored value %j",
  (before) => {
    expect(lowersHistoryRetention([{ name: "historyRetentionLimit", before, after: 100 }])).toBe(
      true,
    );
  },
);

test.each([undefined, null, "", false, "invalid", -1, 1.5, 10001])(
  "does not request destructive confirmation for a rejected value %j",
  (after) => {
    expect(lowersHistoryRetention([{ name: "historyRetentionLimit", before: 100, after }])).toBe(
      false,
    );
  },
);

test.each([
  ["numeric reduction", [{ name: "historyRetentionLimit", before: 1000, after: 100 }], true],
  ["serialized reduction", [{ name: "historyRetentionLimit", before: 1000, after: "100" }], true],
  ["increase", [{ name: "historyRetentionLimit", before: 100, after: 1000 }], false],
  ["same value", [{ name: "historyRetentionLimit", before: 100, after: "100" }], false],
  ["unrelated option", [{ name: "recentDestinationCount", before: 5, after: 1 }], false],
  ["malformed value", [{ name: "historyRetentionLimit", before: 100, after: "invalid" }], false],
] as const)("detects a %s", (_label, changes, expected) => {
  expect(lowersHistoryRetention([...changes])).toBe(expected);
});
