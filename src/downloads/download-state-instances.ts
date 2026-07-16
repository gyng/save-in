import type { SessionWriteState } from "../shared/session-state.ts";
import type { DownloadsState } from "./download-state.ts";

export const sessionWriteState: SessionWriteState = { queues: new Map() };
export const downloadsState: DownloadsState = { records: new Map(), hydration: null };
