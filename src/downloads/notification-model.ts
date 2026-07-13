export const getDownloadFailure = (downloadDelta: any, isChrome: boolean): any => {
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

export const isRetryableDownloadFailure = (failure: any): boolean =>
  /^(NETWORK_|SERVER_)/.test((failure && failure.current) || "");
