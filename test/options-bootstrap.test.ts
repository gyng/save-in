import { bootstrapOptionsPage } from "../src/options/options-bootstrap.ts";

describe("options bootstrap", () => {
  test("owns readiness and downloaded refresh registration", () => {
    const readyA = vi.fn();
    const readyB = vi.fn();
    const onDownloaded = vi.fn();
    const configureRuntime = vi.fn();
    const addMessageListener = vi.fn();
    const startBrowserDetection = vi.fn();

    const onReady = bootstrapOptionsPage({
      document,
      ready: [readyA, readyB],
      configureRuntime,
      addMessageListener,
      onDownloaded,
      startBrowserDetection,
    });

    expect(configureRuntime).not.toHaveBeenCalled();
    expect(addMessageListener).not.toHaveBeenCalled();
    expect(startBrowserDetection).not.toHaveBeenCalled();

    onReady();
    onReady();

    expect(configureRuntime).toHaveBeenCalledTimes(1);
    expect(addMessageListener).toHaveBeenCalledTimes(1);
    const listener = addMessageListener.mock.calls[0]![0]!;
    listener({ type: "IGNORED" });
    expect(onDownloaded).not.toHaveBeenCalled();
    listener({ type: "DOWNLOADED" });
    expect(onDownloaded).toHaveBeenCalledTimes(1);
    expect(readyA).toHaveBeenCalledTimes(1);
    expect(readyB).toHaveBeenCalledTimes(1);
    expect(startBrowserDetection).toHaveBeenCalledTimes(1);
  });
});
