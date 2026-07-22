import { webExtensionApi } from "../platform/web-extension-api.ts";
import { options, shouldPersistActivity } from "../config/options-data.ts";
import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";
import {
  HISTORY_ENTRY_STORAGE_PREFIX,
  HISTORY_INDEX_CHUNK_STORAGE_PREFIX,
  HISTORY_INDEX_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
} from "../shared/storage-keys.ts";
import {
  migrateLegacyHistoryTimestamps,
  normalizeHistory,
  normalizeHistoryEntry,
} from "../shared/history-normalization.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound.
export const HISTORY_LIMIT = 10000;

const HISTORY_STORE_VERSION = 1;
const HISTORY_INDEX_CHUNK_SIZE = 128;
const HISTORY_ENTRY_READ_BATCH_SIZE = HISTORY_INDEX_CHUNK_SIZE;

type HistoryIndex = {
  version: typeof HISTORY_STORE_VERSION;
  firstChunk: number;
  nextChunk: number;
  length: number;
  // Optional so indexes written before 4.1 remain valid. The first retention
  // pass derives it once; later completions can avoid rereading every entry.
  terminalCount?: number;
};

const recordHistoryFailure = (
  operation: "read" | "write" | "remove" | "migrate",
  error: unknown,
): void => {
  recordPersistenceFailure({ area: "local", operation, key: HISTORY_STORAGE_KEY }, error);
};

const historyEntryStorageKey = (key: string): string => `${HISTORY_ENTRY_STORAGE_PREFIX}${key}`;
const historyIndexChunkStorageKey = (chunk: number): string =>
  `${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}${chunk}`;

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && typeof value === "number" && value >= 0;

const normalizeHistoryIndex = (value: unknown): HistoryIndex | null => {
  if (!isStringKeyedRecord(value) || value.version !== HISTORY_STORE_VERSION) return null;
  const { firstChunk, nextChunk, length } = value;
  if (
    !isNonnegativeSafeInteger(firstChunk) ||
    !isNonnegativeSafeInteger(nextChunk) ||
    !isNonnegativeSafeInteger(length) ||
    firstChunk > nextChunk ||
    (length > 0 && firstChunk === nextChunk) ||
    length > HISTORY_LIMIT
  ) {
    return null;
  }
  const terminalCount = isNonnegativeSafeInteger(value.terminalCount)
    ? Math.min(value.terminalCount, length)
    : undefined;
  return {
    version: HISTORY_STORE_VERSION,
    firstChunk,
    nextChunk,
    length,
    ...(terminalCount === undefined ? {} : { terminalCount }),
  };
};

const storageSnapshot = async (keys: string[] | null): Promise<Record<string, unknown>> => {
  const stored = await webExtensionApi.storage.local.get(keys);
  return isStringKeyedRecord(stored) ? stored : {};
};

const rootStorageSnapshot = (): Promise<Record<string, unknown>> =>
  storageSnapshot([HISTORY_INDEX_STORAGE_KEY, HISTORY_STORAGE_KEY]);

const readShardedHistory = async (
  index: HistoryIndex,
  onlyId?: string,
): Promise<HistoryEntry[]> => {
  if (index.length === 0) return [];
  const chunkKeys = Array.from({ length: index.nextChunk - index.firstChunk }, (_, offset) =>
    historyIndexChunkStorageKey(index.firstChunk + offset),
  );
  const chunks = await storageSnapshot(chunkKeys);
  const locators = chunkKeys
    .flatMap((chunkKey) => {
      const chunk = chunks[chunkKey];
      return Array.isArray(chunk)
        ? chunk.filter((key): key is string => typeof key === "string")
        : [];
    })
    .slice(-index.length);
  const selectedLocators =
    onlyId === undefined ? locators : locators.includes(onlyId) ? [onlyId] : [];
  if (selectedLocators.length === 0) return [];
  const entryKeys = selectedLocators.map(historyEntryStorageKey);
  const stored = await storageSnapshot(entryKeys);
  const history: HistoryEntry[] = [];
  for (const entryKey of entryKeys) {
    const entry = normalizeHistoryEntry(stored[entryKey]);
    if (entry) history.push(entry);
  }
  return history;
};

// Convert the legacy monolithic array in one storage transaction. The same
// set replaces that large value with an empty array while adding the shards,
// so Chrome's storage quota never has to accommodate two complete copies.
// The index is authoritative only after the transaction succeeds; a failed
// migration leaves the legacy value readable and can be retried safely.
const migrateLegacyHistory = async (legacyValue: unknown[]): Promise<HistoryIndex> => {
  const legacy = migrateLegacyHistoryTimestamps(legacyValue).slice(-HISTORY_LIMIT);
  const writes: Record<string, unknown> = { [HISTORY_STORAGE_KEY]: [] };
  const keys: string[] = [];
  const usedKeys = new Set<string>();
  let terminalCount = 0;

  legacy.forEach((rawEntry, index) => {
    const normalized = normalizeHistoryEntry(rawEntry);
    if (!normalized) return;
    const preferred = typeof normalized.id === "string" ? normalized.id : `legacy-${index}`;
    let key = preferred;
    if (usedKeys.has(key)) key = `${preferred}-legacy-${index}`;
    usedKeys.add(key);
    keys.push(key);
    if (normalized.status !== "pending") terminalCount += 1;
    writes[historyEntryStorageKey(key)] = rawEntry;
  });

  const chunks = Math.ceil(keys.length / HISTORY_INDEX_CHUNK_SIZE);
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    writes[historyIndexChunkStorageKey(chunk)] = keys.slice(
      chunk * HISTORY_INDEX_CHUNK_SIZE,
      (chunk + 1) * HISTORY_INDEX_CHUNK_SIZE,
    );
  }
  const index: HistoryIndex = {
    version: HISTORY_STORE_VERSION,
    firstChunk: 0,
    nextChunk: chunks,
    length: keys.length,
    terminalCount,
  };
  writes[HISTORY_INDEX_STORAGE_KEY] = index;
  await webExtensionApi.storage.local.set(writes);
  await webExtensionApi.storage.local.remove(HISTORY_STORAGE_KEY);
  return index;
};

const loadWritableIndex = async (
  extraKeys: string[] = [],
): Promise<{ index: HistoryIndex; snapshot: Record<string, unknown> }> => {
  const snapshot = await storageSnapshot([
    HISTORY_INDEX_STORAGE_KEY,
    HISTORY_STORAGE_KEY,
    ...extraKeys,
  ]);
  const current = normalizeHistoryIndex(snapshot[HISTORY_INDEX_STORAGE_KEY]);
  if (current) return { index: current, snapshot };
  if (Array.isArray(snapshot[HISTORY_STORAGE_KEY])) {
    return { index: await migrateLegacyHistory(snapshot[HISTORY_STORAGE_KEY]), snapshot: {} };
  }
  // Neither a valid sharded index nor a legacy array survived: there is
  // nothing left to recover locators from, so this deliberately resets to an
  // empty index rather than guessing. Any entry/chunk shards a prior,
  // unrecoverable index referenced become permanent orphans — nothing scans
  // for stray shard keys short of clearHistory()'s full-prefix sweep, which
  // is the only garbage collector for this degradation.
  return {
    index: {
      version: HISTORY_STORE_VERSION,
      firstChunk: 0,
      nextChunk: 0,
      length: 0,
      terminalCount: 0,
    },
    snapshot,
  };
};

// Serialise writes: concurrent index updates must not drop entries.
let writeQueue: Promise<unknown> = Promise.resolve(undefined);
let idCounter = 0;

// A short, process-unique id so a later setHistoryStatus can find this entry.
const nextHistoryId = (): string => {
  idCounter += 1;
  return `h${Date.now()}-${idCounter}`;
};

const pruneTerminalHistory = async (index: HistoryIndex): Promise<HistoryIndex> => {
  const limit = options.historyRetentionLimit;
  if (index.terminalCount !== undefined && index.terminalCount <= limit) return index;
  if (index.length === 0) {
    const countedIndex = { ...index, terminalCount: 0 };
    await webExtensionApi.storage.local.set({ [HISTORY_INDEX_STORAGE_KEY]: countedIndex });
    return countedIndex;
  }
  const chunkKeys = Array.from({ length: index.nextChunk - index.firstChunk }, (_, offset) =>
    historyIndexChunkStorageKey(index.firstChunk + offset),
  );
  const chunks = await storageSnapshot(chunkKeys);
  let chunksAreNormalized = true;
  const chunkLocators = chunkKeys.map((chunkKey) => {
    const chunk = chunks[chunkKey];
    if (chunk === undefined) return [];
    if (
      !Array.isArray(chunk) ||
      chunk.length > HISTORY_INDEX_CHUNK_SIZE ||
      chunk.some((key) => typeof key !== "string")
    ) {
      chunksAreNormalized = false;
    }
    return Array.isArray(chunk)
      ? chunk.filter((key): key is string => typeof key === "string")
      : [];
  });
  const allLocators = chunkLocators.flat();
  const locators = allLocators.slice(-index.length);
  const expectedRemovals =
    index.terminalCount === undefined ? undefined : Math.max(0, index.terminalCount - limit);
  const terminalLocators: string[] = [];
  let scannedAllLocators = true;
  for (let offset = 0; offset < locators.length; offset += HISTORY_ENTRY_READ_BATCH_SIZE) {
    const batch = locators.slice(offset, offset + HISTORY_ENTRY_READ_BATCH_SIZE);
    const entries = await storageSnapshot(batch.map(historyEntryStorageKey));
    for (const [batchIndex, locator] of batch.entries()) {
      const entry = normalizeHistoryEntry(entries[historyEntryStorageKey(locator)]);
      if (entry !== null && entry.status !== "pending") terminalLocators.push(locator);
      if (
        expectedRemovals !== undefined &&
        terminalLocators.length >= expectedRemovals &&
        offset + batchIndex + 1 < locators.length
      ) {
        scannedAllLocators = false;
        break;
      }
    }
    if (!scannedAllLocators) break;
  }
  const terminalCount =
    scannedAllLocators || index.terminalCount === undefined
      ? terminalLocators.length
      : index.terminalCount;
  const removalCount = Math.max(0, terminalCount - limit);
  if (removalCount === 0) {
    const countedIndex = { ...index, terminalCount };
    await webExtensionApi.storage.local.set({ [HISTORY_INDEX_STORAGE_KEY]: countedIndex });
    return countedIndex;
  }
  const removeIds = new Set(terminalLocators.slice(0, removalCount));
  const retained = locators.filter((id) => !removeIds.has(id));
  const writes: Record<string, unknown> = {};
  const obsoleteChunks: string[] = [];
  const chunkUpdates = chunkLocators.map((previous) => ({
    previous,
    retained: previous.filter((id) => !removeIds.has(id)),
  }));
  const firstRetainedChunk = chunkUpdates.findIndex(({ retained: chunk }) => chunk.length > 0);
  const lastRetainedChunk = chunkUpdates.findLastIndex(({ retained: chunk }) => chunk.length > 0);
  const retainedChunkSpan =
    firstRetainedChunk === -1 ? 0 : lastRetainedChunk - firstRetainedChunk + 1;
  const minimumChunkCount = Math.ceil(retained.length / HISTORY_INDEX_CHUNK_SIZE);
  // Sparse chunks make the common one-entry prune a one-key write. Compact
  // only when holes would make reads exceed a bounded multiple of dense form.
  const compact =
    !chunksAreNormalized ||
    allLocators.length !== index.length ||
    retainedChunkSpan > Math.max(minimumChunkCount + 8, minimumChunkCount * 2);
  let firstChunk: number;
  let nextChunk: number;
  if (compact) {
    firstChunk = index.firstChunk;
    nextChunk = firstChunk + minimumChunkCount;
    for (let offset = 0; offset < minimumChunkCount; offset += 1) {
      writes[historyIndexChunkStorageKey(firstChunk + offset)] = retained.slice(
        offset * HISTORY_INDEX_CHUNK_SIZE,
        (offset + 1) * HISTORY_INDEX_CHUNK_SIZE,
      );
    }
    obsoleteChunks.push(...chunkKeys.slice(minimumChunkCount));
  } else if (firstRetainedChunk === -1) {
    firstChunk = index.nextChunk;
    nextChunk = index.nextChunk;
    obsoleteChunks.push(...chunkKeys);
  } else {
    firstChunk = index.firstChunk + firstRetainedChunk;
    nextChunk = index.firstChunk + lastRetainedChunk + 1;
    chunkUpdates.forEach(({ previous, retained: chunk }, offset) => {
      const chunkKey = historyIndexChunkStorageKey(index.firstChunk + offset);
      if (offset < firstRetainedChunk || offset > lastRetainedChunk || chunk.length === 0) {
        if (previous.length) obsoleteChunks.push(chunkKey);
        return;
      }
      if (
        chunk.length !== previous.length ||
        chunk.some((id, position) => id !== previous[position])
      ) {
        writes[chunkKey] = chunk;
      }
    });
  }
  const nextIndex: HistoryIndex = {
    version: HISTORY_STORE_VERSION,
    firstChunk,
    nextChunk,
    length: retained.length,
    terminalCount: terminalCount - removeIds.size,
  };
  writes[HISTORY_INDEX_STORAGE_KEY] = nextIndex;
  // storage.local has no transactions, so order these for the failure mode
  // that self-heals: remove the now-unreferenced shards/chunks BEFORE writing
  // the updated index. A worker death between them leaves the OLD index
  // referencing shard keys that no longer exist; readShardedHistory already
  // tolerates a missing shard body (normalizeHistoryEntry(undefined) is
  // null, skipped) and a later prune reconciles the drift once it next
  // performs a real removal. The reverse order (set then remove, as this used
  // to be) would instead make the NEW index authoritative first, leaving the
  // stale shards permanently orphaned if the remove never ran — a silent
  // leak nothing ever garbage-collects short of Clear history.
  await webExtensionApi.storage.local.remove([
    ...Array.from(removeIds, historyEntryStorageKey),
    ...obsoleteChunks,
  ]);
  await webExtensionApi.storage.local.set(writes);
  return nextIndex;
};

// Returns the entry id synchronously (the write itself is queued) so the
// caller can update the entry's status once the download resolves.
export const addHistoryEntry = (
  entry: HistoryEntryInput,
  writeOptions: PrivateWriteOptions = {},
): string | null => {
  // Chrome and Firefox both expose the originating private context. Keep the
  // default exclusion at this final storage boundary; only the explicit user
  // opt-in admits it.
  if (!shouldPersistActivity(writeOptions.privateContext === true)) return null;

  const id = nextHistoryId();
  const withMeta: HistoryEntry = Object.assign({ id, status: "pending" }, entry);

  writeQueue = writeQueue
    .then(async () => {
      const { index } = await loadWritableIndex();
      const lastChunk =
        index.nextChunk === index.firstChunk ? index.nextChunk : index.nextChunk - 1;
      const lastChunkKey = historyIndexChunkStorageKey(lastChunk);
      const lastSnapshot = await storageSnapshot([lastChunkKey]);
      const storedLastChunk = lastSnapshot[lastChunkKey];
      let appendedChunk = Array.isArray(storedLastChunk)
        ? storedLastChunk.filter((key): key is string => typeof key === "string")
        : [];
      let nextChunk = index.nextChunk;
      let targetChunk = lastChunk;
      if (appendedChunk.length >= HISTORY_INDEX_CHUNK_SIZE) {
        appendedChunk = [];
        targetChunk = index.nextChunk;
        nextChunk = index.nextChunk + 1;
      } else if (index.nextChunk === index.firstChunk) {
        nextChunk = lastChunk + 1;
      }
      appendedChunk.push(id);

      const writes: Record<string, unknown> = {
        [historyEntryStorageKey(id)]: withMeta,
        [historyIndexChunkStorageKey(targetChunk)]: appendedChunk,
      };
      const removeKeys: string[] = [];
      let firstChunk = index.firstChunk;
      let length = index.length + 1;
      let terminalCount = index.terminalCount;
      if (length > HISTORY_LIMIT) {
        // Non-compact pruning legitimately leaves empty (deleted) chunks
        // between firstChunk and nextChunk. Skip past any such holes so the
        // cap eviction always removes a real locator/shard instead of
        // silently doing nothing while length is clamped below regardless —
        // otherwise the locator count drifts above index.length forever, and
        // the next forced compact would drop a locator without ever deleting
        // its entry shard (a permanent orphan until Clear history).
        let firstChunkKey = historyIndexChunkStorageKey(firstChunk);
        let firstSnapshot = await storageSnapshot([firstChunkKey]);
        let storedFirstChunk = firstSnapshot[firstChunkKey];
        let trimmedFirstChunk = Array.isArray(storedFirstChunk)
          ? storedFirstChunk.filter((key): key is string => typeof key === "string")
          : [];
        // Never walk into targetChunk: its storage read above happened before
        // this append was written, so re-reading it here would see a stale
        // (pre-append) snapshot, and the eviction below could then queue that
        // same chunk key for removal — clobbering the entry this very call
        // just added once the write/remove pair applies.
        while (trimmedFirstChunk.length === 0 && firstChunk + 1 < targetChunk) {
          removeKeys.push(firstChunkKey);
          firstChunk += 1;
          firstChunkKey = historyIndexChunkStorageKey(firstChunk);
          firstSnapshot = await storageSnapshot([firstChunkKey]);
          storedFirstChunk = firstSnapshot[firstChunkKey];
          trimmedFirstChunk = Array.isArray(storedFirstChunk)
            ? storedFirstChunk.filter((key): key is string => typeof key === "string")
            : [];
        }
        const removed = trimmedFirstChunk.shift();
        if (removed) {
          const removedEntryKey = historyEntryStorageKey(removed);
          removeKeys.push(removedEntryKey);
          if (terminalCount !== undefined) {
            const removedSnapshot = await storageSnapshot([removedEntryKey]);
            const removedEntry = normalizeHistoryEntry(removedSnapshot[removedEntryKey]);
            if (!removedEntry) {
              terminalCount = undefined;
            } else if (removedEntry.status !== "pending") {
              terminalCount = Math.max(0, terminalCount - 1);
            }
          }
        } else {
          terminalCount = undefined;
        }
        if (trimmedFirstChunk.length === 0) {
          removeKeys.push(firstChunkKey);
          firstChunk += 1;
        } else {
          writes[firstChunkKey] = trimmedFirstChunk;
        }
        length = HISTORY_LIMIT;
      }
      const nextIndex: HistoryIndex = {
        version: HISTORY_STORE_VERSION,
        firstChunk,
        nextChunk,
        length,
        ...(terminalCount === undefined ? {} : { terminalCount }),
      };
      writes[HISTORY_INDEX_STORAGE_KEY] = nextIndex;
      await webExtensionApi.storage.local.set(writes);
      if (removeKeys.length > 0) await webExtensionApi.storage.local.remove(removeKeys);
    })
    .catch((error) => recordHistoryFailure("write", error));

  return id;
};

// Serialised patch of one entry by id. Entries are persisted independently so
// progress and completion updates never clone or rewrite unrelated history.
const queueHistoryPatch = (
  id: string | null | undefined,
  fields: Partial<HistoryEntry> | ((entry: HistoryEntry) => Partial<HistoryEntry>),
  strict: boolean,
): Promise<unknown> => {
  if (!id) return writeQueue;

  const operation = writeQueue.then(async () => {
    const entryKey = historyEntryStorageKey(id);
    const loaded = await loadWritableIndex([entryKey]);
    if (loaded.index.length === 0) return;
    let storedEntry = loaded.snapshot[entryKey];
    if (storedEntry === undefined) {
      const latest = await storageSnapshot([entryKey]);
      storedEntry = latest[entryKey];
    }
    const entry = normalizeHistoryEntry(storedEntry);
    if (!entry) return;
    const resolved = typeof fields === "function" ? fields(entry) : fields;
    // An empty patch (a guarded write whose condition no longer holds)
    // must not rewrite the entry for nothing.
    if (Object.keys(resolved).length === 0) return;
    const merged = Object.assign({}, entry, resolved);
    // An explicitly-undefined field means "remove": Firefox's structured
    // clone would otherwise persist the key, and normalization must never
    // see a stale value in its place.
    const mergedRecord: Record<string, unknown> = merged;
    for (const key of Object.keys(resolved)) {
      if (mergedRecord[key] === undefined) delete mergedRecord[key];
    }
    const wasTerminal = entry.status !== "pending";
    const isTerminal = merged.status !== "pending";
    let nextIndex = loaded.index;
    if (wasTerminal !== isTerminal && loaded.index.terminalCount !== undefined) {
      nextIndex = {
        ...loaded.index,
        terminalCount: Math.max(0, loaded.index.terminalCount + (isTerminal ? 1 : -1)),
      };
    }
    await webExtensionApi.storage.local.set({
      [entryKey]: merged,
      ...(nextIndex === loaded.index ? {} : { [HISTORY_INDEX_STORAGE_KEY]: nextIndex }),
    });
    if (wasTerminal !== isTerminal) await pruneTerminalHistory(nextIndex);
  });
  const settled = operation.catch((error) => recordHistoryFailure("write", error));
  // The shared queue must always settle so one failed storage operation does
  // not poison later History work. Strict callers still receive the original
  // rejection when they need to withhold an irreversible side effect.
  writeQueue = settled;
  return strict ? operation : settled;
};

export const patchHistoryEntry = (
  id: string | null | undefined,
  fields: Partial<HistoryEntry> | ((entry: HistoryEntry) => Partial<HistoryEntry>),
): Promise<unknown> => queueHistoryPatch(id, fields, false);

export const patchHistoryEntryStrict = (
  id: string | null | undefined,
  fields: Partial<HistoryEntry> | ((entry: HistoryEntry) => Partial<HistoryEntry>),
): Promise<unknown> => queueHistoryPatch(id, fields, true);

const historyStatusPatch =
  (
    status: string,
    downloadId?: number,
    fileSize?: number,
  ): ((entry: HistoryEntry) => Partial<HistoryEntry>) =>
  (entry) => {
    const fields: Partial<HistoryEntry> = { status };
    if (downloadId != null) {
      fields.downloadId = downloadId;
      // Rebinding to a different browser download (the fetch-retry
      // replacement) without a fresh startTime must clear the stored one — a
      // stale time refuses undo of the very download the entry now points at.
      if (entry.downloadId != null && entry.downloadId !== downloadId) {
        fields.downloadStartTime = undefined;
      }
    }
    if (fileSize != null) fields.fileSize = fileSize;
    return fields;
  };

// Records the final outcome ("complete" or a browser error name), the browser
// download id, and the file size in bytes when known.
export const setHistoryStatus = (
  id: string | null | undefined,
  status: string,
  downloadId?: number,
  fileSize?: number,
) => patchHistoryEntry(id, historyStatusPatch(status, downloadId, fileSize));

export const setHistoryStatusStrict = (
  id: string | null | undefined,
  status: string,
  downloadId?: number,
  fileSize?: number,
) => patchHistoryEntryStrict(id, historyStatusPatch(status, downloadId, fileSize));

// Binds the browser download id to the entry as soon as the download starts,
// so the options page can poll its progress while it is still in flight.
export const setHistoryDownloadId = (
  id: string | null | undefined,
  downloadId: number,
  startTime?: string,
) =>
  patchHistoryEntry(id, (entry) => ({
    downloadId,
    // A same-id bind without a time must not clobber one already captured.
    // A different id without a time is a rebind and must clear the stale time.
    ...(startTime
      ? { downloadStartTime: startTime }
      : entry.downloadId != null && entry.downloadId !== downloadId
        ? { downloadStartTime: undefined }
        : {}),
  }));

// Late anchor backfill: applies only while the entry still points at the
// download it was scheduled for and no anchor was captured yet. A fetch retry
// may have rebound it before the original download's delayed lookup returns.
export const anchorHistoryDownloadStartTime = (
  id: string | null | undefined,
  downloadId: number,
  startTime: string,
) =>
  patchHistoryEntry(id, (entry) =>
    entry.downloadId === downloadId && entry.downloadStartTime == null
      ? { downloadStartTime: startTime }
      : {},
  );

export const getHistoryEntries = (onlyId?: string): Promise<HistoryEntry[]> => {
  // Queue the read itself, not just the wait before it: an add accepted while
  // a legacy read was in flight must land after that migration, or the stale
  // migration snapshot could replace the newly appended index.
  const task = writeQueue.then(async () => {
    let snapshot: Record<string, unknown>;
    try {
      snapshot = await rootStorageSnapshot();
    } catch (error) {
      recordHistoryFailure("read", error);
      throw error;
    }

    const index = normalizeHistoryIndex(snapshot[HISTORY_INDEX_STORAGE_KEY]);
    if (index) {
      try {
        return await readShardedHistory(index, onlyId);
      } catch (error) {
        recordHistoryFailure("read", error);
        throw error;
      }
    }

    const legacy = snapshot[HISTORY_STORAGE_KEY];
    const history = normalizeHistory(legacy);
    if (Array.isArray(legacy)) {
      try {
        await migrateLegacyHistory(legacy);
      } catch (error) {
        recordHistoryFailure("migrate", error);
      }
    }
    return onlyId === undefined ? history : history.filter(({ id }) => id === onlyId);
  });
  writeQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

export const enforceHistoryRetention = (): Promise<void> => {
  const task = writeQueue
    .catch(() => {})
    .then(async () => {
      const { index } = await loadWritableIndex();
      await pruneTerminalHistory(index);
    });
  writeQueue = task.catch((error) => recordHistoryFailure("remove", error));
  return task;
};

export const clearHistory = (): Promise<void> => {
  const task = writeQueue
    .catch(() => {})
    .then(async () => {
      const stored = await storageSnapshot(null);
      const keys = Object.keys(stored).filter(
        (key) =>
          key === HISTORY_STORAGE_KEY ||
          key === HISTORY_INDEX_STORAGE_KEY ||
          key.startsWith(HISTORY_INDEX_CHUNK_STORAGE_PREFIX) ||
          key.startsWith(HISTORY_ENTRY_STORAGE_PREFIX),
      );
      if (keys.length > 0) await webExtensionApi.storage.local.remove(keys);
    });
  writeQueue = task.catch((error) => recordHistoryFailure("remove", error));
  return task;
};

// Test seams: the write queue is module-private serialised state, so tests
// await it and inject a pre-rejected queue through these helpers.
export const flushHistoryWrites = (): Promise<unknown> => writeQueue;
export const seedHistoryWriteQueueForTest = (queue: Promise<unknown>): void => {
  writeQueue = queue;
};
