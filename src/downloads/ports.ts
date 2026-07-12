import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import type { DownloadPipelineState } from "./download-types.ts";

export type DownloadPorts = {
  runtime: {
    ready?: Promise<unknown>;
    debug: boolean;
    lastDownloadState?: DownloadPipelineState | null;
  };
  history: {
    add(entry: HistoryEntryInput): string;
    patch(id: string | null | undefined, fields: Partial<HistoryEntry>): Promise<unknown>;
    setDownloadId(id: string | null | undefined, downloadId: number): Promise<unknown>;
    setStatus(
      id: string | null | undefined,
      status: string,
      downloadId?: number,
      fileSize?: number,
    ): Promise<unknown>;
  };
  log: { add(message: string, data?: unknown): unknown };
};

const legacy = (name: string): Record<string, (...args: never[]) => unknown> | undefined =>
  Reflect.get(globalThis, name) as Record<string, (...args: never[]) => unknown> | undefined;

const legacyRuntime = {
  get ready() {
    return Reflect.get(globalThis.window ?? globalThis, "ready") as Promise<unknown> | undefined;
  },
  get debug() {
    return Boolean(Reflect.get(globalThis.window ?? globalThis, "SI_DEBUG"));
  },
  get lastDownloadState() {
    return Reflect.get(globalThis.window ?? globalThis, "lastDownloadState") as
      | DownloadPipelineState
      | null
      | undefined;
  },
  set lastDownloadState(value: DownloadPipelineState | null | undefined) {
    Reflect.set(globalThis.window ?? globalThis, "lastDownloadState", value);
  },
};

const legacyHistory: DownloadPorts["history"] = {
  add: (entry) => (legacy("SaveHistory")?.add?.(entry as never) as string | undefined) ?? "",
  patch: (id, fields) =>
    (legacy("SaveHistory")?.patch?.(id as never, fields as never) as Promise<unknown>) ??
    Promise.resolve(),
  setDownloadId: (id, downloadId) =>
    (legacy("SaveHistory")?.setDownloadId?.(
      id as never,
      downloadId as never,
    ) as Promise<unknown>) ?? Promise.resolve(),
  setStatus: (id, status, downloadId, fileSize) =>
    (legacy("SaveHistory")?.setStatus?.(
      id as never,
      status as never,
      downloadId as never,
      fileSize as never,
    ) as Promise<unknown>) ?? Promise.resolve(),
};
const legacyLog: DownloadPorts["log"] = {
  add: (message, data) => legacy("Log")?.add?.(message as never, data as never),
};
let installed: Partial<DownloadPorts> | undefined;

// Stable forwarding objects are important: feature modules are evaluated
// before the composition root and retain these references.
export const downloadPorts: DownloadPorts = {
  runtime: {
    get ready() {
      return (installed?.runtime ?? legacyRuntime).ready;
    },
    get debug() {
      return (installed?.runtime ?? legacyRuntime).debug;
    },
    get lastDownloadState() {
      return (installed?.runtime ?? legacyRuntime).lastDownloadState;
    },
    set lastDownloadState(value) {
      (installed?.runtime ?? legacyRuntime).lastDownloadState = value;
    },
  },
  history: {
    add: (...args) => (installed?.history ?? legacyHistory).add(...args),
    patch: (...args) => (installed?.history ?? legacyHistory).patch(...args),
    setDownloadId: (...args) => (installed?.history ?? legacyHistory).setDownloadId(...args),
    setStatus: (...args) => (installed?.history ?? legacyHistory).setStatus(...args),
  },
  log: { add: (...args) => (installed?.log ?? legacyLog).add(...args) },
};

export const configureDownloadPorts = (ports: Partial<DownloadPorts>): void => {
  installed = { ...installed, ...ports };
};
