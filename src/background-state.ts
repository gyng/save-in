import { DownloadCounter } from "./counter.ts";
import { DownloadsState } from "./download-state.ts";
import { SessionWriteState } from "./session-state.ts";

const sessionWrites: SessionWriteState = { queue: Promise.resolve() };
const downloads: DownloadsState = { records: new Map(), hydration: null };

export const BackgroundState = Object.freeze({
  sessionWrites,
  downloads,
  counter: new DownloadCounter(),
});

// Temporary narrow views while each class is converted to functional state.
export const Counter = BackgroundState.counter;
