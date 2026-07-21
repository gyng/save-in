import { getSession, updateSession } from "../shared/session-state.ts";
import type { SessionWriteState } from "../shared/session-state.ts";
import type { StorageReader, StorageWriter } from "../shared/storage-types.ts";
import { DOWNLOADS_SESSION_KEY } from "../shared/storage-keys.ts";
import type { ConflictAction } from "../shared/constants.ts";
import type { SourceSidecarRequest } from "./download-types.ts";
import { isDataUrl } from "../shared/data-url.ts";
import { shouldPersistActivity } from "../config/options-data.ts";

const MAX_INACTIVE_RECORDS = 50;

export type PendingHistoryMove = {
  historyId: string;
  downloadId: number;
  startTime?: string | undefined;
  filename?: string | undefined;
};

export type DownloadRecord = {
  url?: string | undefined;
  pageUrl?: string | undefined;
  filename?: string | undefined;
  currentFilename?: string | undefined;
  conflictAction?: ConflictAction | undefined;
  viaFetch?: boolean | undefined;
  retried?: boolean | undefined;
  allowOriginalUrlFallback?: boolean | undefined;
  observedBrowserDownload?: boolean | undefined;
  adopted?: boolean | undefined;
  sourceSidecar?: boolean | undefined;
  // Whether Chrome's onDeterminingFilename actually applied a rule to this
  // ordinary browser download. That answer only exists after onCreated has
  // written the History row, so it rides the record until a later delta can
  // put it on the row. Absent means no, which is what a record written before
  // this existed should mean.
  browserDownloadRouted?: boolean | undefined;
  // Whether this download's outcome may be reported to a webhook, decided when
  // it started and persisted as the decision rather than recomputed from the
  // privacy state. Private records exist only under the explicit persistence
  // opt-in, but the decision still fails closed when older records lack it.
  webhookEligible?: boolean | undefined;
  pendingSourceSidecar?: SourceSidecarRequest | undefined;
  historyEntryId?: string | undefined;
  offscreenRequestId?: string | undefined;
  pendingHistoryMove?: PendingHistoryMove | undefined;
  // Persisted only when the user explicitly allows private activity storage.
  // Keeping the marker is what lets a rehydrated record preserve every other
  // private boundary (webhooks, credentialed fetches, and diagnostics policy).
  privateContext?: boolean | undefined;
};

type PersistedDownloadRecord = DownloadRecord;
export type DownloadRecordUpdate = Partial<DownloadRecord>;

export const isPrivateDownloadRecord = (record: Partial<DownloadRecord>): boolean =>
  record.privateContext === true;

export type DownloadsState = {
  records: Map<number, DownloadRecord>;
  hydration: Promise<void> | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const normalizeSourceSidecarRequest = (value: unknown): SourceSidecarRequest | undefined => {
  if (!isObject(value) || typeof value.sourceUrl !== "string") return undefined;
  const optional = ["title", "pageUrl", "menuItemId", "menuItemTitle"] as const;
  if (optional.some((key) => value[key] !== undefined && typeof value[key] !== "string")) {
    return undefined;
  }
  const request: SourceSidecarRequest = { sourceUrl: value.sourceUrl };
  optional.forEach((key) => {
    const item = value[key];
    if (typeof item === "string") request[key] = item;
  });
  return request;
};

const normalizePendingHistoryMove = (value: unknown): PendingHistoryMove | undefined => {
  if (
    !isObject(value) ||
    typeof value.historyId !== "string" ||
    value.historyId.length === 0 ||
    typeof value.downloadId !== "number" ||
    !Number.isSafeInteger(value.downloadId) ||
    value.downloadId < 0
  ) {
    return undefined;
  }
  if (
    (value.startTime !== undefined && typeof value.startTime !== "string") ||
    (value.filename !== undefined && typeof value.filename !== "string")
  ) {
    return undefined;
  }
  return {
    historyId: value.historyId,
    downloadId: value.downloadId,
    ...(typeof value.startTime === "string" ? { startTime: value.startTime } : {}),
    ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
  };
};

function normalizeDownloadRecord(value: Partial<DownloadRecord>): PersistedDownloadRecord;
function normalizeDownloadRecord(value: unknown): PersistedDownloadRecord | null;
function normalizeDownloadRecord(value: unknown): PersistedDownloadRecord | null {
  if (!isObject(value)) return null;
  const record: PersistedDownloadRecord = {};
  const strings = [
    "url",
    "pageUrl",
    "filename",
    "currentFilename",
    "historyEntryId",
    "offscreenRequestId",
  ] as const;
  const booleans = [
    "viaFetch",
    "retried",
    "allowOriginalUrlFallback",
    "observedBrowserDownload",
    "adopted",
    "sourceSidecar",
    "webhookEligible",
    "browserDownloadRouted",
  ] as const;
  strings.forEach((key) => {
    const item = value[key];
    // A data: URL is the complete payload (up to 2 MiB for automatic saves).
    // Never mirror it into storage.session or rehydrate a legacy copy.
    // Non-HTTP records cannot use original-URL retry, and filename/path
    // evidence still anchors undo.
    if (typeof item === "string" && !(key === "url" && isDataUrl(item))) record[key] = item;
  });
  booleans.forEach((key) => {
    if (typeof value[key] === "boolean") record[key] = value[key];
  });
  if (value.privateContext === true) record.privateContext = true;
  if (
    value.conflictAction === "uniquify" ||
    value.conflictAction === "overwrite" ||
    value.conflictAction === "prompt"
  ) {
    record.conflictAction = value.conflictAction;
  }
  const pendingSourceSidecar = normalizeSourceSidecarRequest(value.pendingSourceSidecar);
  if (pendingSourceSidecar) record.pendingSourceSidecar = pendingSourceSidecar;
  const pendingHistoryMove = normalizePendingHistoryMove(value.pendingHistoryMove);
  if (pendingHistoryMove) record.pendingHistoryMove = pendingHistoryMove;
  return record;
}

const unwrapDownloadRecords = (value: unknown): unknown =>
  isObject(value) && value.version === 1 && isObject(value.records) ? value.records : value;

const normalizeDownloadRecords = (value: unknown): Record<string, PersistedDownloadRecord> =>
  Object.fromEntries(storedDownloadEntries(value).map(([id, record]) => [id, record]));

const preserveDownloadStorageShape = (
  stored: unknown,
  records: Record<string, PersistedDownloadRecord>,
): unknown =>
  isObject(stored) && stored.version === 1 && isObject(stored.records)
    ? { version: 1, records }
    : records;

const storedDownloadEntries = (value: unknown): Array<[number, PersistedDownloadRecord]> => {
  const records = unwrapDownloadRecords(value);
  if (!isObject(records)) return [];
  const entries = Object.entries(records).flatMap(
    ([id, candidate]): Array<[number, PersistedDownloadRecord]> => {
      if (!/^(0|[1-9]\d*)$/.test(id) || !Number.isSafeInteger(Number(id))) return [];
      const record = normalizeDownloadRecord(candidate);
      return record ? [[Number(id), record]] : [];
    },
  );
  const active = entries.filter(([, record]) => record.adopted || record.observedBrowserDownload);
  const inactive = entries.filter(
    ([, record]) => !record.adopted && !record.observedBrowserDownload,
  );
  // Partitioning decides what survives, sorting decides what "oldest" means.
  // The memory cap reads Map insertion order and the stored cap reads object
  // keys, which the engine always gives back in numeric order for these ids —
  // so seeding active-first would leave an active record in the Map's oldest
  // slot, and the two caps would drop different records the moment it went
  // inactive. Ordering the seed by id is what makes them agree.
  return [...active, ...inactive.slice(-MAX_INACTIVE_RECORDS)].toSorted(([a], [b]) => a - b);
};

export const hydrateDownloads = (state: DownloadsState, storage: StorageReader | undefined) => {
  if (!state.hydration) {
    state.hydration = getSession(storage, DOWNLOADS_SESSION_KEY).then((res) => {
      storedDownloadEntries(res[DOWNLOADS_SESSION_KEY]).forEach(([id, record]) => {
        if (!state.records.has(id)) state.records.set(id, record);
      });
    });
  }
  return state.hydration;
};

const capDownloads = (records: Record<string, PersistedDownloadRecord>) => {
  const inactiveKeys = Object.keys(records).filter(
    (key) => !records[key]?.adopted && !records[key]?.observedBrowserDownload,
  );
  inactiveKeys
    .slice(0, Math.max(0, inactiveKeys.length - MAX_INACTIVE_RECORDS))
    .forEach((key) => delete records[key]);
  return records;
};

export const mergeDownload = (
  state: DownloadsState,
  sessionWrites: SessionWriteState,
  storage: StorageWriter | undefined,
  downloadId: number,
  partial: DownloadRecordUpdate,
) => {
  const merged = Object.assign({}, state.records.get(downloadId), partial);
  // A data: URL is the payload and is not retryable. Expected-download state
  // owns it only while correlating the browser event; the longer-lived active
  // record needs no copy in memory or storage.
  if (merged.url && isDataUrl(merged.url)) delete merged.url;
  state.records.set(downloadId, merged);
  const inactiveIds = [...state.records]
    .filter(([, record]) => !record.adopted && !record.observedBrowserDownload)
    .map(([id]) => id);
  inactiveIds
    .slice(0, Math.max(0, inactiveIds.length - MAX_INACTIVE_RECORDS))
    .forEach((id) => state.records.delete(id));
  return updateSession<unknown>(sessionWrites, storage, DOWNLOADS_SESSION_KEY, (stored) => {
    const records = normalizeDownloadRecords(stored);
    if (!shouldPersistActivity(merged.privateContext === true)) delete records[downloadId];
    else {
      records[downloadId] = normalizeDownloadRecord(merged);
    }
    capDownloads(records);
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
  return getSession(storage, DOWNLOADS_SESSION_KEY).then((res) => {
    const stored = unwrapDownloadRecords(res[DOWNLOADS_SESSION_KEY]);
    const record = isObject(stored) ? stored[downloadId] : undefined;
    return normalizeDownloadRecord(record);
  });
};
