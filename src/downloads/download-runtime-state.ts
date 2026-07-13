import type { DownloadPipelineState } from "./download-types.ts";

export const createDownloadRuntimeState = () => {
  const pendingStates = new Map<string, DownloadPipelineState[]>();

  const rememberPendingStateAtUrl = (state: DownloadPipelineState, url: string) => {
    if (!url) return;
    const queue = pendingStates.get(url) || [];
    queue.push(state);
    pendingStates.set(url, queue);
    // Every entry corresponds to a live browser filename event and is removed
    // when consumed or when its pipeline terminates. A numeric cap can silently
    // detach valid concurrent downloads, so lifecycle cleanup is the bound.
  };

  const forgetPendingState = (state: DownloadPipelineState) => {
    for (const [url, queue] of pendingStates) {
      const index = queue.indexOf(state);
      if (index !== -1) queue.splice(index, 1);
      if (queue.length === 0) pendingStates.delete(url);
    }
  };

  return {
    pendingStates,
    pendingRetryFilenames: new Map<string, string>(),
    ownedObjectUrls: new Map<number, string>(),
    generatedObjectUrls: new Set<string>(),
    finalFilenamesByDownloadId: new Map<number, string>(),
    rememberPendingStateAtUrl,
    rememberPendingState: (state: DownloadPipelineState) => {
      if (state.info?.url) rememberPendingStateAtUrl(state, state.info.url);
    },
    forgetPendingState,
    movePendingState: (state: DownloadPipelineState, url: string) => {
      forgetPendingState(state);
      rememberPendingStateAtUrl(state, url);
    },
  };
};

export type DownloadRuntimeState = ReturnType<typeof createDownloadRuntimeState>;
