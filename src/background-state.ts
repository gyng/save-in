import type { CounterWriteState } from "./counter.ts";
import type { DownloadsState } from "./download-state.ts";
import type { SessionWriteState } from "./session-state.ts";

const sessionWrites: SessionWriteState = { queue: Promise.resolve() };
const downloads: DownloadsState = { records: new Map(), hydration: null };
const counterWrites: CounterWriteState = { queue: Promise.resolve() };

export const BackgroundState = Object.freeze({
  sessionWrites,
  downloads,
  counterWrites,
});
