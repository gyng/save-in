/* eslint-disable no-unused-vars */

// Session-scoped debug log (#159/#216): a small ring buffer in
// storage.session so entries survive MV3 service worker restarts but never
// leave the machine and clear on browser exit. Viewable from the options
// page. No-op where storage.session is unavailable.

import { BackgroundState } from "./background-state.ts";
import { getSession, removeSession, updateSession } from "./session-state.ts";
import { extensionSessionStorage } from "./storage-areas.ts";

const LOG_STORAGE_KEY = "si-log";

export type LogEntry = {
  at: string;
  message: string;
  data?: string;
};

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
  add: (message: string, data?: unknown) => {
    const entry = {
      at: new Date().toISOString(),
      message,
      data: Log.serialize(data),
    };
    return updateSession<LogEntry[]>(
      BackgroundState.sessionWrites,
      extensionSessionStorage,
      LOG_STORAGE_KEY,
      (entries) => [...(entries || []), entry].slice(-Log.LIMIT),
    );
  },

  get: async () => {
    const res = await getSession<LogEntry[]>(extensionSessionStorage, LOG_STORAGE_KEY);
    return (res && res[LOG_STORAGE_KEY]) || [];
  },

  clear: () => removeSession(extensionSessionStorage, LOG_STORAGE_KEY),
};
