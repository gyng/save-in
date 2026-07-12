import { vi } from "vitest";

const ClickToSave = (await import("../src/content/content.ts")).default;

describe("findSource", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  const event = (target: EventTarget | null) => ({ target, clientX: 10, clientY: 10 });

  test("finds media directly under the cursor", () => {
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), false)).toBe("http://x.test/pic.png");
  });

  test("finds media in a composed event path before coordinate fallback", () => {
    document.body.innerHTML = '<div id="host"></div><img id="i" src="http://x.test/path.png">';
    const host = document.getElementById("host");
    const img = document.getElementById("i");
    document.elementsFromPoint = jest.fn(() => []);

    expect(
      ClickToSave.findSource(
        { ...event(host), composedPath: () => [host, img, document, window] },
        false,
      ),
    ).toBe("http://x.test/path.png");
  });

  test("finds media below an overlay via elementsFromPoint", () => {
    document.body.innerHTML = '<div id="overlay"></div><img id="i" src="http://x.test/pic.png">';
    const overlay = document.getElementById("overlay");
    const img = document.getElementById("i");
    document.elementsFromPoint = jest.fn(() =>
      [overlay, img].filter((element): element is HTMLElement => element != null),
    );

    expect(ClickToSave.findSource(event(overlay), false)).toBe("http://x.test/pic.png");
  });

  test("falls back to the enclosing link when no media is found (#226)", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), true)).toBe("http://localhost/files/doc.pdf");
  });

  test("finds a link in the composed path across a shadow boundary", () => {
    document.body.innerHTML = '<div id="host"></div><a id="a" href="/shadow.pdf">PDF</a>';
    const host = document.getElementById("host");
    const anchor = document.getElementById("a");
    document.elementsFromPoint = jest.fn(() => []);

    expect(
      ClickToSave.findSource(
        { ...event(host), composedPath: () => [host, anchor, document, window] },
        true,
      ),
    ).toBe("http://localhost/shadow.pdf");
  });

  test("does not fall back to links when links are disabled", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), false)).toBeUndefined();
  });

  test("media wins over an enclosing link", () => {
    document.body.innerHTML = '<a href="/page.html"><img id="i" src="http://x.test/pic.png"></a>';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), true)).toBe("http://x.test/pic.png");
  });

  test("ignores non-downloadable link schemes", () => {
    document.body.innerHTML = '<a href="javascript:void(0)"><span id="s">x</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), true)).toBeUndefined();
  });

  test("returns undefined for plain elements", () => {
    document.body.innerHTML = '<p id="p">text</p>';
    expect(ClickToSave.findSource(event(document.getElementById("p")), true)).toBeUndefined();
  });
});

describe("input helpers", () => {
  test("isKeyboardComboActive requires every combo key to be down", () => {
    expect(ClickToSave.isKeyboardComboActive([18], { 18: true })).toBe(true);
    expect(ClickToSave.isKeyboardComboActive([18, 17], { 18: true })).toBe(false);
    expect(ClickToSave.isKeyboardComboActive([18], {})).toBe(false);
    // An empty combo ("No key") is always active — the mouse button alone saves
    expect(ClickToSave.isKeyboardComboActive([], {})).toBe(true);
  });

  test("comboToKeyCodes accepts names, raw keyCodes, and none (backward compat)", () => {
    expect(ClickToSave.comboToKeyCodes("Alt")).toEqual([18]);
    expect(ClickToSave.comboToKeyCodes("Option")).toEqual([18]);
    expect(ClickToSave.comboToKeyCodes("ctrl")).toEqual([17]);
    expect(ClickToSave.comboToKeyCodes("Command")).toEqual([91]);
    expect(ClickToSave.comboToKeyCodes("Ctrl+Shift")).toEqual([17, 16]);
    expect(ClickToSave.comboToKeyCodes(18)).toEqual([18]); // old numeric option
    expect(ClickToSave.comboToKeyCodes("18")).toEqual([18]);
    expect(ClickToSave.comboToKeyCodes(90)).toEqual([90]); // arbitrary custom key kept
    expect(ClickToSave.comboToKeyCodes("None")).toEqual([]);
    expect(ClickToSave.comboToKeyCodes("")).toEqual([]);
    expect(ClickToSave.comboToKeyCodes(undefined)).toEqual([]);
  });

  test("isMouseButtonActive maps buttons bitmask to configured button", () => {
    expect(ClickToSave.isMouseButtonActive("LEFT_CLICK", 1)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("RIGHT_CLICK", 2)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("MIDDLE_CLICK", 4)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("BACK_CLICK", 8)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("FORWARD_CLICK", 16)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("LEFT_CLICK", 2)).toBe(false);
    expect(ClickToSave.isMouseButtonActive("BACK_CLICK", 16)).toBe(false);
    expect(ClickToSave.isMouseButtonActive("nonsense", 1)).toBe(false);
  });
});

// Simulate the OPTIONS handshake the content script performs at load: the
// module is re-imported with chrome.runtime.sendMessage responding
// synchronously via its callback, mirroring the real callback-style API
const importContentWithOptions = async (optionsBody: Record<string, unknown>) => {
  vi.resetModules();
  global.chrome.runtime.sendMessage = vi.fn((message, cb) => cb({ body: optionsBody }));
  global.chrome.runtime.onMessage.addListener = vi.fn();
  await import("../src/content/content.ts");
};

describe("content.js initialisation", () => {
  const originalSendMessage = global.chrome.runtime.sendMessage;
  const originalAddListener = global.chrome.runtime.onMessage.addListener;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.chrome.runtime.sendMessage = originalSendMessage;
    global.chrome.runtime.onMessage.addListener = originalAddListener;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("bails out when the options response has no body (SW gone)", async () => {
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, cb) => cb(undefined));
    global.chrome.runtime.onMessage.addListener = vi.fn();
    await import("../src/content/content.ts");
    // The source-panel toggle remains available even if the options request
    // raced a sleeping service worker; it does not depend on stored options.
    expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  test("wires up click-to-save when the option is enabled", async () => {
    // Distinct combo/button so this stray listener set stays inert during
    // the setupClickToSave tests below
    await importContentWithOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 17,
      contentClickToSaveButton: "RIGHT_CLICK",
      links: false,
    });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();

    const keydown = new Event("keydown");
    (keydown as any).keyCode = 17;
    window.dispatchEvent(keydown);

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );
  });

  test("updates an existing page when click-to-save storage settings change", async () => {
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await importContentWithOptions({ contentClickToSave: false });
    expect(storageListener).toBeTypeOf("function");

    storageListener!(
      {
        contentClickToSave: { newValue: true },
        contentClickToSaveCombo: { newValue: 90 },
        contentClickToSaveButton: { newValue: "RIGHT_CLICK" },
        links: { newValue: false },
      },
      "local",
    );

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new Event("keydown");
    (keydown as any).keyCode = 90;
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );

    storageListener!({ contentClickToSave: { oldValue: true, newValue: false } }, "local");
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("ignores option changes from non-local storage areas", async () => {
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await importContentWithOptions({ contentClickToSave: false });

    storageListener!({ contentClickToSave: { newValue: true } }, "sync");
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new Event("keydown");
    (keydown as any).keyCode = 89;
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("does not let a late initial response overwrite newer storage settings", async () => {
    vi.resetModules();
    let optionsCallback: ((response: any) => void) | undefined;
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => {
      optionsCallback = callback;
    }) as any;
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await import("../src/content/content.ts");

    storageListener!(
      {
        contentClickToSave: { newValue: true },
        contentClickToSaveCombo: { newValue: 89 },
        contentClickToSaveButton: { newValue: "RIGHT_CLICK" },
      },
      "local",
    );
    optionsCallback!({ body: { contentClickToSave: false } });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new KeyboardEvent("keydown", { key: "y" });
    Object.defineProperty(keydown, "keyCode", { value: 89 });
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );
  });
});

describe("setupClickToSave", () => {
  // One listener set for the whole block: setupClickToSave registers window
  // listeners that cannot be removed, so state is reset between tests by
  // firing the same events a real page would (focus, keyup)
  beforeAll(() => {
    ClickToSave.setupClickToSave({
      contentClickToSaveCombo: 18,
      contentClickToSaveButton: "LEFT_CLICK",
      links: false,
    });
  });

  let sendMessage =
    vi.fn<(message: Record<string, any>, callback?: (response?: unknown) => void) => void>();

  beforeEach(() => {
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    sendMessage = vi.fn((_message: Record<string, any>, callback?: (response?: unknown) => void) =>
      callback?.(),
    );
    (global.chrome.runtime as any).sendMessage = sendMessage;
    delete (global.chrome.runtime as any).lastError;
  });

  afterEach(() => {
    // Clears the closed-over `active` key map
    window.dispatchEvent(new Event("focus"));
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const keyEvent = (type: string, keyCode: number): Event => {
    const e = new Event(type);
    (e as any).keyCode = keyCode;
    return e;
  };

  const holdCombo = () => window.dispatchEvent(keyEvent("keydown", 18));

  const mousedown = (target: EventTarget | null, buttons = 1) => {
    const e = new MouseEvent("mousedown", { buttons, bubbles: true, cancelable: true });
    vi.spyOn(e, "preventDefault");
    vi.spyOn(e, "stopImmediatePropagation");
    target?.dispatchEvent(e);
    return e;
  };

  const downloadsSent = () => sendMessage.mock.calls.filter(([m]) => m.type === "DOWNLOAD");

  test("holding the combo key wakes the service worker (WAKE_WARM)", () => {
    holdCombo();
    expect(sendMessage).toHaveBeenCalledWith({ type: "WAKE_WARM" }, expect.any(Function));
  });

  test("recognizes named Meta when Firefox reports a legacy keyCode", () => {
    const remove = ClickToSave.setupClickToSave({
      contentClickToSaveCombo: "Meta",
      contentClickToSaveButton: "RIGHT_CLICK",
      links: false,
    });
    const event = new KeyboardEvent("keydown", { key: "Meta" });
    Object.defineProperty(event, "keyCode", { value: 224 });
    window.dispatchEvent(event);
    expect(sendMessage).toHaveBeenCalledWith({ type: "WAKE_WARM" }, expect.any(Function));
    remove();
  });

  test("key repeat does not repeatedly wake the service worker", () => {
    const first = keyEvent("keydown", 18);
    window.dispatchEvent(first);
    window.dispatchEvent(first);
    expect(sendMessage.mock.calls.filter(([m]) => m.type === "WAKE_WARM")).toHaveLength(1);
  });

  test("unrelated keys do not wake the service worker", () => {
    window.dispatchEvent(keyEvent("keydown", 65));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("combo + configured button on media sends DOWNLOAD and swallows the click", () => {
    holdCombo();

    const img = document.getElementById("i");
    const e = mousedown(img);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "DOWNLOAD",
        body: {
          url: "http://x.test/pic.png",
          info: { pageUrl: `${window.location}`, srcUrl: "http://x.test/pic.png" },
        },
      },
      expect.any(Function),
    );
  });

  test("a two-modifier shortcut requires both modifiers", () => {
    const remove = ClickToSave.setupClickToSave({
      contentClickToSaveCombo: "Ctrl+Shift",
      contentClickToSaveButton: "BACK_CLICK",
      links: false,
    });
    const img = document.getElementById("i");

    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 8);
    expect(downloadsSent()).toHaveLength(0);

    window.dispatchEvent(keyEvent("keydown", 16));
    mousedown(img, 8);
    expect(downloadsSent()).toHaveLength(1);
    remove();
  });

  test("click without a resolvable source does nothing", () => {
    document.body.innerHTML = '<p id="p">text</p>';
    holdCombo();

    const e = mousedown(document.getElementById("p"));

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(downloadsSent()).toHaveLength(0);
  });

  test("wrong mouse button does not trigger a download", () => {
    holdCombo();
    mousedown(document.getElementById("i"), 2);
    expect(downloadsSent()).toHaveLength(0);
  });

  test("keyup releases the combo", () => {
    holdCombo();
    window.dispatchEvent(keyEvent("keyup", 18));

    mousedown(document.getElementById("i"));
    expect(downloadsSent()).toHaveLength(0);
  });

  test("window focus resets held keys (alt-tab back into the page)", () => {
    holdCombo();
    window.dispatchEvent(new Event("focus"));

    mousedown(document.getElementById("i"));
    expect(downloadsSent()).toHaveLength(0);
  });

  test.each(["blur", "pagehide"])("%s resets held keys", (eventName) => {
    holdCombo();
    window.dispatchEvent(new Event(eventName));
    mousedown(document.getElementById("i"));
    expect(downloadsSent()).toHaveLength(0);
  });

  test("hiding the tab resets held keys", () => {
    holdCombo();

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

    mousedown(document.getElementById("i"));
    expect(downloadsSent()).toHaveLength(0);
  });

  test("visibilitychange while still visible keeps held keys", () => {
    holdCombo();
    document.dispatchEvent(new Event("visibilitychange"));

    mousedown(document.getElementById("i"));
    expect(downloadsSent()).toHaveLength(1);
  });

  test("retries the DOWNLOAD every 300ms while the service worker is starting", async () => {
    vi.useFakeTimers();
    // Every send reports lastError: initial send + 2 retries, then gives up
    sendMessage.mockImplementation((message, cb) => {
      (global.chrome.runtime as any).lastError = { message: "SW starting" };
      if (cb) {
        cb();
      }
      delete (global.chrome.runtime as any).lastError;
    });

    holdCombo();
    mousedown(document.getElementById("i"));

    expect(downloadsSent()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(downloadsSent()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(300);
    expect(downloadsSent()).toHaveLength(3);

    // Retries exhausted: no further attempts
    await vi.advanceTimersByTimeAsync(1000);
    expect(downloadsSent()).toHaveLength(3);
  });

  test("cancels pending retries when click-to-save is disabled", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave({
      contentClickToSaveCombo: 90,
      contentClickToSaveButton: "LEFT_CLICK",
      links: false,
    });
    sendMessage.mockImplementation((_message, cb) => {
      (global.chrome.runtime as any).lastError = { message: "SW starting" };
      cb?.();
      delete (global.chrome.runtime as any).lastError;
    });
    window.dispatchEvent(keyEvent("keydown", 90));
    mousedown(document.getElementById("i"));
    const attempts = () => sendMessage.mock.calls.filter(([m]) => m.type === "DOWNLOAD").length;
    expect(attempts()).toBe(1);

    remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts()).toBe(1);
  });

  test("does not retry when the send succeeds", async () => {
    vi.useFakeTimers();
    holdCombo();
    mousedown(document.getElementById("i"));

    await vi.advanceTimersByTimeAsync(1000);
    expect(downloadsSent()).toHaveLength(1);
  });

  test("survives the extension being reloaded underneath the page", () => {
    sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });

    // Both the WAKE_WARM and DOWNLOAD sends throw synchronously
    expect(() => holdCombo()).not.toThrow();
    expect(() => mousedown(document.getElementById("i"))).not.toThrow();
    expect(sendMessage).toHaveBeenCalled();
  });
});
