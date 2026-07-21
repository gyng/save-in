import type { SavedChange } from "../core/options-persistence.ts";

export const lowersHistoryRetention = (changes: SavedChange[] | undefined): boolean =>
  changes?.some(
    ({ name, before, after }) =>
      name === "historyRetentionLimit" &&
      Number.isFinite(Number(before)) &&
      Number.isFinite(Number(after)) &&
      Number(after) < Number(before),
  ) === true;
