import { OffscreenClient } from "../platform/offscreen-client.ts";
import { isDataUrl } from "../shared/data-url.ts";
import type { DownloadRecord } from "./download-state.ts";
import { mergeTrackedDownload } from "./expected-downloads.ts";

type ReleaseErrorLogger = (message: string, data: string) => unknown;

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
  const release = record.offscreenRequestId
    ? OffscreenClient.release(record.offscreenRequestId).catch((error) =>
        logError("offscreen blob release failed", String(error)),
      )
    : Promise.resolve();
  await Promise.all([cleanup, release]);
};
