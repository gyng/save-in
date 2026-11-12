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

  // States whose downloads.download call has been made. Planning registers a
  // state early, but its per-save awaits let a later save of the same URL
  // reach the browser first; Chrome fires one filename event per call in call
  // order, so launched states must be consumed before any still planning.
  const launchedStates = new WeakSet<DownloadPipelineState>();

  const forgetPendingState = (state: DownloadPipelineState) => {
    launchedStates.delete(state);
    for (const [url, queue] of pendingStates) {
      const index = queue.indexOf(state);
      if (index !== -1) queue.splice(index, 1);
      if (queue.length === 0) pendingStates.delete(url);
    }
  };

  const launchPendingState = (state: DownloadPipelineState, url: string) => {
    forgetPendingState(state);
    if (!url) return;
    const queue = pendingStates.get(url) || [];
    const firstUnlaunched = queue.findIndex((queued) => !launchedStates.has(queued));
    queue.splice(firstUnlaunched === -1 ? queue.length : firstUnlaunched, 0, state);
    pendingStates.set(url, queue);
    launchedStates.add(state);
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
    launchPendingState,
    movePendingState: (state: DownloadPipelineState, url: string) => {
      forgetPendingState(state);
      rememberPendingStateAtUrl(state, url);
    },
  };
};

export type DownloadRuntimeState = ReturnType<typeof createDownloadRuntimeState>;
