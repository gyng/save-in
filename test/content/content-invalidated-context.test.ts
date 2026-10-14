// @vitest-environment jsdom
import { vi } from "vitest";
import { CLICK_GESTURES, serializeClickToSaveBindings } from "../../src/shared/click-gesture.ts";
import type { AutoDownloadDiscoveryOptions } from "../../src/content/auto-download.ts";

// Chrome keeps an orphaned content script's listeners alive after the
// extension is updated, disabled, or removed; its runtime id disappears and
// every runtime call throws. These cases cover that teardown in a file of its
// own because it removes the module-level listeners other suites depend on.

type Listener = (event: unknown) => void;
type SendMessage = (message: { type: string }, callback?: (response?: unknown) => void) => void;

const runtime = global.chrome.runtime as unknown as {
  id?: string | undefined;
  lastError?: { message: string } | undefined;
  sendMessage: SendMessage;
};
const originalId = runtime.id;
const originalSendMessage = runtime.sendMessage;
const originalAddListener = global.chrome.runtime.onMessage.addListener;
const originalStorageGet = global.chrome.storage.local.get;

let discovery: { options: AutoDownloadDiscoveryOptions; stop: ReturnType<typeof vi.fn> } | null =
  null;
let runtimeListener: ((message: unknown, sender: unknown, respond: unknown) => unknown) | null =
  null;
let sendMessage = vi.fn<SendMessage>();

const invalidateContext = () => {
  runtime.id = undefined;
  sendMessage.mockImplementation(() => {
    throw new Error("Extension context invalidated.");
  });
};

const importContent = async (stored: Record<string, unknown>) => {
  vi.resetModules();
  vi.doMock("../../src/content/auto-download.ts", () => ({
    createAutoDownloadDedup: () => ({ seen: new Set<string>(), limitNotified: false }),
    setupAutoDownloadDiscovery: vi.fn((options: AutoDownloadDiscoveryOptions) => {
      discovery = { options, stop: vi.fn() };
      return { scan: vi.fn(), idle: vi.fn(), stop: discovery.stop };
    }),
  }));
  sendMessage = vi.fn<SendMessage>((_message, callback) => callback?.());
  runtime.sendMessage = sendMessage;
  global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
    runtimeListener = listener as typeof runtimeListener;
  });
  global.chrome.storage.local.get = vi.fn((_keys, callback) => callback(stored)) as any;
  await import("../../src/content/content.ts");
};

const listenerFor = (spy: ReturnType<typeof vi.spyOn>, type: string, owned: boolean) =>
  (spy.mock.calls as [string, Listener, AddEventListenerOptions | undefined][]).findLast(
    ([eventType, , options]) => eventType === type && Boolean(options?.signal) === owned,
  );

const pressOn = (target: Element | null, button = 0) => ({
  isTrusted: true,
  button,
  buttons: button === 2 ? 2 : 1,
  detail: 1,
  target,
  clientX: 0,
  clientY: 0,
  composedPath: () => [target],
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
});

const downloads = () => sendMessage.mock.calls.filter(([message]) => message.type === "DOWNLOAD");

const autoDownloadRules = "context: ^auto$\npageurl: .\nsourceurl: .\ninto: automatic/";

describe("an invalidated extension context", () => {
  afterEach(() => {
    vi.doUnmock("../../src/content/auto-download.ts");
    vi.useRealTimers();
    vi.restoreAllMocks();
    runtime.id = originalId;
    delete runtime.lastError;
    runtime.sendMessage = originalSendMessage;
    global.chrome.runtime.onMessage.addListener = originalAddListener;
    global.chrome.storage.local.get = originalStorageGet;
    document.getElementById("save-in-source-panel")?.remove();
    document.body.innerHTML = "";
    discovery = null;
    runtimeListener = null;
  });

  test("lets a matching click reach the page and unmounts every surface", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.RIGHT, combo: "" },
        { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
      ]),
      autoDownloadEnabled: true,
      filenamePatterns: autoDownloadRules,
      sourcePanelEnabled: true,
    });
    runtimeListener?.({ type: "SET_SOURCE_PANEL", body: { open: true } }, {}, vi.fn());
    expect(document.getElementById("save-in-source-panel")).not.toBeNull();
    document.body.insertAdjacentHTML("beforeend", '<img id="i" src="http://x.test/pic.png">');
    const featureMousedown = listenerFor(addEventListener, "mousedown", true);
    const pageMousedown = listenerFor(addEventListener, "mousedown", false);
    expect(pageMousedown).toBeDefined();
    invalidateContext();

    const event = pressOn(document.getElementById("i"), 2);
    featureMousedown?.[1](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(downloads()).toHaveLength(0);
    expect(featureMousedown?.[2]?.signal?.aborted).toBe(true);
    expect(removeEventListener).toHaveBeenCalledWith("mousedown", pageMousedown?.[1], {
      capture: true,
    });
    expect(discovery?.stop).toHaveBeenCalledOnce();
    expect(document.getElementById("save-in-source-panel")?.classList).toContain("closing");
  });

  test("keeps a live context's matching click and its retry", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.RIGHT, combo: "" },
      ]),
    });
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const featureMousedown = listenerFor(addEventListener, "mousedown", true);
    sendMessage.mockImplementation((_message, callback) => {
      runtime.lastError = { message: "Could not establish connection." };
      callback?.();
      delete runtime.lastError;
    });

    const event = pressOn(document.getElementById("i"), 2);
    featureMousedown?.[1](event);
    await vi.advanceTimersByTimeAsync(300);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(downloads()).toHaveLength(2);
    expect(featureMousedown?.[2]?.signal?.aborted).toBe(false);
  });

  test("tears down when a retry finds the context gone", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.RIGHT, combo: "" },
      ]),
    });
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const featureMousedown = listenerFor(addEventListener, "mousedown", true);
    sendMessage.mockImplementationOnce((_message, callback) => {
      runtime.lastError = { message: "Could not establish connection." };
      callback?.();
      delete runtime.lastError;
    });

    featureMousedown?.[1](pressOn(document.getElementById("i"), 2));
    invalidateContext();
    await vi.advanceTimersByTimeAsync(300);

    expect(featureMousedown?.[2]?.signal?.aborted).toBe(true);
  });

  test("stops retrying once a failed send reports the context gone", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.RIGHT, combo: "" },
      ]),
    });
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const featureMousedown = listenerFor(addEventListener, "mousedown", true);
    sendMessage.mockImplementation((_message, callback) => {
      // The context dies while the message is in flight.
      runtime.id = undefined;
      runtime.lastError = { message: "Extension context invalidated." };
      callback?.();
      delete runtime.lastError;
    });

    featureMousedown?.[1](pressOn(document.getElementById("i"), 2));
    await vi.advanceTimersByTimeAsync(1000);

    expect(downloads()).toHaveLength(1);
    expect(featureMousedown?.[2]?.signal?.aborted).toBe(true);
  });

  test("lets a completed hold's click through once the context is gone", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
      ]),
      contentClickToSaveLongPressMs: 500,
    });
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const featureMousedown = listenerFor(addEventListener, "mousedown", true);
    const pageClick = listenerFor(addEventListener, "click", false);

    featureMousedown?.[1](pressOn(document.getElementById("i")));
    invalidateContext();
    await vi.advanceTimersByTimeAsync(500);
    const click = pressOn(document.getElementById("i"));
    pageClick?.[1]({ ...click, type: "click" });

    expect(downloads()).toHaveLength(0);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(featureMousedown?.[2]?.signal?.aborted).toBe(true);
  });

  test("tears down when prewarming finds the context gone", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContent({
      contentClickToSave: true,
      contentClickToSaveCombo: 17,
      contentClickToSaveButton: "RIGHT_CLICK",
    });
    const keydown = listenerFor(addEventListener, "keydown", true);
    invalidateContext();

    keydown?.[1]({ isTrusted: true, key: "Control", keyCode: 17 });

    expect(keydown?.[2]?.signal?.aborted).toBe(true);
  });

  test("stops automatic discovery when a send finds the context gone", async () => {
    await importContent({ autoDownloadEnabled: true, filenamePatterns: autoDownloadRules });
    invalidateContext();

    const result = await discovery?.options.send({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/a.png",
      sourceKind: "image",
    });

    expect(result).toBe("skipped");
    expect(discovery?.stop).toHaveBeenCalledOnce();
  });

  test("stops automatic discovery without retrying a send that reports the context gone", async () => {
    vi.useFakeTimers();
    await importContent({ autoDownloadEnabled: true, filenamePatterns: autoDownloadRules });
    sendMessage.mockImplementation((_message, callback) => {
      runtime.id = undefined;
      runtime.lastError = { message: "Extension context invalidated." };
      callback?.();
      delete runtime.lastError;
    });

    const result = discovery?.options.send({
      pageUrl: "http://localhost/",
      sourceUrl: "https://cdn.test/a.png",
      sourceKind: "image",
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await result).toBe("skipped");
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === "AUTO_DOWNLOAD_SOURCE"),
    ).toHaveLength(1);
    expect(discovery?.stop).toHaveBeenCalledOnce();
  });
});
