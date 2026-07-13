import { configureDownloadEvents, emitDownloaded } from "../src/downloads/download-events.ts";

test("download completion emission uses the explicitly configured handler", () => {
  const downloaded = vi.fn();
  const state = { info: {}, scratch: {} } as never;

  configureDownloadEvents({ downloaded });
  emitDownloaded(state);

  expect(downloaded).toHaveBeenCalledWith(state);
});
