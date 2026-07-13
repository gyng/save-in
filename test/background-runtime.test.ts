import { backgroundRuntime, resetRuntimeDiagnostics } from "../src/background/runtime.ts";
import { BACKGROUND_E2E_BRIDGE, installBackgroundE2EBridge } from "../src/background/e2e-bridge.ts";

describe("BackgroundRuntime", () => {
  test("owns diagnostics independently of the browser global", () => {
    backgroundRuntime.optionErrors.paths.push({ message: "bad path", error: "x" });

    resetRuntimeDiagnostics();

    expect(backgroundRuntime.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
  });

  test("installs one non-enumerable, read-only e2e bridge", () => {
    const host = {} as typeof globalThis;
    const bridge = { runtime: backgroundRuntime };

    installBackgroundE2EBridge(host, bridge);

    expect(Reflect.get(host, BACKGROUND_E2E_BRIDGE)).toBe(bridge);
    expect(Object.keys(host)).not.toContain(BACKGROUND_E2E_BRIDGE);
    expect(Object.isFrozen(bridge)).toBe(true);
  });
});
