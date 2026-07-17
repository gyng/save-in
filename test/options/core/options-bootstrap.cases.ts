// Cases imported by shell.test.ts to share one jsdom environment.
import { bootstrapOptionsPage } from "../../../src/options/core/options-bootstrap.ts";

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

  test("reports when asynchronous initial restoration is complete", async () => {
    let finishRestore!: () => void;
    const restore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRestore = resolve;
        }),
    );
    const onReady = bootstrapOptionsPage({
      document,
      ready: [restore],
      configureRuntime: vi.fn(),
      addMessageListener: vi.fn(),
      onDownloaded: vi.fn(),
      startBrowserDetection: vi.fn(),
    });

    const completion = onReady();
    let complete = false;
    void completion.then(() => (complete = true));
    await Promise.resolve();
    expect(complete).toBe(false);

    finishRestore();
    await completion;
    expect(complete).toBe(true);
    expect(onReady()).toBe(completion);
  });
});
