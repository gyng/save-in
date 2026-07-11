import { CounterWriteState } from "./counter.ts";
import { DownloadsState } from "./download-state.ts";
import { SessionWriteState } from "./session-state.ts";

const sessionWrites: SessionWriteState = { queue: Promise.resolve() };
const downloads: DownloadsState = { records: new Map(), hydration: null };
const counterWrites: CounterWriteState = { queue: Promise.resolve() };

export const BackgroundState = Object.freeze({
  sessionWrites,
  downloads,
  counterWrites,
});

// Temporary narrow views while each class is converted to functional state.
