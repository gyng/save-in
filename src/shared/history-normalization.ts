// Deliberately shared, not feature-owned: background/history.ts and
// options/history/history-panel.ts both normalize history entries through
// this module. options/ may not import background/ implementations
// (scripts/check-import-cycles.js), and the reverse has never been legal
// either — options talks to background only through runtime.sendMessage
// (AGENTS.md) — so this stays here rather than moving into either owner
// (docs/CODE-ORGANIZATION.md Phase 3.1).
import type { HistoryEntry } from "./history-types.ts";
import { isStringKeyedRecord, isStringMember } from "./util.ts";

const HISTORY_MECHANISMS = [
  "downloads-api",
  "fetch-downloads-api",
  "browser-download",
  "firefox-replacement",
] as const satisfies readonly NonNullable<HistoryEntry["mechanism"]>[];

const normalizeHistoryInfo = (value: unknown) => {
  if (!isStringKeyedRecord(value)) return undefined;
  const info: NonNullable<HistoryEntry["info"]> = {};
  for (const key of ["sourceUrl", "pageUrl", "context"] as const) {
    if (typeof value[key] === "string") info[key] = value[key];
  }
  return Object.keys(info).length ? info : undefined;
};

const normalizeStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isStringKeyedRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const LEGACY_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const normalizeHistoryTimestamp = (value: string): string => {
  const match = value.match(LEGACY_DATE_ONLY);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localMidnight = new Date(year, month, day);
  if (
    localMidnight.getFullYear() !== year ||
    localMidnight.getMonth() !== month ||
    localMidnight.getDate() !== day
  ) {
    return value;
  }
  return localMidnight.toISOString();
};

export const normalizeHistoryEntry = (value: unknown): HistoryEntry | null => {
  if (!isStringKeyedRecord(value) || (value.id !== undefined && typeof value.id !== "string"))
    return null;

  const entry: HistoryEntry = {};
  for (const key of ["id", "status", "timestamp", "initiatedAt", "url", "finalFullPath"] as const) {
    if (typeof value[key] === "string") {
      entry[key] =
        key === "timestamp" || key === "initiatedAt"
          ? normalizeHistoryTimestamp(value[key])
          : value[key];
    }
  }
  for (const key of ["routed", "observedBrowserDownload"] as const) {
    if (typeof value[key] === "boolean") entry[key] = value[key];
  }
  if (isStringMember(HISTORY_MECHANISMS, value.mechanism)) {
    entry.mechanism = value.mechanism;
  }
  if (
    typeof value.downloadId === "number" &&
    Number.isSafeInteger(value.downloadId) &&
    value.downloadId >= 0
  ) {
    entry.downloadId = value.downloadId;
  }
  if (typeof value.downloadStartTime === "string" && value.downloadStartTime.length > 0) {
    entry.downloadStartTime = value.downloadStartTime;
  }
  for (const key of ["rerouteOf", "rerouteTo"] as const) {
    if (typeof value[key] === "string" && value[key].length > 0) {
      entry[key] = value[key];
    }
  }
  if (
    typeof value.fileSize === "number" &&
    Number.isSafeInteger(value.fileSize) &&
    value.fileSize >= 0
  ) {
    entry.fileSize = value.fileSize;
  }
  const info = normalizeHistoryInfo(value.info);
  if (info) entry.info = info;
  if (isStringKeyedRecord(value.state)) {
    const stateInfo = normalizeHistoryInfo(value.state.info);
    if (stateInfo) entry.state = { info: stateInfo };
  }
  if (isStringKeyedRecord(value.menu)) {
    const menu: NonNullable<HistoryEntry["menu"]> = {};
    for (const key of ["id", "title", "path"] as const) {
      if (typeof value.menu[key] === "string") menu[key] = value.menu[key];
    }
    if (Object.keys(menu).length) entry.menu = menu;
  }
  const variables = normalizeStringRecord(value.variables);
  if (variables) entry.variables = variables;
  return entry;
};

export const normalizeHistory = (value: unknown): HistoryEntry[] =>
  Array.isArray(value)
    ? value.map(normalizeHistoryEntry).filter((entry): entry is HistoryEntry => entry != null)
    : [];

export const hasLegacyDateOnlyTimestamp = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.some(
    (entry) =>
      isStringKeyedRecord(entry) &&
      [entry.timestamp, entry.initiatedAt].some(
        (timestamp) =>
          typeof timestamp === "string" && normalizeHistoryTimestamp(timestamp) !== timestamp,
      ),
  );

export const migrateLegacyHistoryTimestamps = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value.map((entry) => {
        if (!isStringKeyedRecord(entry)) return entry;
        const migrated = { ...entry };
        for (const key of ["timestamp", "initiatedAt"] as const) {
          if (typeof migrated[key] === "string") {
            migrated[key] = normalizeHistoryTimestamp(migrated[key]);
          }
        }
        return migrated;
      })
    : [];
