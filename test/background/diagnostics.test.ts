import type { DiagnosticLifecycleEntry } from "../../src/shared/diagnostics-types.ts";

describe("background diagnostics", () => {
  beforeEach(async () => {
    vi.resetModules();
    await browser.storage.session.clear();
  });

  test("bounds routine lifecycle records without evicting high-value events", async () => {
    const { normalizeDiagnosticLifecycle } = await import("../../src/background/diagnostics.ts");
    const valid = Array.from(
      { length: 55 },
      (_, index): DiagnosticLifecycleEntry => ({
        at: `2026-07-15T08:00:${String(index).padStart(2, "0")}.000Z`,
        kind: "configuration_reloaded",
      }),
    );

    const extensionUpdate: DiagnosticLifecycleEntry = {
      at: "2026-07-15T07:59:00.000Z",
      kind: "extension_updated",
      previousVersion: "3.9.0",
    };
    const normalized = normalizeDiagnosticLifecycle([
      null,
      { at: 1, kind: "background_ready" },
      extensionUpdate,
      ...valid,
    ]);
    expect(normalized).toHaveLength(6);
    expect(normalized[0]).toEqual(extensionUpdate);
    expect(normalized[1]?.at).toContain("50.000Z");
    expect(
      normalizeDiagnosticLifecycle([
        { at: "now", kind: "background_ready", durationMs: -1 },
        { at: "now", kind: "background_ready", previousVersion: 4 },
        { at: "now", kind: "unknown" },
      ]),
    ).toEqual([]);
    expect(normalizeDiagnosticLifecycle({ legacy: true })).toEqual([]);
    const highValue = Array.from(
      { length: 51 },
      (_, index): DiagnosticLifecycleEntry => ({
        at: `2026-07-15T09:00:${String(index).padStart(2, "0")}.000Z`,
        kind: "extension_installed",
      }),
    );
    expect(normalizeDiagnosticLifecycle(highValue)).toHaveLength(50);
  });

  test("reports worker health, configuration state, lifecycle, and recent failures", async () => {
    const diagnostics = await import("../../src/background/diagnostics.ts");
    const { backgroundRuntime } = await import("../../src/background/runtime.ts");
    const { Log } = await import("../../src/background/log.ts");
    backgroundRuntime.debug = true;
    backgroundRuntime.optionErrors = {
      paths: [{ sourceIndex: 2, message: "bad path", error: "invalid" }],
      filenamePatterns: [
        { message: "bad route", error: "invalid" },
        { message: "warning", error: "ambiguous", warning: true },
      ],
    };
    await Log.add("download failed", { reason: "denied" });
    await diagnostics.recordDiagnosticLifecycle("configuration_reloaded");

    diagnostics.markBackgroundReady();
    const snapshot = await diagnostics.getDiagnosticSnapshot();

    expect(snapshot).toMatchObject({
      extensionVersion: "4.0.0",
      manifestVersion: 3,
      browser: "CHROME",
      backgroundHost: "service_worker",
      workerStatus: "ready",
      sessionStorageAvailable: true,
      verboseLogging: true,
      pathErrorCount: 1,
      routingErrorCount: 2,
    });
    expect(snapshot.workerUptimeMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.lifecycle.map(({ kind }) => kind)).toEqual([
      "configuration_reloaded",
      "background_ready",
    ]);
    expect(snapshot.recentFailures).toEqual([
      expect.objectContaining({ message: "download failed", data: '{"reason":"denied"}' }),
    ]);
  });

  test("reports a failed Firefox event page with its detected version", async () => {
    Object.assign(browser.runtime, {
      getBrowserInfo: vi.fn().mockResolvedValue({ name: "Firefox", version: "130.0" }),
    });
    vi.stubGlobal("document", {});
    const diagnostics = await import("../../src/background/diagnostics.ts");
    await Promise.resolve();
    diagnostics.markBackgroundFailed();

    const snapshot = await diagnostics.getDiagnosticSnapshot();

    expect(snapshot).toMatchObject({
      browser: "FIREFOX",
      browserVersion: 130,
      backgroundHost: "event_page",
      workerStatus: "failed",
    });
    expect(snapshot).not.toHaveProperty("workerReadyAt");
    vi.unstubAllGlobals();
    Reflect.deleteProperty(browser.runtime, "getBrowserInfo");
  });

  test("continues reading diagnostics after a lifecycle write rejection", async () => {
    vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error("session unavailable"));
    const diagnostics = await import("../../src/background/diagnostics.ts");

    await expect(
      diagnostics.recordDiagnosticLifecycle("configuration_reloaded"),
    ).resolves.toBeUndefined();
    await expect(diagnostics.getDiagnosticSnapshot()).resolves.toMatchObject({ lifecycle: [] });
  });
});
