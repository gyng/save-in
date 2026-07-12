import type { DownloadPipelineState } from "./download-types.ts";

const MAX_PENDING_DOWNLOADS = 50;

export const createDownloadRuntimeState = () => {
  const pendingStates = new Map<string, DownloadPipelineState[]>();

  const rememberPendingStateAtUrl = (state: DownloadPipelineState, url: string) => {
    if (!url) return;
    const queue = pendingStates.get(url) || [];
    queue.push(state);
    pendingStates.set(url, queue);
    const total = [...pendingStates.values()].reduce((count, states) => count + states.length, 0);
    if (total <= MAX_PENDING_DOWNLOADS) return;
    const oldestUrl = pendingStates.keys().next().value;
    if (oldestUrl === undefined) return;
    const oldestQueue = pendingStates.get(oldestUrl)!;
    oldestQueue.shift();
    if (oldestQueue.length === 0) pendingStates.delete(oldestUrl);
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
