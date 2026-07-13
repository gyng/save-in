import {
  configureDownloadPorts,
  createDownloadPortRegistry,
  downloadPorts,
} from "../src/downloads/ports.ts";

describe("download ports", () => {
  test("fails loudly when a required port has not been configured", () => {
    const registry = createDownloadPortRegistry();

    expect(() => registry.ports.runtime.debug).toThrow(
      "Download port has not been configured: runtime",
    );
    expect(() => registry.ports.history.add({})).toThrow(
      "Download port has not been configured: history",
    );
    expect(() => registry.ports.log.add("message")).toThrow(
      "Download port has not been configured: log",
    );
  });

  test("configuration preserves references captured during module evaluation", () => {
    const capturedRuntime = downloadPorts.runtime;
    const capturedHistory = downloadPorts.history;
    const capturedLog = downloadPorts.log;
    const history = {
      add: vi.fn(() => "history-id"),
      patch: vi.fn(() => Promise.resolve()),
      setDownloadId: vi.fn(() => Promise.resolve()),
      setStatus: vi.fn(() => Promise.resolve()),
    };
    const log = { add: vi.fn() };

    configureDownloadPorts({ runtime: { debug: true }, history, log });

    expect(capturedRuntime.debug).toBe(true);
    expect(capturedHistory.add({})).toBe("history-id");
    capturedLog.add("configured");
    expect(log.add).toHaveBeenCalledWith("configured");
  });
});
