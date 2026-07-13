import type { DownloadPipelineState } from "../downloads/download-types.ts";

export type OptionError = { message: string; error: string; warning?: boolean };
export type OptionErrors = { paths: OptionError[]; filenamePatterns: OptionError[] };

const emptyOptionErrors = (): OptionErrors => ({ paths: [], filenamePatterns: [] });

export type BackgroundRuntime = {
  ready?: Promise<unknown>;
  optionErrors: OptionErrors;
  lastDownloadState?: DownloadPipelineState | null;
  debug: boolean;
  init: () => Promise<unknown>;
  reset: () => Promise<unknown>;
};

const RUNTIME_KEY = Symbol.for("save-in.backgroundRuntime");
const runtimeHost = globalThis as typeof globalThis & { [RUNTIME_KEY]?: BackgroundRuntime };

// A module-reset test models a worker module graph being rebuilt while its
// jsdom host survives. Reusing the record keeps the compatibility bridge bound
// to the same explicit runtime instance.
export const backgroundRuntime: BackgroundRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  optionErrors: emptyOptionErrors(),
  debug: false,
  init: () => Promise.resolve(),
  reset: () => Promise.resolve(),
});

export const resetRuntimeDiagnostics = () => {
  backgroundRuntime.optionErrors = emptyOptionErrors();
};
