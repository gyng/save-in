import { configureDownloadEvents, emitDownloaded } from "../../src/downloads/download-events.ts";
import type { DownloadPipelineState } from "../../src/downloads/download-types.ts";

test("download completion emission uses the explicitly configured handler", () => {
  const downloaded = vi.fn();
  const state: DownloadPipelineState = {
    info: {},
    scratch: {},
    path: { finalize: () => "", toString: () => "" },
  };

  configureDownloadEvents({ downloaded });
  emitDownloaded(state);

  expect(downloaded).toHaveBeenCalledWith(state);
});
