import { DownloadCounter } from "./counter.ts";
import { DownloadStateStore } from "./download-state.ts";
import { SessionWriteState } from "./session-state.ts";

const sessionWrites: SessionWriteState = { queue: Promise.resolve() };

export const BackgroundState = Object.freeze({
  sessionWrites,
  downloads: new DownloadStateStore(sessionWrites, () => browser.storage?.session),
  counter: new DownloadCounter(),
});

// Temporary narrow views while each class is converted to functional state.
export const DownloadState = BackgroundState.downloads;
export const Counter = BackgroundState.counter;
