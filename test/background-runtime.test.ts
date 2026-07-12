import {
  backgroundRuntime,
  installBackgroundRuntimeBridge,
  resetRuntimeDiagnostics,
} from "../src/background/runtime.ts";

describe("BackgroundRuntime", () => {
  test("owns diagnostics independently of the browser global", () => {
    backgroundRuntime.optionErrors.paths.push({ message: "bad path", error: "x" });

    resetRuntimeDiagnostics();

    expect(backgroundRuntime.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
  });

  test("provides a narrow read/write bridge for the browser e2e harness", () => {
    const host = {} as Window;
    installBackgroundRuntimeBridge(host);

    const state = { scratch: {}, info: {} } as any;
    host.lastDownloadState = state;
    host.SI_DEBUG = 1;

    expect(backgroundRuntime.lastDownloadState).toBe(state);
    expect(backgroundRuntime.debug).toBe(true);
    expect(host.lastDownloadState).toBe(state);
  });
});
