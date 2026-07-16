// Membership ("this download is ours, watch it for a completion notification")
// lives on the DownloadState record as `adopted`, so there is no second
// per-download structure to keep in sync — download.js's started record and the
// notifier's watch list are the same record. This module owns the transient,
// in-memory bridge between "a download was just requested" and "the browser's
// onCreated event arrived for it": notification.ts (queueing/creation API) and
// notification-events.ts (the onCreated/onChanged handlers) both need it, so it
// is kept dependency-free of those two files — neither has to import the other
// to reach this one (the import graph must stay acyclic).
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import type { DownloadRecord, DownloadRecordUpdate } from "./download-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";

// Downloads handed to downloads.download that onCreated has not yet seen.
// URL correlation prevents a rejected or unrelated request from consuming a
// different attempt; the persisted counter remains the worker-restart fallback.
type ExpectedDownload = {
  url?: string | undefined;
  record?: Partial<DownloadRecord> | undefined;
};
const expectedDownloads: ExpectedDownload[] = [];

export const resetExpectedDownloads = (): void => {
  expectedDownloads.length = 0;
};

// Recovery of adopted and pending records is owned by notification-recovery.ts.
export const mergeTrackedDownload = (downloadId: number, partial: DownloadRecordUpdate) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

export const getTrackedDownload = (downloadId: number) =>
  getDownload(downloadsState, extensionSessionStorage, downloadId);

// Call before webExtensionApi.downloads.download() so onDownloadCreated knows
// the next created download is ours
export const expectDownload = (url?: string, record?: DownloadRecordUpdate): ExpectedDownload => {
  const expected = { url, record };
  expectedDownloads.push(expected);
  return expected;
};

export const cancelExpectedDownload = (expected: ExpectedDownload): void => {
  const index = expectedDownloads.indexOf(expected);
  if (index !== -1) expectedDownloads.splice(index, 1);
};

// Returns (without removing) the first expected download whose URL matches
// either the requested or final URL, or an expectation with no URL filter at
// all. Callers that decide to adopt it remove it with cancelExpectedDownload.
export const findExpectedDownload = (
  url: string | undefined,
  finalUrl: string | undefined,
): ExpectedDownload | undefined =>
  expectedDownloads.find(
    (expected) => expected.url == null || expected.url === url || expected.url === finalUrl,
  );
