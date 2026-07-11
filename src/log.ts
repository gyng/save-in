/* eslint-disable no-unused-vars */

// Session-scoped debug log (#159/#216): a small ring buffer in
// storage.session so entries survive MV3 service worker restarts but never
// leave the machine and clear on browser exit. Viewable from the options
// page. No-op where storage.session is unavailable.

import { SessionState } from "./background-state.ts";

const LOG_STORAGE_KEY = "si-log";

export const Log = {
  LIMIT: 200,

  serialize: (data) => {
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
  add: (message, data) => {
    const entry = {
      at: new Date().toISOString(),
      message,
      data: Log.serialize(data),
    };
    return SessionState.update(LOG_STORAGE_KEY, (entries) =>
      [...(entries || []), entry].slice(-Log.LIMIT),
    );
  },

  get: async () => {
    const res = await SessionState.get(LOG_STORAGE_KEY);
    return (res && res[LOG_STORAGE_KEY]) || [];
  },

  clear: () => SessionState.remove(LOG_STORAGE_KEY),
};
