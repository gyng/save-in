// MV3 service worker compatibility: data URL fallbacks and the
// onDeterminingFilename session-storage recovery path

import { TextEncoder } from "util";
import { Blob as NodeBlob } from "buffer";

global.TextEncoder = global.TextEncoder || TextEncoder;

// Listener registration belongs to the entry, so these worker-safe modules can
// be imported against the minimal host fixture without messaging side effects.

import { Download } from "../src/downloads/download.ts";
import { OffscreenClient } from "../src/platform/offscreen-client.ts";
import { makeUrlFromBlob, resolveContent } from "../src/downloads/content-fetch.ts";

const decodeDataUrl = (url: string) => {
  const [meta, b64] = url.split(",");
  return {
    meta,
    content: Buffer.from(b64 ?? "", "base64").toString("utf8"),
  };
};

describe("makeObjectUrl", () => {
  // vitest's jsdom provides URL.createObjectURL; the MV3 service worker
  // path is the one without it, so stub it away for these tests
  let originalCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true,
    });
  });

  test("falls back to a base64 data URL without URL.createObjectURL (MV3)", () => {
    expect(typeof URL.createObjectURL).toBe("undefined");

    const url = Download.makeObjectUrl("hello world");
    const { meta, content } = decodeDataUrl(url);

    expect(meta).toBe("data:text/plain;charset=utf-8;base64");
    expect(content).toBe("hello world");
  });

  test("data URL fallback round-trips unicode content", () => {
    const input = "héllo wörld — 日本語 🎉";
    const { content } = decodeDataUrl(Download.makeObjectUrl(input));
    expect(content).toBe(input);
  });

  test("data URL fallback respects the mime type", () => {
    const { meta } = decodeDataUrl(Download.makeObjectUrl("<html></html>", "text/html"));
    expect(meta).toBe("data:text/html;charset=utf-8;base64");
  });

  test("uses URL.createObjectURL in a DOM-capable background", () => {
    URL.createObjectURL = vi.fn(() => "blob:fake-object-url");

    const url = Download.makeObjectUrl("hello");
    expect(url).toBe("blob:fake-object-url");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("makeUrlFromBlob", () => {
  // vitest's jsdom provides URL.createObjectURL; the MV3 service worker
  // path is the one without it, so stub it away for these tests
  let originalCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true,
    });
  });

  test("falls back to a data URL without URL.createObjectURL (MV3)", async () => {
    const blob = new NodeBlob(["binary-ish content"], { type: "image/png" });

    const url = await makeUrlFromBlob(blob);
    const { meta, content } = decodeDataUrl(url);

    expect(meta).toBe("data:image/png;base64");
    expect(content).toBe("binary-ish content");
  });

  test("defaults to application/octet-stream for untyped blobs", async () => {
    const blob = new NodeBlob(["x"]);
    const url = await makeUrlFromBlob(blob);
    expect(url.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  test("handles blobs larger than the base64 chunk size", async () => {
    const big = "a".repeat(0x8000 * 2 + 17);
    const blob = new NodeBlob([big], { type: "text/plain" });
    const { content } = decodeDataUrl(await makeUrlFromBlob(blob));
    expect(content).toBe(big);
  });

  test("uses URL.createObjectURL in a DOM-capable background", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fake-object-url");
    const blob = new NodeBlob(["x"]);
    await expect(makeUrlFromBlob(blob)).resolves.toBe("blob:fake-object-url");
  });
});

describe("offscreen document fetch (Chrome MV3)", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    // simulate a service worker: no URL.createObjectURL
    originalCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    global.chrome = {
      offscreen: {
        createDocument: vi.fn(() => Promise.resolve()),
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
        getContexts: vi.fn(() => Promise.resolve([])),
        sendMessage: vi.fn(() => Promise.resolve({ blobUrl: "blob:offscreen-url" })),
      },
    } as any;
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true,
    });
    Reflect.deleteProperty(globalThis, "chrome");
  });

  test("OffscreenClient.canUse is true in a worker that has chrome.offscreen", () => {
    expect(OffscreenClient.canUse()).toBe(true);
  });

  test("OffscreenClient.canUse is false when createObjectURL exists (Firefox event page)", () => {
    URL.createObjectURL = () => "blob:x";
    expect(OffscreenClient.canUse()).toBe(false);
  });

  test("creates the offscreen document and returns its blob URL", async () => {
    const url = await OffscreenClient.fetch("https://x/big.bin", "omit");

    expect(global.chrome.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "src/offscreen.html", reasons: ["BLOBS"] }),
    );
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "OFFSCREEN_FETCH",
      url: "https://x/big.bin",
      credentials: "omit",
      requestId: expect.any(String),
    });
    expect(url).toBe("blob:offscreen-url");
  });

  test("reuses an existing offscreen document", async () => {
    global.chrome.runtime.getContexts = vi.fn(() => Promise.resolve([{}])) as any;
    await OffscreenClient.fetch("https://x/a", "omit");
    expect(global.chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  test("tolerates a concurrent create-document race", async () => {
    global.chrome.runtime.getContexts = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);
    global.chrome.offscreen.createDocument = vi.fn(() =>
      Promise.reject(new Error("Only a single offscreen document may be created")),
    );
    await expect(OffscreenClient.fetch("https://x/a", "omit")).resolves.toBe("blob:offscreen-url");
  });

  test("deduplicates concurrent offscreen-document creation", async () => {
    let resolvePending!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    global.chrome.offscreen.createDocument = vi.fn(() => pending);
    const first = OffscreenClient.ensure();
    const second = OffscreenClient.ensure();
    await vi.waitFor(() => expect(global.chrome.offscreen.createDocument).toHaveBeenCalledTimes(1));
    resolvePending();
    await Promise.all([first, second]);
  });

  test("releases an offscreen blob explicitly", async () => {
    await OffscreenClient.release("request-1");
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "OFFSCREEN_BLOB_RELEASE",
      requestId: "request-1",
    });
  });

  test("rejects when the offscreen fetch reports an error", async () => {
    global.chrome.runtime.sendMessage = vi.fn(() => Promise.resolve({ error: "HTTP 403" }));
    await expect(OffscreenClient.fetch("https://x/a", "omit")).rejects.toThrow("HTTP 403");
  });

  test("resolveContent fetches once via offscreen, returning hash + download URL", async () => {
    global.chrome.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ blobUrl: "blob:offscreen-url", hash: "deadbeef" }),
    );
    const content = await resolveContent("https://x/a");
    // one offscreen fetch, asked to hash the same bytes it blob-ifies
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OFFSCREEN_FETCH",
        url: "https://x/a",
        hash: "SHA-256",
        credentials: "include",
      }),
    );
    expect(content).toEqual({
      sha256: "deadbeef",
      downloadUrl: "blob:offscreen-url",
      offscreenRequestId: expect.any(String),
    });
  });

  test("resolveContent resolves null when the offscreen fetch fails", async () => {
    global.chrome.runtime.sendMessage = vi.fn(() => Promise.resolve({ error: "HTTP 500" }));
    await expect(resolveContent("https://x/a")).resolves.toBeNull();
  });

  test("resolveContent cancels before starting an offscreen fetch when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Canceled", "AbortError"));

    await expect(resolveContent("https://x/a", false, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OFFSCREEN_FETCH_CANCEL" }),
    );
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "OFFSCREEN_FETCH" }),
    );
  });

  test("resolveContent rejects and releases a blob when cancellation races the response", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchResponse = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.chrome.runtime.sendMessage = vi.fn((message) =>
      message.type === "OFFSCREEN_FETCH" ? fetchResponse : Promise.resolve({ canceled: true }),
    );
    const controller = new AbortController();
    const content = resolveContent("https://x/a", false, controller.signal, "request-race");
    await vi.waitFor(() =>
      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "OFFSCREEN_FETCH" }),
      ),
    );

    controller.abort(new DOMException("Canceled", "AbortError"));
    resolveFetch({ blobUrl: "blob:late-response", hash: "deadbeef" });

    await expect(content).rejects.toMatchObject({ name: "AbortError" });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "OFFSCREEN_BLOB_RELEASE",
      requestId: "request-race",
    });
  });

  test("resolveContent tolerates a missing hash from a legacy offscreen response", async () => {
    global.chrome.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ blobUrl: "blob:offscreen-url" }),
    );
    const content = await resolveContent("https://x/a");
    expect(content).toEqual({
      sha256: "",
      downloadUrl: "blob:offscreen-url",
      offscreenRequestId: expect.any(String),
    });
  });
});

describe("onDeterminingFilename listener (Chrome)", () => {
  let listener: (
    item: { byExtensionId?: string; filename: string; url?: string; incognito?: boolean },
    suggest: (suggestion?: { filename: string; conflictAction: string }) => void,
  ) => boolean;
  let sessionStore: Record<string, any>;
  let freshDownload: typeof import("../src/downloads/download.ts").Download;
  let freshOptions: typeof import("../src/config/options-data.ts").options;

  beforeEach(async () => {
    vi.resetModules();
    sessionStore = {};

    global.chrome = {
      downloads: {
        onDeterminingFilename: {
          addListener: vi.fn(),
        },
      },
    } as any;
    global.browser = { runtime: { id: "self-extension-id" } } as any;

    // vi.resetModules() gives download.ts (below) a fresh module graph, so
    // options/SessionState must be re-imported here to get the SAME
    // instances that graph resolves to — the pre-reset top-level imports
    // above are a different, stale module instance after the reset.
    ({ options: freshOptions } = await import("../src/config/options-data.ts"));
    Object.assign(freshOptions, { conflictAction: "uniquify" });

    const freshSessionState = await import("../src/shared/session-state.ts");
    vi.spyOn(freshSessionState, "getSession").mockImplementation((_storage: any, key: string) =>
      Promise.resolve({ [key]: sessionStore[key] }),
    );
    vi.spyOn(freshSessionState, "setSession").mockImplementation(
      (_storage: any, obj: Record<string, any>) => {
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      },
    );
    vi.spyOn(freshSessionState, "updateSession").mockImplementation(
      (_writes: any, _storage: any, key: string, fn: (v: any) => any) => {
        sessionStore[key] = fn(sessionStore[key]);
        return Promise.resolve();
      },
    );

    // Attach onDeterminingFilename against the fresh Chrome stub, then capture.
    const { Download: currentDownload, registerDownloadListener } =
      await import("../src/downloads/download.ts");
    const { configureDownloadPorts } = await import("../src/downloads/ports.ts");
    configureDownloadPorts({
      runtime: { ready: Promise.resolve(), debug: false },
      history: {
        add: () => "history-id",
        patch: () => Promise.resolve(),
        setDownloadId: () => Promise.resolve(),
        setStatus: () => Promise.resolve(),
      },
      log: { add: vi.fn() },
      retry: currentDownload.retryViaFetch,
    });
    freshDownload = currentDownload;
    registerDownloadListener();
    [[listener]] = (global.chrome.downloads.onDeterminingFilename.addListener as any).mock.calls;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ignores downloads from other extensions", () => {
    const suggest = vi.fn();
    const returned = listener({ byExtensionId: "someone-else", filename: "x" }, suggest);
    expect(returned).toBe(false);
    expect(suggest).not.toHaveBeenCalled();
  });

  test("leaves ordinary browser downloads unchanged when global routing is disabled", async () => {
    freshOptions.routeBrowserDownloads = false;
    const suggest = vi.fn();

    expect(
      listener(
        {
          filename: "C:\\Downloads\\cat.jpg",
          url: "https://cdn.example/cat.jpg",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith());
  });

  test("routes matching ordinary browser downloads when enabled", async () => {
    freshOptions.routeBrowserDownloads = true;
    vi.spyOn(freshDownload, "getRoutingMatches").mockReturnValue("sorted/:filename:");
    vi.spyOn(freshDownload, "finalizeFullPath").mockReturnValue("sorted/cat.jpg");
    const suggest = vi.fn();

    expect(
      listener(
        {
          filename: "C:\\Downloads\\cat.jpg",
          url: "https://cdn.example/cat.jpg",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith({
        filename: "sorted/cat.jpg",
        conflictAction: "uniquify",
      }),
    );
  });

  test("leaves private ordinary browser downloads untouched", () => {
    freshOptions.routeBrowserDownloads = true;
    const route = vi.spyOn(freshDownload, "getRoutingMatches");
    const suggest = vi.fn();

    expect(
      listener(
        {
          incognito: true,
          filename: "C:\\Downloads\\private.jpg",
          url: "https://private.example/private.jpg",
        },
        suggest,
      ),
    ).toBe(false);

    expect(route).not.toHaveBeenCalled();
    expect(suggest).toHaveBeenCalledWith();
  });

  test("recovers the persisted filename after a service worker restart", async () => {
    // Module-fresh download.js has empty globalChromeState (no .path),
    // simulating a service worker that restarted mid-download. The filename map
    // is keyed by the download URL so overlapping downloads don't clobber it.
    sessionStore.siFinalFilenames = { "https://x/recover.png": "route/recovered.txt" };

    const suggest = vi.fn();
    const returned = listener(
      {
        byExtensionId: "self-extension-id",
        filename: "original.txt",
        url: "https://x/recover.png",
      },
      suggest,
    );

    // Chrome requires a synchronous `return true` for async suggest()
    expect(returned).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalled());

    expect(suggest).toHaveBeenCalledWith({
      filename: "route/recovered.txt",
      conflictAction: "uniquify",
    });
  });

  test("an in-memory retry consumes its persisted filename only when Chrome asks", async () => {
    const url = "blob:retry-url";
    freshDownload.pendingRetryFilenames.set(url, "route/retried.txt");
    sessionStore.siFinalFilenames = { [url]: "route/retried.txt" };
    const suggest = vi.fn();

    expect(
      listener({ byExtensionId: "self-extension-id", filename: "download", url }, suggest),
    ).toBe(false);
    expect(suggest).toHaveBeenCalledWith({
      filename: "route/retried.txt",
      conflictAction: "uniquify",
    });
    await vi.waitFor(() => expect(sessionStore.siFinalFilenames).toEqual({}));
  });

  test("recovers same-URL persisted filenames in request order", async () => {
    sessionStore.siFinalFilenames = {
      "https://x/same.png": ["first/a.png", "second/b.png"],
    };

    const first = vi.fn();
    expect(
      listener(
        { byExtensionId: "self-extension-id", filename: "original", url: "https://x/same.png" },
        first,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    expect(first).toHaveBeenCalledWith({
      filename: "first/a.png",
      conflictAction: "uniquify",
    });
    expect(sessionStore.siFinalFilenames).toEqual({ "https://x/same.png": "second/b.png" });

    const second = vi.fn();
    listener(
      { byExtensionId: "self-extension-id", filename: "original", url: "https://x/same.png" },
      second,
    );
    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    expect(second).toHaveBeenCalledWith({
      filename: "second/b.png",
      conflictAction: "uniquify",
    });
    expect(sessionStore.siFinalFilenames).toEqual({});
  });

  test("falls back to default naming when nothing was persisted", async () => {
    const suggest = vi.fn();
    const returned = listener(
      { byExtensionId: "self-extension-id", filename: "original.txt" },
      suggest,
    );

    expect(returned).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalled());
    expect(suggest).toHaveBeenCalledWith();
  });

  test("falls back to default naming for malformed persisted filename maps", async () => {
    sessionStore.siFinalFilenames = {
      "https://x/recover.png": [{ filename: "not-a-string" }],
    };
    const suggest = vi.fn();

    expect(
      listener(
        {
          byExtensionId: "self-extension-id",
          filename: "original.txt",
          url: "https://x/recover.png",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith());
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  test("falls back to default naming when session recovery rejects", async () => {
    const sessionState = await import("../src/shared/session-state.ts");
    vi.mocked(sessionState.getSession).mockRejectedValueOnce(new Error("storage unavailable"));
    const suggest = vi.fn();

    expect(
      listener({ byExtensionId: "self-extension-id", filename: "original.txt" }, suggest),
    ).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith());
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  test("falls back to default naming when actual-filename resolution rejects", async () => {
    freshOptions.filenamePatterns = [{}] as any;
    const state = {
      path: { raw: ":filename:", finalize: () => "old.txt", toString: () => "old.txt" },
      scratch: { pathTemplateRaw: ":filename:" },
      info: { url: "https://x/file", filename: "old.txt" },
    } as any;
    freshDownload.rememberPendingState(state);
    const variable = await import("../src/routing/variable.ts");
    vi.spyOn(variable, "applyVariables").mockRejectedValueOnce(new Error("variable failed"));
    const suggest = vi.fn();

    expect(
      listener(
        {
          byExtensionId: "self-extension-id",
          filename: "server.txt",
          url: "https://x/file",
        },
        suggest,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith());
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  test("consuming a URL queue does not delete a distinct final-URL queue", () => {
    const makeState = (url: string, filename: string) =>
      ({
        path: { finalize: () => "dir", toString: () => "dir" },
        scratch: {},
        info: { url, filename },
      }) as any;
    const requested = makeState("https://x/request", "request.txt");
    const redirected = makeState("https://x/final", "final.txt");
    freshDownload.rememberPendingState(requested);
    freshDownload.rememberPendingState(redirected);

    listener(
      {
        byExtensionId: "self-extension-id",
        filename: "server.txt",
        url: "https://x/request",
        finalUrl: "https://x/final",
      } as any,
      vi.fn(),
    );

    expect(freshDownload.pendingStates.get("https://x/final")).toEqual([redirected]);
  });
});
