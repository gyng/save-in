// @vitest-environment jsdom
import { vi } from "vitest";
import {
  DEFAULT_SOURCE_PANEL_COPY,
  isSourcePanelCopy,
} from "../../src/shared/source-panel-copy.ts";
import { DATA_URL_MAX_LENGTH } from "../../src/shared/data-url.ts";
import { CLICK_GESTURES, serializeClickToSaveBindings } from "../../src/shared/click-gesture.ts";
import { createLongClickReleaseSuppressor } from "../../src/content/click-gesture-model.ts";

const ClickToSave = (await import("../../src/content/content.ts")).default;

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

    expect(ClickToSave.findSource(event(img), false)).toEqual({
      url: "http://x.test/pic.png",
      kind: "image",
    });
  });

  test("reports a clicked video with its true source kind", () => {
    document.body.innerHTML = '<video id="v" src="http://x.test/clip.mp4"></video>';
    const video = document.getElementById("v");

    // The sourcekind: matcher and the source sidecar both read this kind, so a
    // video click must not degrade to "image" or be dropped.
    expect(ClickToSave.findSource(event(video), false)).toEqual({
      url: "http://x.test/clip.mp4",
      kind: "video",
    });
  });

  test("reports a clicked audio element with its true source kind", () => {
    document.body.innerHTML = '<audio id="a" src="http://x.test/track.mp3"></audio>';
    const audio = document.getElementById("a");

    expect(ClickToSave.findSource(event(audio), false)).toEqual({
      url: "http://x.test/track.mp3",
      kind: "audio",
    });
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
    ).toEqual({ url: "http://x.test/path.png", kind: "image" });
  });

  test("finds a composed-path link when the event target is not an element", () => {
    document.body.innerHTML = '<a id="link" href="https://example.test/file.pdf">file</a>';
    const link = document.querySelector<HTMLAnchorElement>("#link")!;

    expect(
      ClickToSave.findSource(
        { ...event(window), composedPath: () => [window, link, document] },
        true,
      ),
    ).toEqual({ url: "https://example.test/file.pdf", kind: "link" });
  });

  test("finds media below an overlay via elementsFromPoint", () => {
    document.body.innerHTML = '<div id="overlay"></div><img id="i" src="http://x.test/pic.png">';
    const overlay = document.getElementById("overlay");
    const img = document.getElementById("i");
    document.elementsFromPoint = vi.fn(() =>
      [overlay, img].filter((element): element is HTMLElement => element != null),
    );

    expect(ClickToSave.findSource(event(overlay), false)).toEqual({
      url: "http://x.test/pic.png",
      kind: "image",
    });
  });

  test("falls back to the enclosing link when no media is found (#226)", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), true)).toEqual({
      url: "http://localhost/files/doc.pdf",
      kind: "link",
    });
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
    ).toEqual({ url: "http://localhost/shadow.pdf", kind: "link" });
  });

  test("does not fall back to links when links are disabled", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), false)).toBeUndefined();
  });

  test("media wins over an enclosing link", () => {
    document.body.innerHTML = '<a href="/page.html"><img id="i" src="http://x.test/pic.png"></a>';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), true)).toEqual({
      url: "http://x.test/pic.png",
      kind: "image",
    });
  });

  test("prefers an enclosing link when requested", () => {
    document.body.innerHTML = '<a href="/page.html"><img id="i" src="http://x.test/pic.png"></a>';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), true, true)).toEqual({
      url: "http://localhost/page.html",
      kind: "link",
    });
  });

  test("prefers the media's wrapping link when an overlay owns the event", () => {
    document.body.innerHTML =
      '<div id="overlay"></div><a href="/page.html"><img id="i" src="http://x.test/pic.png"></a>';
    const overlay = document.getElementById("overlay");
    const img = document.getElementById("i");
    document.elementsFromPoint = vi.fn(() =>
      [overlay, img].filter((element): element is HTMLElement => element != null),
    );

    expect(ClickToSave.findSource(event(overlay), true, true)).toEqual({
      url: "http://localhost/page.html",
      kind: "link",
    });
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

    expect(ClickToSave.findSource(event(frame), true)).toEqual({
      url: "http://localhost/files/document.pdf",
      kind: "link",
    });
    expect(ClickToSave.findSource(event(frame), false)).toBeUndefined();
  });

  test("rejects unsafe media URLs before suppressing the page click", () => {
    document.body.innerHTML = '<img id="image" src="javascript:unsafe">';

    expect(ClickToSave.findSource(event(document.querySelector("img")), false)).toBeUndefined();
  });

  test("rejects an oversized inline payload before messaging the background", () => {
    const image = document.createElement("img");
    Object.defineProperty(image, "currentSrc", {
      value: `data:image/png,${"a".repeat(DATA_URL_MAX_LENGTH)}`,
    });

    expect(ClickToSave.findSource(event(image), false)).toBeUndefined();
  });

  test("rejects an oversized inline link payload", () => {
    const link = document.createElement("a");
    Object.defineProperty(link, "href", {
      value: `data:text/plain,${"a".repeat(DATA_URL_MAX_LENGTH)}`,
    });

    expect(ClickToSave.findSource(event(link), true)).toBeUndefined();
  });

  test("accepts an inline link payload within the cap", () => {
    const link = document.createElement("a");
    link.href = "data:text/plain,hello";

    expect(ClickToSave.findSource(event(link), true)).toEqual({
      url: "data:text/plain,hello",
      kind: "link",
    });
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
});

// Simulate the callback-style storage API used by both Chrome and Firefox
// content scripts.
const importContentWithOptions = async (optionsBody: Record<string, unknown>) => {
  vi.resetModules();
  global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.());
  global.chrome.runtime.onMessage.addListener = vi.fn();
  global.chrome.storage.local.get = vi.fn((_keys, callback) => callback(optionsBody)) as any;
  (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
  await import("../../src/content/content.ts");
};

const pushContentOptions = (options: Record<string, unknown>): void => {
  const listener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("Content runtime listener was not registered");
  Reflect.apply(listener, undefined, [
    { type: "CONTENT_OPTIONS_CHANGED", body: { options } },
    {},
    vi.fn(),
  ]);
};

describe("content.js initialisation", () => {
  test("acknowledges E2E content readiness only after initial options are applied", async () => {
    vi.resetModules();
    let storageCallback: ((response: Record<string, unknown>) => void) | undefined;
    let runtimeListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) => {
      storageCallback = callback;
    }) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    const pendingResponse = vi.fn();
    expect(runtimeListener?.({ type: "SAVE_IN_E2E_CONTENT_READY" }, {}, pendingResponse)).toBe(
      true,
    );
    expect(pendingResponse).not.toHaveBeenCalled();

    storageCallback?.({ contentClickToSave: true });
    expect(pendingResponse).toHaveBeenCalledOnce();
    expect(pendingResponse).toHaveBeenCalledWith({ type: "SAVE_IN_E2E_CONTENT_READY" });

    const readyResponse = vi.fn();
    expect(runtimeListener?.({ type: "SAVE_IN_E2E_CONTENT_READY" }, {}, readyResponse)).toBe(
      undefined,
    );
    expect(readyResponse).toHaveBeenCalledWith({ type: "SAVE_IN_E2E_CONTENT_READY" });
  });

  test("does not expose the content-readiness message outside E2E builds", async () => {
    vi.resetModules();
    (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = false;
    let runtimeListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) => callback({})) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };

    try {
      await import("../../src/content/content.ts");
      const respond = vi.fn();
      expect(runtimeListener?.({ type: "SAVE_IN_E2E_CONTENT_READY" }, {}, respond)).toBeUndefined();
      expect(respond).not.toHaveBeenCalled();
    } finally {
      (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = true;
    }
  });

  test("gives routing this page's title, so an automatic pagetitle rule can match", async () => {
    // The scan pre-matches candidates and the background re-matches them against
    // the sending tab. Without this the library default answers undefined, the
    // scan drops every source a pagetitle: rule selects, and the rule saves
    // nothing while the background and the route debugger both say it matches.
    document.title = "Cat Gallery";
    const { routingPorts } = await import("../../src/routing/ports.ts");

    expect(routingPorts.getCurrentTab()).toEqual({ title: "Cat Gallery" });
  });

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
    await import("../../src/content/content.ts");
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

  test("starts automatic discovery only for an enabled, valid automation ruleset", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    await importContentWithOptions({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      autoDownloadMaxPerPage: 20,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourcekind: image\nsourceurl: automatic\\.png$\ninto: automatic/",
    });

    await vi.waitFor(() =>
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          type: "AUTO_DOWNLOAD_SOURCE",
          body: {
            pageUrl: "http://localhost/",
            sourceUrl: "https://cdn.test/automatic.png",
            sourceKind: "image",
          },
        },
        expect.any(Function),
      ),
    );
  });

  test("wires the phase-B channel options through to a linked document candidate", async () => {
    document.body.innerHTML = '<a href="https://cdn.test/paper.pdf">paper</a>';
    await importContentWithOptions({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      autoDownloadDocuments: true,
      autoDownloadMaxPerPage: 20,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourcekind: document\nsourceurl: paper\\.pdf$\ninto: automatic/",
    });

    await vi.waitFor(() =>
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        {
          type: "AUTO_DOWNLOAD_SOURCE",
          body: {
            pageUrl: "http://localhost/",
            sourceUrl: "https://cdn.test/paper.pdf",
            sourceKind: "document",
            sourceChannel: "anchor",
          },
        },
        expect.any(Function),
      ),
    );
  });

  test("leaves a linked document alone when autoDownloadDocuments is off", async () => {
    document.body.innerHTML = '<a href="https://cdn.test/paper.pdf">paper</a>';
    await importContentWithOptions({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      autoDownloadMaxPerPage: 20,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourcekind: document\nsourceurl: paper\\.pdf$\ninto: automatic/",
    });

    await Promise.resolve();
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AUTO_DOWNLOAD_SOURCE" }),
      expect.any(Function),
    );
  });

  test("retries automatic saves and accepts a started response", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    let attempts = 0;
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "AUTO_DOWNLOAD_SOURCE") {
        attempts += 1;
        if (attempts < 3) {
          (global.chrome.runtime as any).lastError = { message: "worker starting" };
          callback?.();
          delete (global.chrome.runtime as any).lastError;
        } else {
          callback?.({ body: { status: "started" } });
        }
        return;
      }
      callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        filenamePatterns:
          "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };

    await import("../../src/content/content.ts");
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(600);

    expect(attempts).toBe(3);
  });

  test("tears down a pending automatic save when the option is disabled", async () => {
    vi.resetModules();
    document.body.innerHTML =
      '<img src="https://cdn.test/automatic.png"><img src="https://cdn.test/automatic-2.png">';
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type !== "AUTO_DOWNLOAD_SOURCE") callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        filenamePatterns:
          "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    await vi.waitFor(() =>
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "AUTO_DOWNLOAD_SOURCE" }),
        expect.any(Function),
      ),
    );

    pushContentOptions({ autoDownloadEnabled: false });
    await Promise.resolve();

    expect((global.chrome.storage as any).onChanged.addListener).not.toHaveBeenCalled();
  });

  test("clears a scheduled automatic-save retry when disabled", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "AUTO_DOWNLOAD_SOURCE") {
        (global.chrome.runtime as any).lastError = { message: "worker starting" };
        callback?.();
        delete (global.chrome.runtime as any).lastError;
      } else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        filenamePatterns:
          "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    await vi.runAllTicks();

    pushContentOptions({ autoDownloadEnabled: false });
    await vi.advanceTimersByTimeAsync(300);

    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "AUTO_DOWNLOAD_SOURCE"),
    ).toHaveLength(1);
  });

  test("contains a synchronous automatic-save messaging failure", async () => {
    vi.resetModules();
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "AUTO_DOWNLOAD_SOURCE") throw new Error("context invalidated");
      callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        filenamePatterns:
          "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };

    await expect(import("../../src/content/content.ts")).resolves.toBeDefined();
  });

  test("skips discovery sends that arrive after automatic saving is torn down", async () => {
    vi.resetModules();
    let discoverySend:
      | ((candidate: {
          pageUrl: string;
          sourceUrl: string;
          sourceKind: "image";
        }) => Promise<string>)
      | undefined;
    vi.doMock("../../src/content/auto-download.ts", () => ({
      createAutoDownloadDedup: () => ({ seen: new Set<string>(), limitNotified: false }),
      setupAutoDownloadDiscovery: vi.fn((options) => {
        discoverySend = options.send;
        return { stop: vi.fn() };
      }),
    }));
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        filenamePatterns: "context: ^auto$\npageurl: .\nsourceurl: .\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    pushContentOptions({ autoDownloadEnabled: false });

    await expect(
      discoverySend!({
        pageUrl: "http://localhost/",
        sourceUrl: "https://cdn.test/late.png",
        sourceKind: "image",
      }),
    ).resolves.toBe("skipped");
    vi.doUnmock("../../src/content/auto-download.ts");
  });

  test("reports the per-page limit to the background debug log", async () => {
    vi.resetModules();
    let discoveryOptions: { onLimitReached?: () => void } | undefined;
    vi.doMock("../../src/content/auto-download.ts", () => ({
      createAutoDownloadDedup: () => ({ seen: new Set<string>(), limitNotified: false }),
      setupAutoDownloadDiscovery: vi.fn((options) => {
        discoveryOptions = options;
        return { stop: vi.fn() };
      }),
    }));
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        autoDownloadMaxPerPage: 3,
        filenamePatterns: "context: ^auto$\npageurl: .\nsourceurl: .\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    discoveryOptions?.onLimitReached?.();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "AUTO_DOWNLOAD_LIMIT_REACHED", body: { maxPerPage: 3 } },
      expect.any(Function),
    );
    vi.doUnmock("../../src/content/auto-download.ts");
  });

  test("tolerates a dead extension context when reporting the limit", async () => {
    vi.resetModules();
    let discoveryOptions: { onLimitReached?: () => void } | undefined;
    vi.doMock("../../src/content/auto-download.ts", () => ({
      createAutoDownloadDedup: () => ({ seen: new Set<string>(), limitNotified: false }),
      setupAutoDownloadDiscovery: vi.fn((options) => {
        discoveryOptions = options;
        return { stop: vi.fn() };
      }),
    }));
    global.chrome.runtime.sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated");
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        autoDownloadMaxPerPage: 3,
        filenamePatterns: "context: ^auto$\npageurl: .\nsourceurl: .\ninto: automatic/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    expect(() => discoveryOptions?.onLimitReached?.()).not.toThrow();
    vi.doUnmock("../../src/content/auto-download.ts");
  });

  test("does not scan page sources when automatic saving is disabled", async () => {
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    await importContentWithOptions({
      autoDownloadEnabled: false,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourcekind: image\nsourceurl: automatic\\.png$\ninto: automatic/",
    });

    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AUTO_DOWNLOAD_SOURCE" }),
      expect.any(Function),
    );
  });

  test("gates automatic-save dispatch while the page is on the disable list", async () => {
    // Discovery mounts by its own options; the disable list is enforced at
    // dispatch time, so a matching page never sends AUTO_DOWNLOAD_SOURCE.
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    await importContentWithOptions({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      perSiteDisableList: "*://localhost/*",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AUTO_DOWNLOAD_SOURCE" }),
      expect.any(Function),
    );
  });

  test("gates automatic-save dispatch while the disable list cannot be read", async () => {
    // A line the parser rejects — here the ordinary scheme-less mistake — used
    // to match nothing and so disable nothing, saving on the very site the user
    // wrote it to exclude. An unreadable list withholds every surface instead.
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    await importContentWithOptions({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
      perSiteDisableList: "localhost/*",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AUTO_DOWNLOAD_SOURCE" }),
      expect.any(Function),
    );
  });

  test("removing the site from the disable list resumes automatic saves without a reload", async () => {
    vi.resetModules();
    document.body.innerHTML = '<img src="https://cdn.test/automatic.png">';
    global.chrome.runtime.sendMessage = vi.fn((message, callback) =>
      callback?.(
        (message as any)?.type === "AUTO_DOWNLOAD_SOURCE"
          ? { type: "AUTO_DOWNLOAD_SOURCE", body: { status: "started" } }
          : undefined,
      ),
    ) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({
        autoDownloadEnabled: true,
        autoDownloadLive: false,
        filenamePatterns:
          "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: automatic/",
        perSiteDisableList: "*://localhost/*",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    await Promise.resolve();
    await Promise.resolve();
    const autoSends = () =>
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "AUTO_DOWNLOAD_SOURCE");
    expect(autoSends()).toHaveLength(0);

    // The disabled scan consumed nothing, so the option change remounts
    // discovery and the already-present image is adopted immediately.
    pushContentOptions({ perSiteDisableList: "" });
    await vi.waitFor(() => expect(autoSends()).toHaveLength(1));

    // A later disable-list edit that does not touch this page remounts with
    // the page-owned dedup state: the already-saved image is not re-sent.
    pushContentOptions({ perSiteDisableList: "*://unrelated.example/*" });
    await Promise.resolve();
    await Promise.resolve();
    expect(autoSends()).toHaveLength(1);

    // Editing the rules resets the dedup state (the 4.0 contract: edited
    // rules apply to media already on the page), so the image is re-sent.
    pushContentOptions({
      filenamePatterns:
        "context: ^auto$\npageurl: ^http://localhost/\nsourceurl: automatic\\.png$\ninto: rescan/",
    });
    await vi.waitFor(() => expect(autoSends()).toHaveLength(2));
  });

  test("mounts click-to-save on a disabled page but ignores the click", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContentWithOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 17,
      contentClickToSaveButton: "RIGHT_CLICK",
      perSiteDisableList: "*://localhost/*",
    });
    document.body.innerHTML = '<img id="disabled-img" src="http://x.test/pic.png">';
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = addEventListener.mock.calls.findLast(([type]) => type === "keydown")?.[1] as (
      event: unknown,
    ) => void;
    const mousedown = addEventListener.mock.calls.findLast(
      ([type]) => type === "mousedown",
    )?.[1] as ((event: unknown) => void) | undefined;

    // The feature installs its listeners regardless of the disable list.
    expect(mousedown).toBeTypeOf("function");
    keydown({ isTrusted: true, keyCode: 17, key: "Control" });
    const img = document.getElementById("disabled-img");
    mousedown!({
      isTrusted: true,
      button: 2,
      buttons: 2,
      target: img,
      clientX: 0,
      clientY: 0,
      composedPath: () => [img],
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });

    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "DOWNLOAD"),
    ).toHaveLength(0);
  });

  test("re-enables click-to-save after a pushState navigation off the disable list", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    history.pushState(null, "", "/disabled/");
    await importContentWithOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 17,
      contentClickToSaveButton: "LEFT_CLICK",
      perSiteDisableList: "*://localhost/disabled/*",
    });
    document.body.innerHTML = '<img id="spa-img" src="http://x.test/pic.png">';
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = addEventListener.mock.calls.findLast(([type]) => type === "keydown")?.[1] as (
      event: unknown,
    ) => void;
    const mousedown = addEventListener.mock.calls.findLast(
      ([type]) => type === "mousedown",
    )?.[1] as (event: unknown) => void;
    const img = document.getElementById("spa-img");
    const click = () =>
      mousedown({
        isTrusted: true,
        button: 0,
        buttons: 1,
        target: img,
        clientX: 0,
        clientY: 0,
        composedPath: () => [img],
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      });
    const downloads = () =>
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "DOWNLOAD");
    keydown({ isTrusted: true, keyCode: 17, key: "Control" });

    // Still on the disabled path: the click is ignored.
    click();
    expect(downloads()).toHaveLength(0);

    // A single-page-app navigation moves off the disable list with no options
    // change; the same interaction now saves.
    history.pushState(null, "", "/allowed/");
    click();
    expect(downloads()).toHaveLength(1);

    history.pushState(null, "", "/");
  });

  test("does not announce Page Sources readiness on a disabled page", async () => {
    const calls: string[] = [];
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      calls.push(message.type);
      callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn(() => calls.push("LISTENER"));
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, perSiteDisableList: "*://localhost/*" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };

    await import("../../src/content/content.ts");

    expect(calls).toEqual(["LISTENER"]);
  });

  test("lets an explicit forced toggle open Page Sources on a disabled page", async () => {
    document.getElementById("save-in-source-panel")?.remove();
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, perSiteDisableList: "*://localhost/*" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    // TOGGLE_SOURCE_PANEL is only sent by the context menu / keyboard command, so
    // a forced toggle is an explicit user action that opens even a disabled page.
    runtimeListener!({ type: "TOGGLE_SOURCE_PANEL", body: { force: true } });

    expect(document.getElementById("save-in-source-panel")).not.toBeNull();

    // An explicit close is always honored, even while disabled.
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: false } });
    expect(document.getElementById("save-in-source-panel")?.classList).toContain("closing");
  });

  test("keeps an ambient state restore gated on a disabled page", async () => {
    document.getElementById("save-in-source-panel")?.remove();
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, perSiteDisableList: "*://localhost/*" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    // A background-initiated open (state restore) stays gated on a disabled page.
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });

    expect(document.getElementById("save-in-source-panel")).toBeNull();
  });

  test("closes an open Page Sources panel when the disable list newly matches", async () => {
    document.getElementById("save-in-source-panel")?.remove();
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    document.body.innerHTML = '<img src="cat.jpg">';
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    expect(document.getElementById("save-in-source-panel")).not.toBeNull();

    pushContentOptions({ perSiteDisableList: "*://localhost/*" });

    expect(document.getElementById("save-in-source-panel")?.classList).toContain("closing");
  });

  test("a force-opened panel on a disabled page survives unrelated option changes", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    document.body.innerHTML = '<img src="cat.jpg">';
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, perSiteDisableList: "*://localhost/*" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "TOGGLE_SOURCE_PANEL", body: { force: true } });
    expect(document.getElementById("save-in-source-panel")).not.toBeNull();

    // The page never transitioned onto the list (it was already on it when
    // the panel was deliberately opened), so unrelated option edits must not
    // revoke the explicit open.
    pushContentOptions({ sourcePanelBackgrounds: true });
    pushContentOptions({ perSiteDisableList: "*://localhost/*\n*://other.example/*" });

    const panel = document.getElementById("save-in-source-panel");
    expect(panel).not.toBeNull();
    expect(panel?.classList).not.toContain("closing");
  });

  test("lets an explicit user toggle open Page Sources while it is disabled", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: false }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "TOGGLE_SOURCE_PANEL", body: { force: true } });
    pushContentOptions({ sourcePanelLive: false });

    expect(document.getElementById("save-in-source-panel")).not.toBeNull();
  });

  test("loads, caches, and applies translated Page Sources copy", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") {
        callback?.({
          type: "SOURCE_PANEL_COPY",
          body: { ...DEFAULT_SOURCE_PANEL_COPY, title: "Sources traduites" },
        });
      } else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "fr" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await vi.waitFor(() =>
      expect(
        document.getElementById("save-in-source-panel")?.shadowRoot?.querySelector("h2")
          ?.textContent,
      ).toBe("Sources traduites"),
    );
    document.getElementById("save-in-source-panel")?.remove();
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await vi.waitFor(() => expect(document.getElementById("save-in-source-panel")).not.toBeNull());

    expect(
      vi
        .mocked(global.chrome.runtime.sendMessage)
        .mock.calls.filter(([message]) => (message as any)?.type === "SOURCE_PANEL_COPY"),
    ).toHaveLength(1);
  });

  test("uses the latest locale when localization changes during a request", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    let copyCallback: ((response: unknown) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") copyCallback = callback;
      else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "fr" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await vi.waitFor(() => expect(copyCallback).toBeTypeOf("function"));
    pushContentOptions({ uiLocale: "en" });

    copyCallback!({
      type: "SOURCE_PANEL_COPY",
      body: { ...DEFAULT_SOURCE_PANEL_COPY, title: "Ancien titre" },
    });

    await vi.waitFor(() =>
      expect(
        document.getElementById("save-in-source-panel")?.shadowRoot?.querySelector("h2")
          ?.textContent,
      ).toBe("Translated<o_sPageSources>"),
    );
  });

  test("reuses native copy when a pending translation reverts to the default locale", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    let copyCallback: ((response: unknown) => void) | undefined;
    vi.resetModules();
    const getUILanguage = global.chrome.i18n.getUILanguage;
    Reflect.deleteProperty(global.chrome.i18n, "getUILanguage");
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") copyCallback = callback;
      else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await Promise.resolve();
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: false } });
    pushContentOptions({ uiLocale: "fr" });
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await vi.waitFor(() => expect(copyCallback).toBeTypeOf("function"));
    pushContentOptions({ uiLocale: "" });

    copyCallback!({ type: "SOURCE_PANEL_COPY", body: DEFAULT_SOURCE_PANEL_COPY });
    await vi.waitFor(() =>
      expect(document.getElementById("save-in-source-panel")?.classList).not.toContain("closing"),
    );

    global.chrome.i18n.getUILanguage = getUILanguage;
  });

  test("contains an exception raised while applying asynchronous panel copy", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") {
        callback?.({ type: "SOURCE_PANEL_COPY", body: DEFAULT_SOURCE_PANEL_COPY });
      } else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "fr" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");
    const append = vi.spyOn(document.documentElement, "append").mockImplementation(() => {
      throw new Error("page became unavailable");
    });

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await vi.waitFor(() => expect(append).toHaveBeenCalled());
  });

  test("falls back when translated Page Sources copy is invalid", async () => {
    expect(isSourcePanelCopy(null)).toBe(false);
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") {
        callback?.({
          type: "SOURCE_PANEL_COPY",
          body: { ...DEFAULT_SOURCE_PANEL_COPY, copiedUrlsTemplate: 7 },
        });
      } else callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "fr" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });

    await vi.waitFor(() =>
      expect(
        document.getElementById("save-in-source-panel")?.shadowRoot?.querySelector("h2")
          ?.textContent,
      ).toBe(DEFAULT_SOURCE_PANEL_COPY.title),
    );
  });

  test("falls back when requesting translated Page Sources copy throws", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((message, callback) => {
      if (message.type === "SOURCE_PANEL_COPY") throw new Error("context invalidated");
      callback?.();
    }) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true, sourcePanelBackgrounds: false, uiLocale: "fr" }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });

    await vi.waitFor(() =>
      expect(
        document.getElementById("save-in-source-panel")?.shadowRoot?.querySelector("h2")
          ?.textContent,
      ).toBe(DEFAULT_SOURCE_PANEL_COPY.title),
    );
  });

  test("keeps automatic Page Sources messages disabled without an override", async () => {
    let runtimeListener: ((message: any) => void) | undefined;
    vi.resetModules();
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: false }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    runtimeListener!({ type: "UNRELATED" });

    expect(document.getElementById("save-in-source-panel")).toBeNull();
  });

  test("handles a regular Page Sources toggle without forcing disabled state", async () => {
    await importContentWithOptions({ sourcePanelEnabled: true, sourcePanelBackgrounds: false });
    const runtimeListener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock
      .calls[0]![0] as (message: any) => void;

    runtimeListener({ type: "TOGGLE_SOURCE_PANEL" });
    await Promise.resolve();

    expect(document.getElementById("save-in-source-panel")).not.toBeNull();
  });

  test.each([false, true])(
    "contains automatic-rule messaging when the extension context throws: %s",
    async (throws) => {
      document.body.innerHTML = '<img src="https://cdn.test/cat.jpg">';
      await importContentWithOptions({ sourcePanelEnabled: true, sourcePanelBackgrounds: false });
      const sendMessage = vi.mocked(global.chrome.runtime.sendMessage);
      sendMessage.mockImplementation((message, callback) => {
        const respond = typeof callback === "function" ? callback : undefined;
        if ((message as { type?: string }).type === "CREATE_SOURCE_RULE") {
          if (throws) throw new Error("context invalidated");
          respond?.({ type: "OK" });
          return;
        }
        respond?.();
      });
      const runtimeListener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock
        .calls[0]![0] as (message: any) => void;
      runtimeListener({ type: "SET_SOURCE_PANEL", body: { open: true } });
      await Promise.resolve();
      const action = document
        .getElementById("save-in-source-panel")!
        .shadowRoot!.querySelectorAll<HTMLButtonElement>(".action-menu button")[1]!;

      expect(() => action.click()).not.toThrow();
      await Promise.resolve();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "CREATE_SOURCE_RULE" }),
        expect.any(Function),
      );
    },
  );

  test("closes Page Sources in response to explicit background state", async () => {
    await importContentWithOptions({ sourcePanelEnabled: true, sourcePanelBackgrounds: false });
    const runtimeListener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock
      .calls[0]![0] as (message: any) => void;
    runtimeListener({ type: "SET_SOURCE_PANEL", body: { open: true } });
    await Promise.resolve();
    expect(document.getElementById("save-in-source-panel")).not.toBeNull();

    runtimeListener({ type: "SET_SOURCE_PANEL", body: { open: false } });

    expect(document.getElementById("save-in-source-panel")?.classList).toContain("closing");
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

    await import("../../src/content/content.ts");

    expect(calls).toEqual(["LISTENER", "SOURCE_PANEL_READY"]);
  });

  test("restores content option defaults when storage keys are removed", async () => {
    vi.resetModules();
    document.getElementById("save-in-source-panel")?.remove();
    let runtimeListener: ((message: any) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.storage.local.get = vi.fn((_keys, callback) =>
      callback({ sourcePanelEnabled: true }),
    ) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn((listener) => {
      runtimeListener = listener;
    });
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    pushContentOptions({ sourcePanelEnabled: undefined });
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });

    expect(document.getElementById("save-in-source-panel")).toBeNull();
  });

  test("wires up click-to-save when the option is enabled", async () => {
    // Distinct combo/button so this stray listener set stays inert during
    // the setupClickToSave tests below
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContentWithOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 17,
      contentClickToSaveButton: "RIGHT_CLICK",
      links: false,
    });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = addEventListener.mock.calls.find(([type]) => type === "keydown")?.[1] as
      | EventListener
      | undefined;
    expect(keydown).toBeTypeOf("function");
    keydown!({ isTrusted: true, key: "Control", keyCode: 17 } as KeyboardEvent);

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );
  });

  test("updates an existing page when click-to-save settings change", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContentWithOptions({ contentClickToSave: false });
    expect((global.chrome.storage as any).onChanged.addListener).not.toHaveBeenCalled();

    pushContentOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 90,
      contentClickToSaveButton: "RIGHT_CLICK",
      links: false,
    });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydownCall = addEventListener.mock.calls.find(([type]) => type === "keydown");
    const keydown = keydownCall?.[1] as EventListener | undefined;
    const listenerOptions = keydownCall?.[2] as AddEventListenerOptions | undefined;
    expect(keydown).toBeTypeOf("function");
    expect(listenerOptions?.signal?.aborted).toBe(false);
    keydown!({ isTrusted: true, key: "z", keyCode: 90 } as KeyboardEvent);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "WAKE_WARM" },
      expect.any(Function),
    );

    pushContentOptions({ contentClickToSave: false });
    expect(listenerOptions?.signal?.aborted).toBe(true);
  });

  test("installs page-owned long-release listeners lazily and only once", async () => {
    vi.useFakeTimers();
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContentWithOptions({ contentClickToSave: false });
    const pageOwnedListeners = (eventType: string) =>
      addEventListener.mock.calls.filter(
        ([type, , options]) =>
          type === eventType && !(options as AddEventListenerOptions | undefined)?.signal,
      );
    expect(pageOwnedListeners("mousedown")).toHaveLength(0);

    pushContentOptions({
      contentClickToSave: true,
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
      ]),
    });
    expect(pageOwnedListeners("mousedown")).toHaveLength(1);

    pushContentOptions({ contentClickToSaveLongPressMs: 750 });
    expect(pageOwnedListeners("mousedown")).toHaveLength(1);

    document.body.innerHTML = '<img id="long-release" src="http://x.test/held.png">';
    const image = document.getElementById("long-release");
    const pageMousedown = pageOwnedListeners("mousedown")[0]?.[1] as EventListener | undefined;
    pageMousedown?.({ isTrusted: true, button: 0 } as MouseEvent);
    const featureMousedown = addEventListener.mock.calls.findLast(
      ([type, , options]) =>
        type === "mousedown" && Boolean((options as AddEventListenerOptions | undefined)?.signal),
    )?.[1] as EventListener | undefined;
    featureMousedown?.({
      isTrusted: true,
      button: 0,
      buttons: 1,
      target: image,
      clientX: 0,
      clientY: 0,
      composedPath: () => [image],
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent);
    await vi.advanceTimersByTimeAsync(750);

    // Neither page-generated input nor another mouse button may disarm a
    // completed primary hold before its real release sequence arrives.
    pageMousedown?.({ isTrusted: false, button: 0 } as MouseEvent);
    pageMousedown?.({ isTrusted: true, button: 1 } as MouseEvent);
    const pageMouseup = pageOwnedListeners("mouseup")[0]?.[1] as EventListener | undefined;
    pageMouseup?.({ isTrusted: true, button: 0 } as MouseEvent);
    const transientMouseup = addEventListener.mock.calls.findLast(
      ([type, , options]) =>
        type === "mouseup" && Boolean((options as AddEventListenerOptions | undefined)?.signal),
    )?.[1] as EventListener | undefined;
    transientMouseup?.({ isTrusted: true, button: 0, type: "mouseup" } as MouseEvent);
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const pageClick = pageOwnedListeners("click")[0]?.[1] as EventListener | undefined;
    pageClick?.({
      isTrusted: true,
      button: 0,
      detail: 1,
      preventDefault,
      stopImmediatePropagation,
    } as unknown as MouseEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  test("remounts click-to-save when the versioned gesture bindings change", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    await importContentWithOptions({
      contentClickToSave: true,
      contentClickToSaveBindings: "",
      contentClickToSaveCombo: "Alt",
      contentClickToSaveButton: "LEFT_CLICK",
    });
    const initialMousedown = addEventListener.mock.calls.find(
      ([type, , options]) =>
        type === "mousedown" && Boolean((options as AddEventListenerOptions | undefined)?.signal),
    );
    const initialOptions = initialMousedown?.[2] as AddEventListenerOptions | undefined;

    pushContentOptions({
      contentClickToSaveBindings: serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
      ]),
    });

    const mousedownListeners = addEventListener.mock.calls.filter(
      ([type, , options]) =>
        type === "mousedown" && Boolean((options as AddEventListenerOptions | undefined)?.signal),
    );
    const currentOptions = mousedownListeners.at(-1)?.[2] as AddEventListenerOptions | undefined;
    expect(initialOptions?.signal?.aborted).toBe(true);
    expect(currentOptions?.signal?.aborted).toBe(false);
    expect(mousedownListeners).toHaveLength(2);
  });

  test("ignores unrelated content messages", async () => {
    await importContentWithOptions({ contentClickToSave: false });
    const runtimeListener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock
      .calls[0]?.[0];

    runtimeListener?.({ type: "UNRELATED", body: { contentClickToSave: true } }, {}, vi.fn());
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = new Event("keydown");
    (keydown as any).keyCode = 89;
    window.dispatchEvent(keydown);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("returns metadata only for the most recently context-clicked link", async () => {
    await importContentWithOptions({ contentClickToSave: false });
    document.body.innerHTML =
      '<a href="/full.jpg" title="Full size" download="original.jpg"><span>Photo</span></a>';
    document.querySelector("span")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const runtimeListener = vi.mocked(global.chrome.runtime.onMessage.addListener).mock
      .calls[0]?.[0];
    const respond = vi.fn();

    runtimeListener?.(
      {
        type: "SAVE_IN_CONTEXT_LINK_METADATA",
        body: { linkUrl: "http://localhost/full.jpg" },
      },
      {},
      respond,
    );
    expect(respond).toHaveBeenLastCalledWith({
      href: "http://localhost/full.jpg",
      title: "Full size",
      download: "original.jpg",
    });

    runtimeListener?.(
      { type: "SAVE_IN_CONTEXT_LINK_METADATA", body: { linkUrl: "https://stale.test/" } },
      {},
      respond,
    );
    expect(respond).toHaveBeenLastCalledWith(null);
    document.body.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    runtimeListener?.(
      {
        type: "SAVE_IN_CONTEXT_LINK_METADATA",
        body: { linkUrl: "http://localhost/full.jpg" },
      },
      {},
      respond,
    );
    expect(respond).toHaveBeenLastCalledWith(null);
  });

  test("merges a late initial read with newer pushed settings", async () => {
    vi.resetModules();
    const addEventListener = vi.spyOn(window, "addEventListener");
    let storageCallback: ((response: any) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) => {
      storageCallback = callback;
    }) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    pushContentOptions({});
    pushContentOptions({
      contentClickToSave: true,
      contentClickToSaveCombo: 89,
      contentClickToSaveButton: "RIGHT_CLICK",
      filenamePatterns: "newer-rules",
    });
    storageCallback!({
      contentClickToSave: false,
      contentClickToSaveCombo: 18,
      contentClickToSaveButton: "LEFT_CLICK",
      links: false,
    });

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    const keydown = addEventListener.mock.calls.find(([type]) => type === "keydown")?.[1] as
      | EventListener
      | undefined;
    expect(keydown).toBeTypeOf("function");
    keydown!({ isTrusted: true, key: "y", keyCode: 89 } as KeyboardEvent);
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

    pushContentOptions({ links: undefined, filenamePatterns: 7 });
    pushContentOptions({ links: undefined });
  });

  test("announces once when Page Sources becomes enabled in an existing tab", async () => {
    await importContentWithOptions({ sourcePanelEnabled: false });

    pushContentOptions({ sourcePanelEnabled: true });
    pushContentOptions({ sourcePanelEnabled: false });
    pushContentOptions({ sourcePanelEnabled: true });

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SOURCE_PANEL_READY" },
      expect.any(Function),
    );
  });

  test("reconfigures an open Page Sources panel when its live options change", async () => {
    vi.useFakeTimers();
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
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    const originalHost = document.getElementById("save-in-source-panel")!;
    expect(originalHost.shadowRoot!.querySelector(".source-link img")).not.toBeNull();

    pushContentOptions({ sourcePanelLive: false });
    const liveReconfiguredHost = document.getElementById("save-in-source-panel")!;
    expect(liveReconfiguredHost).toBe(originalHost);

    pushContentOptions({ sourcePanelPreviews: false });
    const reconfiguredHost = document.getElementById("save-in-source-panel")!;
    expect(reconfiguredHost).toBe(liveReconfiguredHost);
    expect(reconfiguredHost.shadowRoot!.querySelector(".source-link img")).toBeNull();

    pushContentOptions({ uiTheme: "dark" });
    expect(document.getElementById("save-in-source-panel")).toBe(reconfiguredHost);
    expect(reconfiguredHost.dataset.theme).toBe("dark");

    pushContentOptions({ sourcePanelEnabled: false });
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
    await import("../../src/content/content.ts");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();

    const save = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".primary-action")!;
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

  test("sends Page Sources CSS evidence for the saved element", async () => {
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
        filenamePatterns: "css: img\ninto: images/",
      }),
    ) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    document.body.innerHTML = `<img src="cat.jpg">`;
    await import("../../src/content/content.ts");
    runtimeListener!({ type: "SET_SOURCE_PANEL", body: { open: true } });
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();

    document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".primary-action")!
      .click();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DOWNLOAD",
        body: expect.objectContaining({
          info: expect.objectContaining({ matchedCssSelectorsByOrigin: [["img"]] }),
        }),
      }),
      expect.any(Function),
    );

    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".primary-action")!
      .click();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DOWNLOAD" }),
      expect.any(Function),
    );

    pushContentOptions({ filenamePatterns: "css: body img\ninto: updated/" });
    vi.mocked(global.chrome.runtime.sendMessage).mockClear();
    document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".primary-action")!
      .click();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DOWNLOAD",
        body: expect.objectContaining({
          info: expect.objectContaining({ matchedCssSelectorsByOrigin: [["body img"]] }),
        }),
      }),
      expect.any(Function),
    );
  });

  test("waits for a complete snapshot before announcing a concurrently enabled panel", async () => {
    vi.resetModules();
    let storageCallback: ((stored: Record<string, unknown>) => void) | undefined;
    global.chrome.runtime.sendMessage = vi.fn((_message, callback) => callback?.()) as any;
    global.chrome.runtime.onMessage.addListener = vi.fn();
    global.chrome.storage.local.get = vi.fn((_keys, callback) => {
      storageCallback = callback;
    }) as any;
    (global.chrome.storage as any).onChanged = { addListener: vi.fn() };
    await import("../../src/content/content.ts");

    pushContentOptions({ sourcePanelEnabled: true });
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
  const acceptTestInput = () => true;

  // One listener set for the whole block: setupClickToSave registers window
  // listeners that cannot be removed, so state is reset between tests by
  // firing the same events a real page would (focus, keyup)
  beforeAll(() => {
    ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: 18,
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
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

  const mousedown = (target: EventTarget | null, buttons = 1, detail = 1) => {
    const button =
      buttons === 4 ? 1 : buttons === 2 ? 2 : buttons === 8 ? 3 : buttons === 16 ? 4 : 0;
    const e = new MouseEvent("mousedown", {
      button,
      buttons,
      detail,
      bubbles: true,
      cancelable: true,
    });
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
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Meta",
        contentClickToSaveButton: "RIGHT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
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
          info: {
            pageUrl: `${window.location}`,
            srcUrl: "http://x.test/pic.png",
            sourceKind: "image",
            gesture: "left-click",
          },
        },
      },
      expect.any(Function),
    );
  });

  test("click-to-save sends CSS matches for the exact clicked element", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Ctrl",
        contentClickToSaveButton: "BACK_CLICK",
        links: false,
        filenamePatterns: "css: article img:not(.avatar)\ninto: articles/",
      },
      acceptTestInput,
    );
    document.body.innerHTML = '<article><img id="hero" src="http://x.test/hero.png"></article>';
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(document.getElementById("hero"), 8);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DOWNLOAD",
        body: expect.objectContaining({
          info: expect.objectContaining({
            matchedCssSelectorsByOrigin: [["article img:not(.avatar)"]],
          }),
        }),
      }),
      expect.any(Function),
    );
    remove();
  });

  test("click-to-save honors the Prefer links page filter", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Ctrl",
        contentClickToSaveButton: "BACK_CLICK",
        links: true,
        preferLinks: false,
        preferLinksFilterEnabled: true,
        preferLinksFilter: "localhost",
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<a href="/original-page"><img id="wrapped" src="http://x.test/preview.png"></a>';
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(document.getElementById("wrapped"), 8);

    expect(downloadsSent().at(-1)?.[0]).toMatchObject({
      body: {
        url: "http://localhost/original-page",
        info: { sourceKind: "link" },
      },
    });
    remove();
  });

  test("click-to-save carries link title and download attributes", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Ctrl",
        contentClickToSaveButton: "BACK_CLICK",
        links: true,
        preferLinks: true,
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<a href="/original.jpg" title="Full size" download="original.jpg"><img id="wrapped" src="http://x.test/preview.png"></a>';
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(document.getElementById("wrapped"), 8);

    expect(downloadsSent().at(-1)?.[0]).toMatchObject({
      body: {
        url: "http://localhost/original.jpg",
        info: {
          sourceKind: "link",
          linkTitle: "Full size",
          linkDownload: "original.jpg",
        },
      },
    });
    remove();
  });

  test.each([
    [{ preferLinks: true }, "http://localhost/original-page", "link"],
    [{ preferLinksFilterEnabled: true }, "http://x.test/preview.png", "image"],
  ] as const)("click-to-save resolves partial preference settings", (preference, url, kind) => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Ctrl",
        contentClickToSaveButton: "BACK_CLICK",
        links: true,
        ...preference,
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<a href="/original-page"><img id="wrapped" src="http://x.test/preview.png"></a>';
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(document.getElementById("wrapped"), 8);

    expect(downloadsSent().at(-1)?.[0]).toMatchObject({
      body: { url, info: { sourceKind: kind } },
    });
    remove();
  });

  test("accepts a successful runtime download acknowledgement", async () => {
    sendMessage.mockImplementation((_message, callback) =>
      callback?.({ type: "DOWNLOAD", body: { status: "OK" } }),
    );
    holdCombo();

    mousedown(document.getElementById("i"));
    await Promise.resolve();

    expect(downloadsSent()).toHaveLength(1);
  });

  test("a two-modifier shortcut requires both modifiers", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: "Ctrl+Shift",
        contentClickToSaveButton: "BACK_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");

    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 8);
    expect(downloadsSent()).toHaveLength(0);

    window.dispatchEvent(keyEvent("keydown", 16));
    mousedown(img, 8);
    expect(downloadsSent()).toHaveLength(1);
    remove();
  });

  test("ignores page-generated shortcut and mouse events", () => {
    const remove = ClickToSave.setupClickToSave({
      contentClickToSaveCombo: "Ctrl+Shift",
      contentClickToSaveButton: "BACK_CLICK",
      links: false,
    });
    const img = document.getElementById("i");

    window.dispatchEvent(keyEvent("keydown", 17));
    window.dispatchEvent(keyEvent("keydown", 16));
    mousedown(img, 8);

    expect(sendMessage).not.toHaveBeenCalled();
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

  test("supports multiple distinct mouse gestures", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
          { gesture: CLICK_GESTURES.BACK, combo: "Shift" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");

    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 4);
    window.dispatchEvent(keyEvent("keyup", 17));
    window.dispatchEvent(keyEvent("keydown", 16));
    mousedown(img, 8);

    expect(downloadsSent().map(([message]) => message.body.info.gesture)).toEqual([
      "middle-click",
      "back-click",
    ]);
    remove();
  });

  test("does not register long-press movement listeners when no long gesture is configured", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );

    const registered = addEventListener.mock.calls.map(([type]) => type);
    expect(registered).not.toContain("mousemove");
    expect(registered).not.toContain("mouseup");
    expect(registered).not.toContain("dragstart");
    expect(registered).not.toContain("mouseout");
    remove();
    addEventListener.mockRestore();
  });

  test("registers long-press movement listeners only while a hold is active", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );

    expect(addEventListener.mock.calls.map(([type]) => type)).not.toContain("mousemove");
    mousedown(document.getElementById("i"));
    const registeredDuringHold = addEventListener.mock.calls.map(([type]) => type);
    expect(registeredDuringHold).toEqual(
      expect.arrayContaining(["mousemove", "mouseup", "dragstart", "mouseout"]),
    );

    remove();
    addEventListener.mockRestore();
  });

  test("double-left saves once on the second press over the same source", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    window.dispatchEvent(keyEvent("keydown", 17));
    const img = document.getElementById("i");

    const first = mousedown(img, 1, 1);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(downloadsSent()).toHaveLength(0);
    const second = mousedown(img, 1, 2);

    expect(second.preventDefault).toHaveBeenCalled();
    expect(downloadsSent()).toHaveLength(1);
    expect(downloadsSent()[0]?.[0].body.info.gesture).toBe("double-left-click");

    const click = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true });
    vi.spyOn(click, "preventDefault");
    vi.spyOn(click, "stopImmediatePropagation");
    img?.dispatchEvent(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopImmediatePropagation).toHaveBeenCalled();

    const dblclick = new MouseEvent("dblclick", { button: 0, bubbles: true, cancelable: true });
    vi.spyOn(dblclick, "preventDefault");
    img?.dispatchEvent(dblclick);
    expect(dblclick.preventDefault).toHaveBeenCalled();
    remove();
  });

  test("long-left uses the configured threshold and suppresses only its release click", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 750,
        links: true,
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<a id="link" href="http://x.test/full.png"><img id="held" src="http://x.test/preview.png"></a>';
    const image = document.getElementById("held");

    const press = new MouseEvent("mousedown", {
      button: 0,
      buttons: 1,
      clientX: 20,
      clientY: 30,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(press, "preventDefault");
    image?.dispatchEvent(press);
    expect(press.preventDefault).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(749);
    expect(downloadsSent()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(downloadsSent()).toHaveLength(1);
    expect(downloadsSent()[0]?.[0]).toMatchObject({
      body: {
        url: "http://x.test/preview.png",
        info: { gesture: "long-left-click" },
      },
    });

    const keyboardClick = new MouseEvent("click", {
      button: 0,
      detail: 0,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(keyboardClick, "preventDefault");
    image?.dispatchEvent(keyboardClick);
    expect(keyboardClick.preventDefault).not.toHaveBeenCalled();

    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    const releaseClick = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(releaseClick, "preventDefault");
    vi.spyOn(releaseClick, "stopImmediatePropagation");
    image?.dispatchEvent(releaseClick);
    expect(releaseClick.preventDefault).toHaveBeenCalled();
    expect(releaseClick.stopImmediatePropagation).toHaveBeenCalled();

    const laterClick = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(laterClick, "preventDefault");
    image?.dispatchEvent(laterClick);
    expect(laterClick.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("long-left suppresses the pressed overlay when source discovery sees through it", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<button id="overlay" type="button">Open</button><img id="underlay" src="http://x.test/underlay.png">';
    const overlay = document.getElementById("overlay");
    const underlay = document.getElementById("underlay");
    const pointElements: Element[] = [];
    if (overlay) pointElements.push(overlay);
    if (underlay) pointElements.push(underlay);
    document.elementsFromPoint = vi.fn(() => pointElements);

    mousedown(overlay);
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()[0]?.[0].body.url).toBe("http://x.test/underlay.png");

    overlay?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    const click = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(click, "preventDefault");
    overlay?.dispatchEvent(click);

    expect(click.preventDefault).toHaveBeenCalled();
    remove();
  });

  test("long-left preserves short clicks and cancels for movement, dragging, and modifier release", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));

    mousedown(image);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    mousedown(image);
    window.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 0, clientY: 0, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    mousedown(image);
    window.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 9, clientY: 0, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    mousedown(image);
    image?.dispatchEvent(new MouseEvent("dragstart", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    mousedown(image);
    window.dispatchEvent(keyEvent("keyup", 17));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(image);
    window.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);

    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(image);
    window.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 8, clientY: 0, bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(1);
    remove();
  });

  test("double-left takes precedence over a compatible pending long-left gesture", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");

    mousedown(image, 1, 1);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    mousedown(image, 1, 2);
    await vi.advanceTimersByTimeAsync(500);

    expect(downloadsSent().map(([message]) => message.body.info.gesture)).toEqual([
      "double-left-click",
    ]);
    remove();
  });

  test("a completed long-left gesture cannot also complete double-left", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 250,
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");

    mousedown(image, 1, 1);
    await vi.advanceTimersByTimeAsync(250);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    mousedown(image, 1, 2);

    expect(downloadsSent().map(([message]) => message.body.info.gesture)).toEqual([
      "long-left-click",
    ]);
    remove();
  });

  test("synthetic release events cannot cancel or consume a trusted long-left gesture", async () => {
    vi.useFakeTimers();
    const acceptMarked = (event: KeyboardEvent | MouseEvent) =>
      (event as unknown as { realInput?: boolean }).realInput === true;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptMarked,
    );
    const image = document.getElementById("i");
    const press = new MouseEvent("mousedown", { button: 0, buttons: 1, bubbles: true });
    (press as unknown as { realInput?: boolean }).realInput = true;
    image?.dispatchEvent(press);

    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(1);

    const syntheticClick = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(syntheticClick, "preventDefault");
    image?.dispatchEvent(syntheticClick);
    expect(syntheticClick.preventDefault).not.toHaveBeenCalled();

    const trustedClick = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    (trustedClick as unknown as { realInput?: boolean }).realInput = true;
    vi.spyOn(trustedClick, "preventDefault");
    image?.dispatchEvent(trustedClick);
    expect(trustedClick.preventDefault).toHaveBeenCalled();
    remove();
  });

  test("long-left rechecks the live page policy before saving", async () => {
    vi.useFakeTimers();
    let disabled = false;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
      () => disabled,
    );
    const image = document.getElementById("i");

    mousedown(image);
    await vi.advanceTimersByTimeAsync(499);
    disabled = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(downloadsSent()).toHaveLength(0);

    const click = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(click, "preventDefault");
    image?.dispatchEvent(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("long-left stays pending when the pointer moves between page elements", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");

    mousedown(image);
    window.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(downloadsSent()).toHaveLength(1);
    remove();
  });

  test("long-left keeps release suppression through lifecycle resets while held", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");

    mousedown(image);
    await vi.advanceTimersByTimeAsync(500);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));
    await vi.advanceTimersByTimeAsync(5000);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    const click = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(click, "preventDefault");
    image?.dispatchEvent(click);

    expect(click.preventDefault).toHaveBeenCalled();
    remove();
  });

  test("long-left preserves page-owned release suppression across a remount", async () => {
    vi.useFakeTimers();
    const suppression = createLongClickReleaseSuppressor(5000, {
      set: (callback, delay) => window.setTimeout(callback, delay),
      clear: (timer) => window.clearTimeout(timer),
    });
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        contentClickToSaveLongPressMs: 500,
        links: false,
      },
      acceptTestInput,
      () => false,
      suppression,
    );

    mousedown(document.getElementById("i"));
    await vi.advanceTimersByTimeAsync(500);
    remove();
    suppression.release();

    expect(suppression.consume(1)).toBe(true);
  });

  test("long-left expires its release suppression when release produces no click", async () => {
    vi.useFakeTimers();
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const image = document.getElementById("i");

    mousedown(image);
    await vi.advanceTimersByTimeAsync(500);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    await vi.advanceTimersByTimeAsync(4999);

    const withinGrace = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(withinGrace, "preventDefault");
    image?.dispatchEvent(withinGrace);
    expect(withinGrace.preventDefault).toHaveBeenCalled();

    mousedown(image);
    await vi.advanceTimersByTimeAsync(500);
    image?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    await vi.advanceTimersByTimeAsync(5000);

    const laterClick = new MouseEvent("click", {
      button: 0,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    vi.spyOn(laterClick, "preventDefault");
    image?.dispatchEvent(laterClick);
    expect(laterClick.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("long-left releases its pending candidate on focus loss and teardown", async () => {
    vi.useFakeTimers();
    const setup = () =>
      ClickToSave.setupClickToSave(
        {
          contentClickToSaveBindings: serializeClickToSaveBindings([
            { gesture: CLICK_GESTURES.LONG_LEFT, combo: "" },
          ]),
          contentClickToSaveCombo: "Alt",
          contentClickToSaveButton: "LEFT_CLICK",
          contentClickToSaveLongPressMs: 500,
          links: false,
        },
        acceptTestInput,
      );
    const image = document.getElementById("i");

    const removeAfterFocus = setup();
    mousedown(image);
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);
    removeAfterFocus();

    const removeWhilePending = setup();
    mousedown(image);
    removeWhilePending();
    await vi.advanceTimersByTimeAsync(500);
    expect(downloadsSent()).toHaveLength(0);
  });

  const followUp = (type: string, button: number, target: EventTarget | null) => {
    const e = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    vi.spyOn(e, "preventDefault");
    vi.spyOn(e, "stopImmediatePropagation");
    target?.dispatchEvent(e);
    return e;
  };

  test("a matched middle gesture cancels its follow-up auxclick and click once", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 4);
    expect(downloadsSent()).toHaveLength(1);

    // The browser's own follow-ups for the same press are canceled...
    const auxclick = followUp("auxclick", 1, img);
    expect(auxclick.preventDefault).toHaveBeenCalled();
    expect(auxclick.stopImmediatePropagation).toHaveBeenCalled();
    const click = followUp("click", 1, img);
    expect(click.preventDefault).toHaveBeenCalled();

    // ...and only once: the arm is one-shot per matched mousedown.
    const later = followUp("auxclick", 1, img);
    expect(later.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("a matched right gesture cancels the context menu for that press only", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.RIGHT, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 2);
    expect(downloadsSent()).toHaveLength(1);
    const matchedMenu = followUp("contextmenu", 2, img);
    expect(matchedMenu.preventDefault).toHaveBeenCalled();

    // An ordinary right click (combo released, no match) keeps its menu.
    window.dispatchEvent(keyEvent("keyup", 17));
    mousedown(img, 2);
    expect(downloadsSent()).toHaveLength(1);
    const ordinaryMenu = followUp("contextmenu", 2, img);
    expect(ordinaryMenu.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("an unmatched press never suppresses follow-ups", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");
    mousedown(img, 4);
    expect(downloadsSent()).toHaveLength(0);
    const auxclick = followUp("auxclick", 1, img);
    expect(auxclick.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("page-synthesized follow-ups neither consume nor receive the suppression", () => {
    const acceptMarked = (event: KeyboardEvent | MouseEvent) =>
      (event as unknown as { realInput?: boolean }).realInput === true;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptMarked,
    );
    const img = document.getElementById("i");
    const press = new MouseEvent("mousedown", {
      button: 1,
      buttons: 4,
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    (press as unknown as { realInput?: boolean }).realInput = true;
    img?.dispatchEvent(press);
    expect(downloadsSent()).toHaveLength(1);

    // A page-generated auxclick must not be canceled and must not burn the
    // one-shot before the browser's own (trusted) follow-up arrives.
    const synthetic = followUp("auxclick", 1, img);
    expect(synthetic.preventDefault).not.toHaveBeenCalled();

    const trusted = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    (trusted as unknown as { realInput?: boolean }).realInput = true;
    vi.spyOn(trusted, "preventDefault");
    img?.dispatchEvent(trusted);
    expect(trusted.preventDefault).toHaveBeenCalled();
    remove();
  });

  test("focus loss clears an armed follow-up suppression", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    const img = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 4);
    expect(downloadsSent()).toHaveLength(1);

    window.dispatchEvent(new Event("blur"));
    const auxclick = followUp("auxclick", 1, img);
    expect(auxclick.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("a per-site disable after an armed press still disarms the next mousedown", () => {
    let disabled = false;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.MIDDLE, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
      () => disabled,
    );
    const img = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 4);
    expect(downloadsSent()).toHaveLength(1);

    // The matched press's follow-up (auxclick) never arrives -- e.g. the
    // drag was released off-window -- leaving the suppressor armed. An SPA
    // navigation then disables the feature on this page without a remount.
    disabled = true;

    // The next trusted same-button mousedown must still disarm the stale
    // suppressor even though isDisabled() now short-circuits the rest of
    // the handler, so the browser's own auxclick for this press is not
    // eaten by a leftover arm from the previous, unrelated press.
    mousedown(img, 4);
    expect(downloadsSent()).toHaveLength(1);
    const auxclick = followUp("auxclick", 1, img);
    expect(auxclick.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("a per-site disable after a completed double still releases the click suppression", () => {
    let disabled = false;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
      () => disabled,
    );
    const img = document.getElementById("i");
    window.dispatchEvent(keyEvent("keydown", 17));
    mousedown(img, 1, 1);
    mousedown(img, 1, 2);
    expect(downloadsSent()).toHaveLength(1);

    // The completed double's click/dblclick never arrive -- drag released
    // off-window -- so the marker survives. An SPA navigation then disables
    // the feature on this page without a remount. The next mousedown must
    // still clear the marker despite the isDisabled() short-circuit, so its
    // own click is not eaten by the stale completed-double suppression.
    disabled = true;
    mousedown(img, 1, 1);
    const click = followUp("click", 0, img);
    expect(click.preventDefault).not.toHaveBeenCalled();
    remove();
  });

  test("page-synthesized clicks neither receive nor clear the completed-double suppression", () => {
    const acceptMarked = (event: KeyboardEvent | MouseEvent) =>
      (event as unknown as { realInput?: boolean }).realInput === true;
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptMarked,
    );
    const img = document.getElementById("i");
    const press = (detail: number) => {
      const e = new MouseEvent("mousedown", {
        button: 0,
        buttons: 1,
        detail,
        bubbles: true,
        cancelable: true,
      });
      (e as unknown as { realInput?: boolean }).realInput = true;
      img?.dispatchEvent(e);
    };
    press(1);
    press(2);
    expect(downloadsSent()).toHaveLength(1);

    // A page-generated click must not be canceled, and a page-generated
    // dblclick must not clear the marker before the browser's own trusted
    // follow-ups for the completed double arrive.
    const syntheticClick = followUp("click", 0, img);
    expect(syntheticClick.preventDefault).not.toHaveBeenCalled();
    const syntheticDouble = followUp("dblclick", 0, img);
    expect(syntheticDouble.preventDefault).not.toHaveBeenCalled();

    const trusted = (type: string) => {
      const e = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
      (e as unknown as { realInput?: boolean }).realInput = true;
      vi.spyOn(e, "preventDefault");
      img?.dispatchEvent(e);
      return e;
    };
    expect(trusted("click").preventDefault).toHaveBeenCalled();
    expect(trusted("dblclick").preventDefault).toHaveBeenCalled();
    remove();
  });

  test("double-left does not combine presses from different sources", () => {
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveBindings: serializeClickToSaveBindings([
          { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Ctrl" },
        ]),
        contentClickToSaveCombo: "Alt",
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
    document.body.innerHTML =
      '<img id="first" src="http://x.test/first.png"><img id="second" src="http://x.test/second.png">';
    window.dispatchEvent(keyEvent("keydown", 17));

    mousedown(document.getElementById("first"), 1, 1);
    mousedown(document.getElementById("second"), 1, 2);

    expect(downloadsSent()).toHaveLength(0);
    remove();
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
    sendMessage.mockImplementation((_message, cb) => {
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
    const remove = ClickToSave.setupClickToSave(
      {
        contentClickToSaveCombo: 90,
        contentClickToSaveButton: "LEFT_CLICK",
        links: false,
      },
      acceptTestInput,
    );
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
