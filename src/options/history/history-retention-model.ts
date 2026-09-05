import type { SavedChange } from "../core/options-persistence.ts";
import {
  isHistoryRetentionLimit,
  resolveHistoryRetentionLimit,
} from "../../config/history-retention.ts";

export const lowersHistoryRetention = (changes: SavedChange[] | undefined): boolean =>
  changes?.some(
    ({ name, before, after }) =>
      name === "historyRetentionLimit" &&
      isHistoryRetentionLimit(after) &&
      Number(after) < resolveHistoryRetentionLimit(before),
  ) === true;
