import { OPTION_DEFAULTS } from "./option-defaults.ts";

export const isHistoryRetentionLimit = (value: unknown): value is string | number => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "")
    return false;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 && count <= 10000;
};

export const resolveHistoryRetentionLimit = (value: unknown): number =>
  isHistoryRetentionLimit(value) ? Number(value) : OPTION_DEFAULTS.historyRetentionLimit;
