import type { DownloadPipelineState } from "../downloads/download-types.ts";
import type { MenuTreeError } from "../menus/menu-tree.ts";

export type OptionError = { message: string; error: string; warning?: boolean };
export type OptionErrors = { paths: MenuTreeError[]; filenamePatterns: OptionError[] };

const emptyOptionErrors = (): OptionErrors => ({ paths: [], filenamePatterns: [] });

export type BackgroundRuntime = {
  ready?: Promise<unknown>;
  instanceId: string;
  generation: number;
  readyGeneration: number;
  optionErrors: OptionErrors;
  lastDownloadState?: DownloadPipelineState | null;
  debug: boolean;
  init: () => Promise<unknown>;
  reset: () => Promise<number>;
};

export const createBackgroundRuntime = (): BackgroundRuntime => ({
  instanceId: crypto.randomUUID(),
  generation: 0,
  readyGeneration: 0,
  optionErrors: emptyOptionErrors(),
  debug: false,
  init: () => Promise.resolve(),
  reset: () => Promise.resolve(0),
});

export const backgroundRuntime = createBackgroundRuntime();

export const resetRuntimeDiagnostics = () => {
  backgroundRuntime.optionErrors = emptyOptionErrors();
};
