import { vi } from "vitest";

const ClickToSave = (await import("../src/content/content.ts")).default;

describe("findSource", () => {
  afterEach(() => {
    document.getElementById("save-in-source-panel")?.remove();
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
    document.elementsFromPoint = vi.fn(() => []);

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
    document.elementsFromPoint = vi.fn(() =>
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
    document.elementsFromPoint = vi.fn(() => []);

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

  test("does not mistake embedded documents for media sources", () => {
    document.body.innerHTML =
      '<a href="/files/document.pdf"><iframe id="frame" src="/embedded/page.html"></iframe></a>';
    const frame = document.querySelector("iframe");

    expect(ClickToSave.findSource(event(frame), true)).toBe("http://localhost/files/document.pdf");
    expect(ClickToSave.findSource(event(frame), false)).toBeUndefined();
  });

  test("rejects unsafe media URLs before suppressing the page click", () => {
    document.body.innerHTML = '<img id="image" src="javascript:unsafe">';

    expect(ClickToSave.findSource(event(document.querySelector("img")), false)).toBeUndefined();
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

  test("comboToKeyCodes fails safely instead of weakening malformed shortcuts", () => {
    expect(ClickToSave.comboToKeyCodes("garbage")).toEqual([18]);
    expect(ClickToSave.comboToKeyCodes("Ctrl+garbage")).toEqual([18]);
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

// Simulate the callback-style storage API used by both Chrome and Firefox
// content scripts.
const importContentWithOptions = async (optionsBody: Record<string, unknown>) => {
  vi.resetModules();
  global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.());
  global.chrome.runtime.onMessage.addListener = vi.fn();
  global.chrome.storage.local.get = vi.fn((_keys, callback) => callback(optionsBody)) as any;
  (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
  await import("../src/content/content.ts");
};

describe("content.js initialisation", () => {
  const originalSendMessage = global.chrome.runtime.sendMessage;
  const originalAddListener = global.chrome.runtime.onMessage.addListener;
  const originalStorageGet = global.chrome.storage.local.get;
  const originalStorageOnChanged = (global.chrome.storage as any).onChanged;
  const originalFetch = global.fetch;

  afterEach(() => {
    document.getElementById("save-in-source-panel")?.remove();
    vi.useRealTimers();
    global.chrome.runtime.sendMessage = originalSendMessage;
    global.chrome.runtime.onMessage.addListener = originalAddListener;
    global.chrome.storage.local.get = originalStorageGet;
    (global.chrome.storage as any).onChanged = originalStorageOnChanged;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("keeps the source-panel listener available when local storage is unavailable", async () => {
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn();
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn(() => {
      throw new Error("Extension context invalidated");
    });
    await import("../src/content/content.ts");
    expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  test("does not wake the background when Page Sources is disabled", async () => {
    await importContentWithOptions({ sourcePanelEnabled: false });

    expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
    );
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("announces enabled Page Sources only after its message listener is installed", async () => {
    const calls: string[] = [];
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      calls.push(message.type);
      callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn(() => calls.push("LISTENER"));
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };

    await import("../src/content/content.ts");

    expect(calls).toEqual(["LISTENER", "SOURCE_PANEL_READY"]);
  });

  test("restores content option defaults when storage keys are removed", async () => {
    vi.resetModules();
    document.getElementById("save-in-source-panel")?.remove();
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    let runtimeListener: ((message: any) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true }),
    ) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await import("../src/content/content.ts");

    storageListener!({ sourcePanelEnabled: { oldValue: true, newValue: undefined } }, "local");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });

    expect(document.getElementById("save-in-source-panel")).toBeNull();
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
    await importContentWithOptions({ contentClickToSave: false });
    const storageListener = vi.mocked((global.chrome.storage as any).onChanged.addListener).mock
      .calls[0][0] as (changes: Record<string, any>, area: string) => void;
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
    await importContentWithOptions({ contentClickToSave: false });
    const storageListener = vi.mocked((global.chrome.storage as any).onChanged.addListener).mock
      .calls[0][0] as (changes: Record<string, any>, area: string) => void;

    storageListener({ contentClickToSave: { newValue: true } }, "sync");
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new Event("keydown");
    (keydown as any).keyCode = 89;
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("merges a late initial read with newer per-key storage settings", async () => {
    vi.resetModules();
    let storageCallback: ((response: any) => void) | undefined;
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) => {
      storageCallback = callback;
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
    storageCallback!({
      contentClickToSave: false,
      contentClickToSaveCombo: 18,
      contentClickToSaveButton: "LEFT_CLICK",
      links: false,
    });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new KeyboardEvent("keydown", { key: "y" });
    Object.defineProperty(keydown, "keyCode", { value: 89 });
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );

    document.body.innerHTML = `<a href="file.pdf"><span id="link">file</span></a>`;
    const linkClick = new MouseEvent("mousedown", { buttons: 2, bubbles: true, cancelable: true });
    document.querySelector("#link")!.dispatchEvent(linkClick);
    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "DOWNLOAD"),
    ).toHaveLength(0);

    window.dispatchEvent(new Event("focus"));
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("announces once when Page Sources becomes enabled in an existing tab", async () => {
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await importContentWithOptions({ sourcePanelEnabled: false });
    // importContentWithOptions installs a fresh mock, so capture its listener.
    storageListener = vi.mocked((global.chrome.storage as any).onChanged.addListener).mock
      .calls[0][0];

    storageListener!({ sourcePanelEnabled: { newValue: true } }, "local");
    storageListener!({ sourcePanelEnabled: { oldValue: true, newValue: false } }, "local");
    storageListener!({ sourcePanelEnabled: { oldValue: false, newValue: true } }, "local");

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SOURCE_PANEL_READY" },
      expect.any(Function),
    );
  });

  test("reconfigures an open Page Sources panel when its live options change", async () => {
    vi.useFakeTimers();
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    document.body.innerHTML = '<img src="cat.jpg">';
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        sourcePanelEnabled: true,
        sourcePanelBackgrounds: false,
        sourcePanelLive: true,
        sourcePanelPreviews: true,
      }),
    ) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await import("../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    const originalHost = document.getElementById("save-in-source-panel")!;
    expect(originalHost.shadowRoot!.querySelector(".source-link img")).not.toBeNull();

    storageListener!({ sourcePanelLive: { oldValue: true, newValue: false } }, "local");
    const liveReconfiguredHost = document.getElementById("save-in-source-panel")!;
    expect(liveReconfiguredHost).toBe(originalHost);

    storageListener!({ sourcePanelPreviews: { oldValue: true, newValue: false } }, "local");
    const reconfiguredHost = document.getElementById("save-in-source-panel")!;
    expect(reconfiguredHost).toBe(liveReconfiguredHost);
    expect(reconfiguredHost.shadowRoot!.querySelector(".source-link img")).toBeNull();

    storageListener!({ sourcePanelEnabled: { oldValue: true, newValue: false } }, "local");
    vi.advanceTimersByTime(90);
    expect(document.getElementById("save-in-source-panel")).toBeNull();
  });

  test("warms a sleeping background when Page Sources signals save intent", async () => {
    vi.useFakeTimers();
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    document.getElementById("save-in-source-panel")?.remove();
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        sourcePanelEnabled: true,
        sourcePanelBackgrounds: false,
        sourcePanelLive: false,
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    document.body.innerHTML = `<img src="cat.jpg">`;
    await import("../src/content/content.ts");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();

    const save = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".actions button:last-child")!;
    save.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    global.chrome.runtime.sendMessage = vi.fn((message: any, callback?: () => void) => {
      if (message.type === "DOWNLOAD") {
        (global.chrome.runtime as any).lastError = { message: "worker starting" };
        callback?.();
        delete (global.chrome.runtime as any).lastError;
      }
    }) as any;
    save.click();
    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "DOWNLOAD"),
    ).toHaveLength(1);

    vi.advanceTimersByTime(600);
    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "DOWNLOAD"),
    ).toHaveLength(3);
  });

  test("waits for a complete snapshot before announcing a concurrently enabled panel", async () => {
    vi.resetModules();
    let storageCallback: ((stored: Record<string, unknown>) => void) | undefined;
    let storageListener: ((changes: Record<string, any>, area: string) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) => {
      storageCallback = callback;
    }) as any;
    (global.chrome.storage as any).onChanged = {
      addListener: vi.fn((listener) => {
        storageListener = listener;
      }),
    };
    await import("../src/content/content.ts");

    storageListener!({ sourcePanelEnabled: { oldValue: false, newValue: true } }, "local");
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

    storageCallback!({ sourcePanelEnabled: false });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SOURCE_PANEL_READY" },
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
