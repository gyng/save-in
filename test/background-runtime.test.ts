import {
  backgroundRuntime,
  createBackgroundRuntime,
  resetRuntimeDiagnostics,
} from "../src/background/runtime.ts";

describe("BackgroundRuntime", () => {
  test("owns diagnostics independently of the browser global", () => {
    backgroundRuntime.optionErrors.paths.push({ sourceIndex: 0, message: "bad path", error: "x" });

    resetRuntimeDiagnostics();

    expect(backgroundRuntime.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
  });

  test("creates isolated runtime records", () => {
    const first = createBackgroundRuntime();
    const second = createBackgroundRuntime();
    first.debug = true;
    first.optionErrors.paths.push({ sourceIndex: 0, message: "bad", error: "x" });

    expect(second.debug).toBe(false);
    expect(second.optionErrors.paths).toEqual([]);
  });

  test("starts with resolved lifecycle hooks", async () => {
    const runtime = createBackgroundRuntime();

    await expect(runtime.init()).resolves.toBeUndefined();
    await expect(runtime.reset()).resolves.toBeUndefined();
  });
});
