import { OffscreenClient } from "../platform/offscreen-client.ts";
import { isDataUrl } from "../shared/data-url.ts";
import type { DownloadRecord } from "./download-state.ts";
import { mergeTrackedDownload } from "./expected-downloads.ts";

type ReleaseErrorLogger = (message: string, data: string) => unknown;

const claimedOffscreenRecords = new WeakSet<DownloadRecord>();
const pendingLateRouteCancellations = new Map<number, Promise<boolean>>();

// Chrome reports a cancellation caused by late filename routing as
// USER_CANCELED. Hold terminal deltas until the cancellation attempt has a
// definitive outcome so History receives one cause, not both browser wording
// and the routing result.
export const runLateRouteCancellation = async (
  downloadId: number,
  operation: () => Promise<boolean>,
): Promise<boolean> => {
  // The executor runs synchronously and adds exactly one resolver. Keeping it
  // in a collection avoids an unsafe definite-assignment assertion in source.
  const settlers: Array<(canceledByRouting: boolean) => void> = [];
  const outcome = new Promise<boolean>((resolve) => {
    settlers.push(resolve);
  });
  pendingLateRouteCancellations.set(downloadId, outcome);
  let canceledByRouting = false;
  try {
    canceledByRouting = await operation();
    return canceledByRouting;
  } finally {
    settlers.forEach((settle) => settle(canceledByRouting));
    pendingLateRouteCancellations.delete(downloadId);
  }
};

export const waitForLateRouteCancellation = (downloadId: number): Promise<boolean> | undefined =>
  pendingLateRouteCancellations.get(downloadId);

// Terminal events and Chrome's late filename exclusion can race. Clear the
// in-memory ownership and resource tokens synchronously before yielding so a
// second path observes an already-released record instead of releasing twice.
export const releaseTerminalDownload = async (
  downloadId: number,
  record: DownloadRecord,
  logError: ReleaseErrorLogger,
): Promise<void> => {
  const cleanup = mergeTrackedDownload(downloadId, {
    adopted: false,
    offscreenRequestId: undefined,
    pendingHistoryMove: undefined,
    pendingSourceSidecar: undefined,
    ...(record.url && isDataUrl(record.url) ? { url: undefined } : {}),
  });
  const offscreenRequestId = record.offscreenRequestId;
  let release: Promise<unknown> = Promise.resolve();
  if (offscreenRequestId && !claimedOffscreenRecords.has(record)) {
    claimedOffscreenRecords.add(record);
    release = OffscreenClient.release(offscreenRequestId).catch((error) =>
      logError("offscreen blob release failed", String(error)),
    );
  }
  await Promise.all([cleanup, release]);
};
