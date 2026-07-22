import type { DownloadPipelineState } from "./download-types.ts";

type PendingRoutingResolution = {
  promise: Promise<void>;
  controller: AbortController;
};

// Chrome may resolve downloads.download() before onDeterminingFilename. Keep
// this acknowledgement live-state-only: persisting a resolver is impossible,
// and persisting its source-tab context would widen private recovery data.
const pending = new WeakMap<DownloadPipelineState, PendingRoutingResolution>();

export const prepareRoutingResolution = (state: DownloadPipelineState): void => {
  if (!state.scratch.deferredRoutingResolution || pending.has(state)) return;
  const controller = new AbortController();
  const promise = new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  pending.set(state, { promise, controller });
};

export const settleRoutingResolution = (state: DownloadPipelineState): void => {
  pending.get(state)?.controller.abort();
};

export const discardRoutingResolution = (state: DownloadPipelineState): void => {
  pending.delete(state);
  delete state.scratch.deferredRoutingResolution;
};

export const waitForRoutingResolution = async (state: DownloadPipelineState): Promise<void> => {
  const resolution = pending.get(state);
  if (resolution) {
    await resolution.promise;
    pending.delete(state);
  }
  delete state.scratch.deferredRoutingResolution;
};
