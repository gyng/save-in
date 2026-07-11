export const DownloadRetry: { retry: (downloadId: any) => Promise<boolean> } = {
  retry: () => Promise.resolve(false),
};
