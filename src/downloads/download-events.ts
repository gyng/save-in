import type { DownloadPipelineState } from "./download-types.ts";

type DownloadEventHandlers = {
  downloaded(state: DownloadPipelineState): void;
};

let handlers: DownloadEventHandlers = { downloaded: () => {} };

export const configureDownloadEvents = (configured: DownloadEventHandlers): void => {
  handlers = configured;
};

export const emitDownloaded = (state: DownloadPipelineState): void => handlers.downloaded(state);
