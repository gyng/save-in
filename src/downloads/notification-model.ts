type DownloadChange = Omit<Partial<browser.downloads._OnChangedDownloadDelta>, "error"> & {
  // Older Chromium typings and mocks exposed the reason directly.
  error?: browser.downloads.StringDelta | string | undefined;
};

export type DownloadFailure = browser.downloads.StringDelta | string | boolean;

export const getDownloadFailure = (
  downloadDelta: DownloadChange,
  isChrome: boolean,
): DownloadFailure => {
  if (isChrome) return downloadDelta.error || false;
  const paused = downloadDelta.paused?.current === true;
  const resumable = downloadDelta.canResume?.current === true;
  const interrupted = downloadDelta.state?.current === "interrupted";
  return !paused && !resumable && (downloadDelta.error || interrupted);
};

export const formatNotificationFileSize = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes >= 1000 * 1000) return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${bytes} B`;
};

export const buildSuccessNotificationTitle = (
  label: string,
  bytes?: number,
  mime?: string | false,
): string => [label, formatNotificationFileSize(bytes), mime].filter(Boolean).join(" · ");

export const isRetryableDownloadFailure = (failure: DownloadFailure): boolean =>
  typeof failure === "object" && /^(NETWORK_|SERVER_)/.test(failure.current || "");

export const downloadFailureReason = (failure: DownloadFailure): string | undefined =>
  typeof failure === "string" ? failure : typeof failure === "object" ? failure.current : undefined;
