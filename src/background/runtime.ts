import type { DownloadPipelineState } from "../downloads/download-types.ts";
import type { MenuTreeError } from "../menus/menu-tree.ts";

export type OptionError = { message: string; error: string; warning?: boolean };
export type OptionErrors = { paths: MenuTreeError[]; filenamePatterns: OptionError[] };

const emptyOptionErrors = (): OptionErrors => ({ paths: [], filenamePatterns: [] });

export type BackgroundRuntime = {
  ready?: Promise<unknown>;
  optionErrors: OptionErrors;
  lastDownloadState?: DownloadPipelineState | null;
  debug: boolean;
  init: () => Promise<unknown>;
  reset: () => Promise<unknown>;
};

export const createBackgroundRuntime = (): BackgroundRuntime => ({
  optionErrors: emptyOptionErrors(),
  debug: false,
  init: () => Promise.resolve(),
  reset: () => Promise.resolve(),
});

export const backgroundRuntime = createBackgroundRuntime();

export const resetRuntimeDiagnostics = () => {
  backgroundRuntime.optionErrors = emptyOptionErrors();
};
