import { getSession, SessionWriteState, updateSession } from "./session-state.ts";
import { StorageReader, StorageWriter } from "./storage-areas.ts";

const SESSION_KEY = "siDownloads";
const MAX_RECORDS = 50;

export type DownloadsState = {
  records: Map<any, any>;
  hydration: Promise<any> | null;
};

export const hydrateDownloads = (state: DownloadsState, storage: StorageReader | undefined) => {
  if (!state.hydration) {
    state.hydration = getSession(storage, SESSION_KEY).then((res) => {
      const stored = res[SESSION_KEY] || {};
      Object.keys(stored).forEach((id) => {
        if (!state.records.has(Number(id))) state.records.set(Number(id), stored[id]);
      });
    });
  }
  return state.hydration;
};

const capDownloads = (records) => {
  const keys = Object.keys(records);
  if (keys.length > MAX_RECORDS) delete records[keys[0]];
  return records;
};

export const mergeDownload = (
  state: DownloadsState,
  sessionWrites: SessionWriteState,
  storage: StorageWriter | undefined,
  downloadId,
  partial,
) => {
  const merged = Object.assign({}, state.records.get(downloadId), partial);
  state.records.set(downloadId, merged);
  if (state.records.size > MAX_RECORDS) state.records.delete(state.records.keys().next().value);
  return updateSession(sessionWrites, storage, SESSION_KEY, (stored) =>
    capDownloads(Object.assign({}, stored, { [downloadId]: merged })),
  );
};

export const getDownload = (
  state: DownloadsState,
  storage: StorageReader | undefined,
  downloadId,
) => {
  const inMemory = state.records.get(downloadId);
  if (inMemory) return Promise.resolve(inMemory);
  return getSession(storage, SESSION_KEY).then((res) => {
    const stored = res[SESSION_KEY];
    return (stored && stored[downloadId]) || null;
  });
};
