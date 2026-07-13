import { getSession, updateSession } from "../shared/session-state.ts";
import type { SessionWriteState } from "../shared/session-state.ts";
import type { StorageReader, StorageWriter } from "../platform/storage-areas.ts";
import { DOWNLOADS_SESSION_KEY } from "../shared/storage-keys.ts";

const MAX_RECORDS = 50;

export type DownloadRecord = {
  url?: string;
  pageUrl?: string;
  filename?: string;
  currentFilename?: string;
  conflictAction?: browser.downloads.FilenameConflictAction;
  viaFetch?: boolean;
  retried?: boolean;
  allowOriginalUrlFallback?: boolean;
  observedBrowserDownload?: boolean;
  adopted?: boolean;
  historyEntryId?: string;
};

export type DownloadsState = {
  records: Map<number, DownloadRecord>;
  hydration: Promise<void> | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const normalizeDownloadRecord = (value: unknown): DownloadRecord | null => {
  if (!isObject(value)) return null;
  const record: DownloadRecord = {};
  const strings = ["url", "pageUrl", "filename", "currentFilename", "historyEntryId"] as const;
  const booleans = [
    "viaFetch",
    "retried",
    "allowOriginalUrlFallback",
    "observedBrowserDownload",
    "adopted",
  ] as const;
  strings.forEach((key) => {
    if (typeof value[key] === "string") record[key] = value[key];
  });
  booleans.forEach((key) => {
    if (typeof value[key] === "boolean") record[key] = value[key];
  });
  if (
    value.conflictAction === "uniquify" ||
    value.conflictAction === "overwrite" ||
    value.conflictAction === "prompt"
  ) {
    record.conflictAction = value.conflictAction;
  }
  return record;
};

const unwrapDownloadRecords = (value: unknown): unknown =>
  isObject(value) && value.version === 1 && isObject(value.records) ? value.records : value;

const normalizeDownloadRecords = (value: unknown): Record<string, DownloadRecord> =>
  Object.fromEntries(storedDownloadEntries(value).map(([id, record]) => [id, record]));

const preserveDownloadStorageShape = (
  stored: unknown,
  records: Record<string, DownloadRecord>,
): unknown =>
  isObject(stored) && stored.version === 1 && isObject(stored.records)
    ? { version: 1, records }
    : records;

const storedDownloadEntries = (value: unknown): Array<[number, DownloadRecord]> => {
  const records = unwrapDownloadRecords(value);
  if (!isObject(records)) return [];
  return Object.entries(records)
    .filter(
      (entry): entry is [string, DownloadRecord] =>
        /^(0|[1-9]\d*)$/.test(entry[0]) &&
        Number.isSafeInteger(Number(entry[0])) &&
        normalizeDownloadRecord(entry[1]) != null,
    )
    .slice(-MAX_RECORDS)
    .map(([id, record]) => [Number(id), normalizeDownloadRecord(record)!]);
};

export const hydrateDownloads = (state: DownloadsState, storage: StorageReader | undefined) => {
  if (!state.hydration) {
    state.hydration = getSession<Record<string, DownloadRecord>>(
      storage,
      DOWNLOADS_SESSION_KEY,
    ).then((res) => {
      storedDownloadEntries(res[DOWNLOADS_SESSION_KEY]).forEach(([id, record]) => {
        if (!state.records.has(id)) state.records.set(id, record);
      });
    });
  }
  return state.hydration;
};

const capDownloads = (records: Record<string, DownloadRecord>) => {
  const keys = Object.keys(records);
  keys.slice(0, Math.max(0, keys.length - MAX_RECORDS)).forEach((key) => delete records[key]);
  return records;
};

export const mergeDownload = (
  state: DownloadsState,
  sessionWrites: SessionWriteState,
  storage: StorageWriter | undefined,
  downloadId: number,
  partial: Partial<DownloadRecord>,
) => {
  const merged = Object.assign({}, state.records.get(downloadId), partial);
  state.records.set(downloadId, merged);
  if (state.records.size > MAX_RECORDS) {
    const oldestId = state.records.keys().next().value;
    if (oldestId !== undefined) state.records.delete(oldestId);
  }
  return updateSession<unknown>(sessionWrites, storage, DOWNLOADS_SESSION_KEY, (stored) => {
    const records = capDownloads(
      Object.assign(normalizeDownloadRecords(stored), { [downloadId]: merged }),
    );
    return preserveDownloadStorageShape(stored, records);
  });
};

export const getDownload = (
  state: DownloadsState,
  storage: StorageReader | undefined,
  downloadId: number,
): Promise<DownloadRecord | null> => {
  const inMemory = state.records.get(downloadId);
  if (inMemory) return Promise.resolve(inMemory);
  return getSession<Record<string, DownloadRecord>>(storage, DOWNLOADS_SESSION_KEY).then((res) => {
    const stored = unwrapDownloadRecords(res[DOWNLOADS_SESSION_KEY]);
    const record = isObject(stored) ? stored[downloadId] : undefined;
    return normalizeDownloadRecord(record);
  });
};
