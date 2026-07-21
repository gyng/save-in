import {
  configureDownloadPorts,
  createDownloadPortRegistry,
  downloadPorts,
} from "../../src/downloads/ports.ts";

describe("download ports", () => {
  test("fails loudly when a required port has not been configured", async () => {
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
    expect(() => registry.ports.retry(1)).toThrow("Download port has not been configured: retry");
    expect(() =>
      registry.ports.sourceSidecar({ sourceUrl: "https://example.com" }, "source.png"),
    ).toThrow("Download port has not been configured: sourceSidecar");
    expect(() => registry.ports.updateBrowserLastUsed?.("Work")).toThrow(
      "Download port has not been configured: updateBrowserLastUsed",
    );
  });

  test("configuration preserves references captured during module evaluation", async () => {
    const capturedRuntime = downloadPorts.runtime;
    const capturedHistory = downloadPorts.history;
    const capturedLog = downloadPorts.log;
    const history = {
      add: vi.fn(() => "history-id"),
      patch: vi.fn(() => Promise.resolve()),
      setDownloadId: vi.fn(() => Promise.resolve()),
      setStatus: vi.fn(() => Promise.resolve()),
      entries: vi.fn(() => Promise.resolve([])),
      anchorStartTime: vi.fn(() => Promise.resolve()),
    };
    const log = { add: vi.fn() };
    const retry = vi.fn(() => Promise.resolve(true));
    const sourceSidecar = vi.fn(() => Promise.resolve());
    const updateBrowserLastUsed = vi.fn(() => Promise.resolve());

    const lastDownloadState = { info: { filename: "saved.png" } } as never;
    configureDownloadPorts({
      runtime: { debug: true, lastDownloadState },
      history,
      log,
      retry,
      sourceSidecar,
      updateBrowserLastUsed,
    });

    expect(capturedRuntime.debug).toBe(true);
    expect(capturedRuntime.lastDownloadState).toBe(lastDownloadState);
    expect(capturedHistory.add({})).toBe("history-id");
    capturedLog.add("configured");
    expect(log.add).toHaveBeenCalledWith("configured");
    await expect(downloadPorts.retry(7)).resolves.toBe(true);
    expect(retry).toHaveBeenCalledWith(7);
    await expect(
      downloadPorts.sourceSidecar({ sourceUrl: "https://example.com" }, "source.png"),
    ).resolves.toBeUndefined();
    expect(sourceSidecar).toHaveBeenCalledWith({ sourceUrl: "https://example.com" }, "source.png");
    await expect(downloadPorts.updateBrowserLastUsed?.("Work")).resolves.toBeUndefined();
    expect(updateBrowserLastUsed).toHaveBeenCalledWith("Work");
  });
});
