// Session-scoped debug log (#159/#216): a small ring buffer in
// storage.session so entries survive MV3 service worker restarts but never
// leave the machine and clear on browser exit. Viewable from the options
// page. No-op where storage.session is unavailable.

import { sessionWriteState } from "./state.ts";
import { getSession, removeSession, updateSession } from "../shared/session-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";

import { LOG_STORAGE_KEY } from "../shared/storage-keys.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";

export type LogEntry = {
  at: string;
  message: string;
  data?: string | undefined;
};

const normalizeLogEntries = (value: unknown): LogEntry[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is LogEntry =>
          entry != null &&
          typeof entry === "object" &&
          typeof Reflect.get(entry, "at") === "string" &&
          typeof Reflect.get(entry, "message") === "string" &&
          (typeof Reflect.get(entry, "data") === "undefined" ||
            typeof Reflect.get(entry, "data") === "string"),
      )
    : [];

export const Log = {
  LIMIT: 200,

  serialize: (data: unknown): string | undefined => {
    if (typeof data === "undefined") {
      return undefined;
    }
    let s;
    try {
      s = JSON.stringify(data);
    } catch (e) {
      s = String(data);
    }
    return s && s.length > 500 ? `${s.slice(0, 500)}…` : s;
  },

  // SessionState.update serialises the read-modify-write so concurrent adds
  // don't drop entries; the ring buffer is bounded to LIMIT
  add: (message: string, data?: unknown, writeOptions: PrivateWriteOptions = {}) => {
    if (writeOptions.privateContext) return Promise.resolve();

    const entry = {
      at: new Date().toISOString(),
      message,
      data: Log.serialize(data),
    };
    return updateSession<LogEntry[]>(
      sessionWriteState,
      extensionSessionStorage,
      LOG_STORAGE_KEY,
      (stored) => [...normalizeLogEntries(stored), entry].slice(-Log.LIMIT),
    );
  },

  get: async () => {
    const res = await getSession(extensionSessionStorage, LOG_STORAGE_KEY);
    return normalizeLogEntries(res[LOG_STORAGE_KEY]);
  },

  clear: () => removeSession(extensionSessionStorage, LOG_STORAGE_KEY),
};
