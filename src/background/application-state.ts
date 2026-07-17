import type { CounterWriteState } from "./counter.ts";
import type { ConfigWriteState } from "./config-apply.ts";
import { downloadsState, sessionWriteState } from "../downloads/download-state-instances.ts";

export { sessionWriteState, downloadsState };
export const counterWriteState: CounterWriteState = { queue: Promise.resolve() };
export const configWriteState: ConfigWriteState = { queue: Promise.resolve() };

export const BackgroundState = Object.freeze({
  sessionWrites: sessionWriteState,
  downloads: downloadsState,
  counterWrites: counterWriteState,
  configWrites: configWriteState,
});
