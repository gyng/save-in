import type { DiagnosticLifecycleEntry } from "../../src/shared/diagnostics-types.ts";

describe("background diagnostics", () => {
  beforeEach(async () => {
    vi.resetModules();
    await browser.storage.session.clear();
  });

  test("normalizes lifecycle records and keeps the newest bounded entries", async () => {
    const { normalizeDiagnosticLifecycle } = await import("../../src/background/diagnostics.ts");
    const valid = Array.from(
      { length: 55 },
      (_, index): DiagnosticLifecycleEntry => ({
        at: `2026-07-15T08:00:${String(index).padStart(2, "0")}.000Z`,
        kind: "configuration_reloaded",
      }),
    );

    expect(
      normalizeDiagnosticLifecycle([null, { at: 1, kind: "background_ready" }, ...valid]),
    ).toHaveLength(50);
    expect(normalizeDiagnosticLifecycle(valid)[0]?.at).toContain("05.000Z");
    expect(
      normalizeDiagnosticLifecycle([
        { at: "now", kind: "background_ready", durationMs: -1 },
        { at: "now", kind: "background_ready", previousVersion: 4 },
        { at: "now", kind: "unknown" },
      ]),
    ).toEqual([]);
    expect(normalizeDiagnosticLifecycle({ legacy: true })).toEqual([]);
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
});
