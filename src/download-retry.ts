export const DownloadRetry: { retry: (downloadId: number) => Promise<boolean> } = {
  retry: () => Promise.resolve(false),
};
