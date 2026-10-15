// "Skip" and Firefox's emulated "Ask each time" for a file that already exists.
//
// No browser API can ask whether a file exists: DownloadItem.exists is never
// refreshed by Firefox (still true 20 s after deletion, measured on 140 and
// 158). Firefox's own uniquify does check the real disk, and the item it
// creates already carries the "name(N).ext" it chose before downloads.download
// resolves. So Save In requests the name with "uniquify", reads that answer,
// and cancels a renamed save. A tiny file can finish before the cancel lands;
// removeFile then deletes the finished duplicate, leaving only the original.
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { options } from "../config/options-data.ts";
import {
  browserConflictAction,
  conflictResolutionFor,
  type BrowserConflictAction,
  type ConflictResolution,
} from "../shared/conflict-action.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
import { CONFLICT_CANCELS_SESSION_KEY } from "../shared/storage-keys.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { sessionWriteState } from "./download-state-instances.ts";
import { removeTrackedDownload } from "./expected-downloads.ts";
import { isFirefoxUniqueRename } from "./conflict-resolution-model.ts";

export type ConflictCancel = {
  action: ConflictResolution;
  historyEntryId?: string;
};
type ConflictCancels = Record<string, ConflictCancel>;

type Logger = (message: string, data?: unknown) => unknown;

// The value handed to the browser's downloads API, which knows no "skip" and,
// on Firefox, no "prompt".
export const nativeConflictAction = (): BrowserConflictAction =>
  browserConflictAction(options.conflictAction, WEB_EXTENSION_CAPABILITIES);

export const plannedConflictResolution = (): ConflictResolution | null =>
  conflictResolutionFor(options.conflictAction, WEB_EXTENSION_CAPABILITIES);

const normalizeCancels = (value: unknown): ConflictCancels => {
  if (!isStringKeyedRecord(value)) return {};
  const cancels: ConflictCancels = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!/^(0|[1-9]\d*)$/.test(id) || !isStringKeyedRecord(entry)) continue;
    if (entry.action !== "skip" && entry.action !== "ask") continue;
    cancels[id] = {
      action: entry.action,
      ...(typeof entry.historyEntryId === "string" ? { historyEntryId: entry.historyEntryId } : {}),
    };
  }
  return cancels;
};

const readCancels = async (): Promise<ConflictCancels> =>
  normalizeCancels(
    (await getSession(extensionSessionStorage, CONFLICT_CANCELS_SESSION_KEY))[
      CONFLICT_CANCELS_SESSION_KEY
    ],
  );

const writeCancel = (downloadId: number, cancel: ConflictCancel | undefined) =>
  updateSession(
    sessionWriteState,
    extensionSessionStorage,
    CONFLICT_CANCELS_SESSION_KEY,
    (value) => {
      const cancels = normalizeCancels(value);
      if (cancel) cancels[String(downloadId)] = cancel;
      else delete cancels[String(downloadId)];
      return cancels;
    },
  );

// A delta for a checked download must not be reported until the check has
// decided: a small file can complete before Save In has read its name, and that
// completion would otherwise publish a success, a History row and a webhook.
const pendingChecks = new Map<string, Promise<boolean>>();
// Ids this background discarded. In-memory proof for the deltas the cancel
// itself produces; the session copy covers a restarted background.
const discardedIds = new Set<number>();
// Tokens carry the background instance that issued them: for this instance the
// in-memory state above is complete, so only an inherited token pays for a
// session read.
const INSTANCE = crypto.randomUUID();

export const beginConflictCheck = (): { token: string; settle: (discarded: boolean) => void } => {
  const token = `${INSTANCE}:${crypto.randomUUID()}`;
  const settlers: Array<(discarded: boolean) => void> = [];
  pendingChecks.set(
    token,
    new Promise<boolean>((resolve) => {
      settlers.push(resolve);
    }),
  );
  return {
    token,
    settle: (discarded) => {
      settlers.forEach((resolve) => resolve(discarded));
      pendingChecks.delete(token);
    },
  };
};

// True when a delta belongs to a save Save In discarded on purpose, so the
// caller must neither report nor retry it.
export const isDiscardedConflictDownload = async (
  downloadId: number,
  token: string | undefined,
): Promise<boolean> => {
  const pending = token ? pendingChecks.get(token) : undefined;
  if (pending && (await pending)) return true;
  if (discardedIds.has(downloadId)) return true;
  if (!token || token.startsWith(`${INSTANCE}:`)) return false;
  return (await readCancels())[String(downloadId)] !== undefined;
};

// The name Firefox chose when it renamed the save because the requested file
// exists, or null. Any failure to read the answer means "no conflict": the
// save proceeds exactly as it would have without this feature.
export const findNameConflict = async (
  downloadId: number,
  requestedPath: string,
  log: Logger,
): Promise<string | null> => {
  try {
    const [item] = await webExtensionApi.downloads.search({ id: downloadId });
    return typeof item?.filename === "string" && isFirefoxUniqueRename(requestedPath, item.filename)
      ? item.filename
      : null;
  } catch (error) {
    log("existing-file check failed", String(error));
    return null;
  }
};

const removeConflictingDownload = async (downloadId: number, log: Logger): Promise<void> => {
  try {
    await webExtensionApi.downloads.cancel(downloadId);
  } catch {
    // Already complete; the state check below removes the finished duplicate.
  }
  let state: string | undefined;
  try {
    [{ state } = { state: undefined }] = await webExtensionApi.downloads.search({ id: downloadId });
  } catch (error) {
    log("existing-file duplicate lookup failed", String(error));
  }
  if (state === "complete") {
    try {
      await webExtensionApi.downloads.removeFile(downloadId);
    } catch (error) {
      // Keep the list entry so the duplicate stays visible to the user.
      log("existing-file duplicate removal failed", String(error));
      return;
    }
  }
  await Promise.resolve(webExtensionApi.downloads.erase({ id: downloadId })).catch((error) =>
    log("existing-file duplicate erase failed", String(error)),
  );
};

// The intent is durable before the cancel, so a background that dies part-way
// leaves a marker recovery can finish instead of a failure to report.
export const discardConflictingDownload = async (
  downloadId: number,
  cancel: ConflictCancel,
  log: Logger,
): Promise<void> => {
  discardedIds.add(downloadId);
  await writeCancel(downloadId, cancel);
  await removeConflictingDownload(downloadId, log);
  await removeTrackedDownload(downloadId);
  await writeCancel(downloadId, undefined);
};

// Finishes discards a previous background left part-way. Returns the History
// rows it settled, so interrupted-transfer recovery does not overwrite them.
export const recoverConflictCancels = async (
  setStatus: (historyEntryId: string, status: string) => Promise<unknown>,
  log: Logger,
): Promise<Set<string>> => {
  const settled = new Set<string>();
  const cancels = await readCancels();
  await Promise.all(
    Object.entries(cancels).map(async ([id, cancel]) => {
      const downloadId = Number(id);
      discardedIds.add(downloadId);
      await removeTrackedDownload(downloadId);
      await removeConflictingDownload(downloadId, log);
      // Only Skip is finished by discarding. The Save As dialog Ask promised
      // never opened, so that save stays reported as interrupted.
      if (cancel.action === "skip" && cancel.historyEntryId) {
        await setStatus(cancel.historyEntryId, "CONFLICT_SKIPPED").catch((error) =>
          log("existing-file skip history failed", String(error)),
        );
        settled.add(cancel.historyEntryId);
      }
      await writeCancel(downloadId, undefined);
    }),
  );
  return settled;
};

export const resetConflictResolutionState = (): void => {
  pendingChecks.clear();
  discardedIds.clear();
};
