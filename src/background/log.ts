// Session-scoped debug log: a small ring buffer in storage.session so entries
// survive MV3 service worker restarts but never leave the machine and clear on
// browser exit. Viewable from the options page. No-op where storage.session is
// unavailable. This is a log of the extension's own behaviour; the log of saved
// files that #159/#216 asked for is History (see background/history.ts).

import { sessionWriteState } from "./application-state.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
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

export const LOG_LIMIT = 200;

export const serializeLogData = (data: unknown): string | undefined => {
  if (typeof data === "undefined") {
    return undefined;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(data);
  } catch {
    try {
      serialized = String(data);
    } catch {
      serialized = "[Unserializable]";
    }
  }
  return serialized && serialized.length > 500 ? `${serialized.slice(0, 500)}…` : serialized;
};

// SessionState.update serialises the read-modify-write so concurrent adds
// don't drop entries; the ring buffer is bounded to LOG_LIMIT
export const addLogEntry = (
  message: string,
  data?: unknown,
  writeOptions: PrivateWriteOptions = {},
) => {
  if (writeOptions.privateContext) return Promise.resolve();

  const entry = {
    at: new Date().toISOString(),
    message,
    data: serializeLogData(data),
  };
  return updateSession<LogEntry[]>(
    sessionWriteState,
    extensionSessionStorage,
    LOG_STORAGE_KEY,
    (stored) => [...normalizeLogEntries(stored), entry].slice(-LOG_LIMIT),
  );
};

export const getLogEntries = async () => {
  const res = await getSession(extensionSessionStorage, LOG_STORAGE_KEY);
  return normalizeLogEntries(res[LOG_STORAGE_KEY]);
};

// Clearing is an explicit user action, so surface storage failures to the
// diagnostics panel instead of reporting success for a failed removal — which
// is why this does not go through updateSession, whose contract is to swallow
// them. It still has to take that queue's turn: an add already holds the
// entries this is removing and would write them straight back.
export const clearLog = () => {
  // Every writer puts a settled promise on this queue, so waiting on it cannot
  // inherit their failure.
  const queued = sessionWriteState.queues.get(LOG_STORAGE_KEY) ?? Promise.resolve();
  const cleared = queued.then(() => extensionSessionStorage.remove(LOG_STORAGE_KEY));
  // The queue only sequences turns, so it carries a settled promise; this
  // removal's own failure still reaches the caller through `cleared`.
  sessionWriteState.queues.set(LOG_STORAGE_KEY, cleared.catch(() => {}));
  return cleared;
};
