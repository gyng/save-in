type StringDelta = { current?: string | undefined; previous?: string | undefined };
type BooleanDelta = { current?: boolean | undefined; previous?: boolean | undefined };

type DownloadChange = {
  state?: StringDelta | undefined;
  paused?: BooleanDelta | undefined;
  canResume?: BooleanDelta | undefined;
  // Older Chromium typings and mocks exposed the reason directly.
  error?: StringDelta | string | undefined;
};

export type DownloadFailure = StringDelta | string | boolean;

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

// CRASH nominally means the browser crashed, which an extension could never
// observe from inside it. Firefox instead reports it for a generic
// NS_ERROR_FAILURE in BackgroundFileSaver (Mozilla bug 1633191, still open),
// where the documented workaround is to fetch the file instead — which is
// exactly what the retry does. Treating it as retryable makes that workaround
// automatic rather than a buried opt-in (#166).
const RETRYABLE_DOWNLOAD_FAILURES = /^(NETWORK_|SERVER_|CRASH$)/;

export const isRetryableDownloadFailure = (failure: DownloadFailure): boolean =>
  typeof failure === "object" &&
  typeof failure.current === "string" &&
  RETRYABLE_DOWNLOAD_FAILURES.test(failure.current);

export const downloadFailureReason = (failure: DownloadFailure): string | undefined =>
  typeof failure === "string" ? failure : typeof failure === "object" ? failure.current : undefined;
