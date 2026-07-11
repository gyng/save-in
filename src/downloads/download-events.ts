import type { DownloadPipelineState } from "./download-types.ts";

export const DownloadEvents: { downloaded: (state: DownloadPipelineState) => void } = {
  downloaded: () => {},
};
