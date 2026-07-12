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

// Browser e2e evaluates these historical names on the background global.
// Keep that compatibility surface at the composition boundary only.
export const installBackgroundRuntimeBridge = (host: Window) => {
  const bridge = (name: keyof BackgroundRuntime) => {
    Object.defineProperty(host, name, {
      configurable: true,
      enumerable: true,
      get: () => backgroundRuntime[name],
      set: (value) => {
        Reflect.set(backgroundRuntime, name, value);
      },
    });
  };
  bridge("ready");
  bridge("init");
  bridge("reset");
  bridge("optionErrors");
  bridge("lastDownloadState");
  Object.defineProperty(host, "SI_DEBUG", {
    configurable: true,
    enumerable: true,
    get: () => (backgroundRuntime.debug ? 1 : undefined),
    set: (value: boolean | number | undefined) => {
      backgroundRuntime.debug = Boolean(value);
    },
  });
};
