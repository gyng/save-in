// History emits replay requests while the route debugger consumes them. This
// tiny contract stays in options/core so neither feature has to own the other.
import { isWireDownloadState, type WireDownloadState } from "../../shared/message-protocol.ts";
import { isStringKeyedRecord } from "../../shared/util.ts";

export const HISTORY_DEBUG_EVENT = "save-in:debug-history";

export type HistoryDebugRequest = { state: WireDownloadState };

export const historyDebugRequest = (value: unknown): HistoryDebugRequest | null => {
  if (!isStringKeyedRecord(value) || !isWireDownloadState(value.state)) return null;
  return { state: value.state };
};
