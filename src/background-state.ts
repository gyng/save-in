import { DownloadCounter } from "./counter.ts";
import { DownloadStateStore } from "./download-state.ts";
import { SessionStateStore } from "./session-state.ts";

const session = new SessionStateStore();

export const BackgroundState = Object.freeze({
  session,
  downloads: new DownloadStateStore(session),
  counter: new DownloadCounter(),
});

// Temporary narrow views while each class is converted to functional state.
export const SessionState = BackgroundState.session;
export const DownloadState = BackgroundState.downloads;
export const Counter = BackgroundState.counter;
