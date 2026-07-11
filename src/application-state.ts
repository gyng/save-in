import { DownloadCounter } from "./counter.ts";
import { DownloadStateStore } from "./download-state.ts";
import { SessionStateStore } from "./session-state.ts";

// Background composition root: production stateful services are constructed
// together so dependency ownership is explicit without exposing a service locator.
const session = new SessionStateStore();

export const ApplicationState = Object.freeze({
  session,
  downloads: new DownloadStateStore(session),
  counter: new DownloadCounter(),
});

// Narrow views keep consumers explicit while every instance is still owned by
// the single composition root above.
export const SessionState = ApplicationState.session;
export const DownloadState = ApplicationState.downloads;
export const Counter = ApplicationState.counter;
