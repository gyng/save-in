import { OffscreenClient } from "../platform/offscreen-client.ts";
import { isDataUrl } from "../shared/data-url.ts";
import type { DownloadRecord } from "./download-state.ts";
import { mergeTrackedDownload } from "./expected-downloads.ts";

type ReleaseErrorLogger = (message: string, data: string) => unknown;

const claimedOffscreenRecords = new WeakSet<DownloadRecord>();

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
