import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";
import type { DownloadPipelineState, SourceSidecarRequest } from "./download-types.ts";

export type DownloadPorts = {
  runtime: {
    ready?: Promise<unknown> | undefined;
    debug: boolean;
    lastDownloadState?: DownloadPipelineState | null | undefined;
  };
  history: {
    add(entry: HistoryEntryInput, options?: PrivateWriteOptions): string | null;
    patch(id: string | null | undefined, fields: Partial<HistoryEntry>): Promise<unknown>;
    setDownloadId(id: string | null | undefined, downloadId: number): Promise<unknown>;
    setStatus(
      id: string | null | undefined,
      status: string,
      downloadId?: number,
      fileSize?: number,
    ): Promise<unknown>;
    // Undo resolves a lost session record back to its entry by downloadId.
    entries(): Promise<HistoryEntry[]>;
  };
  log: {
    add(message: string, data?: unknown, options?: { privateContext?: boolean }): unknown;
  };
  retry(downloadId: number): Promise<boolean>;
  sourceSidecar(
    request: SourceSidecarRequest,
    intendedFilename: string,
    currentFilename?: string,
  ): Promise<void>;
};

export type DownloadPortRegistry = {
  ports: DownloadPorts;
  configure(ports: DownloadPorts): void;
};

export const createDownloadPortRegistry = (): DownloadPortRegistry => {
  let installed: DownloadPorts | undefined;
  const requirePort = <K extends keyof DownloadPorts>(name: K): DownloadPorts[K] => {
    const port = installed?.[name];
    if (!port) throw new Error(`Download port has not been configured: ${name}`);
    return port;
  };

  // Feature modules retain these forwarding objects when the module graph is
  // evaluated, before the background composition root installs host services.
  const ports: DownloadPorts = {
    runtime: {
      get ready() {
        return requirePort("runtime").ready;
      },
      get debug() {
        return requirePort("runtime").debug;
      },
      get lastDownloadState() {
        return requirePort("runtime").lastDownloadState;
      },
      set lastDownloadState(value) {
        requirePort("runtime").lastDownloadState = value;
      },
    },
    history: {
      add: (...args) => requirePort("history").add(...args),
      patch: (...args) => requirePort("history").patch(...args),
      setDownloadId: (...args) => requirePort("history").setDownloadId(...args),
      setStatus: (...args) => requirePort("history").setStatus(...args),
      entries: () => requirePort("history").entries(),
    },
    log: { add: (...args) => requirePort("log").add(...args) },
    retry: (...args) => requirePort("retry")(...args),
    sourceSidecar: (...args) => requirePort("sourceSidecar")(...args),
  };

  return {
    ports,
    configure(configured) {
      installed = configured;
    },
  };
};

const registry = createDownloadPortRegistry();
export const downloadPorts = registry.ports;
export const configureDownloadPorts = registry.configure;
