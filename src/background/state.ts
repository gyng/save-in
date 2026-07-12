import type { CounterWriteState } from "./counter.ts";
import { downloadsState, sessionWriteState } from "../downloads/state.ts";

export { sessionWriteState, downloadsState };
export const counterWriteState: CounterWriteState = { queue: Promise.resolve() };

export const BackgroundState = Object.freeze({
  sessionWrites: sessionWriteState,
  downloads: downloadsState,
  counterWrites: counterWriteState,
});
