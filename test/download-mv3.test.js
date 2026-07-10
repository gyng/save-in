// MV3 service worker compatibility: data URL fallbacks and the
// onDeterminingFilename session-storage recovery path

import { TextEncoder } from "util";
import { Blob as NodeBlob } from "buffer";

global.TextEncoder = global.TextEncoder || TextEncoder;

const constants = (await import("../src/constants.js")).default;

Object.assign(global, constants);

const Download = (await import("../src/download.js")).default;

const decodeDataUrl = (url) => {
  const [meta, b64] = url.split(",");
  return {
    meta,
    content: Buffer.from(b64, "base64").toString("utf8"),
  };
};

describe("makeObjectUrl", () => {
  // vitest's jsdom provides URL.createObjectURL; the MV3 service worker
  // path is the one without it, so stub it away for these tests
  let originalCreateObjectURL;

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

  test("uses URL.createObjectURL when available (MV2)", () => {
    URL.createObjectURL = jest.fn(() => "blob:fake-object-url");

    const url = Download.makeObjectUrl("hello");
    expect(url).toBe("blob:fake-object-url");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("makeUrlFromBlob", () => {
  // vitest's jsdom provides URL.createObjectURL; the MV3 service worker
  // path is the one without it, so stub it away for these tests
  let originalCreateObjectURL;

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

    const url = await Download.makeUrlFromBlob(blob);
    const { meta, content } = decodeDataUrl(url);

    expect(meta).toBe("data:image/png;base64");
    expect(content).toBe("binary-ish content");
  });

  test("defaults to application/octet-stream for untyped blobs", async () => {
    const blob = new NodeBlob(["x"]);
    const url = await Download.makeUrlFromBlob(blob);
    expect(url.startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  test("handles blobs larger than the base64 chunk size", async () => {
    const big = "a".repeat(0x8000 * 2 + 17);
    const blob = new NodeBlob([big], { type: "text/plain" });
    const { content } = decodeDataUrl(await Download.makeUrlFromBlob(blob));
    expect(content).toBe(big);
  });

  test("uses URL.createObjectURL when available (MV2)", async () => {
    URL.createObjectURL = jest.fn(() => "blob:fake-object-url");
    const blob = new NodeBlob(["x"]);
    await expect(Download.makeUrlFromBlob(blob)).resolves.toBe("blob:fake-object-url");
  });
});

describe("offscreen document fetch (Chrome MV3)", () => {
  let originalCreateObjectURL;

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
        hasDocument: jest.fn(() => Promise.resolve(false)),
        createDocument: jest.fn(() => Promise.resolve()),
      },
      runtime: { sendMessage: jest.fn(() => Promise.resolve({ blobUrl: "blob:offscreen-url" })) },
    };
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true,
    });
    delete global.chrome;
  });

  test("canUseOffscreen is true in a worker that has chrome.offscreen", () => {
    expect(Download.canUseOffscreen()).toBe(true);
  });

  test("canUseOffscreen is false when createObjectURL exists (Firefox event page)", () => {
    URL.createObjectURL = () => "blob:x";
    expect(Download.canUseOffscreen()).toBe(false);
  });

  test("creates the offscreen document and returns its blob URL", async () => {
    const url = await Download.fetchViaOffscreen("https://x/big.bin");

    expect(global.chrome.offscreen.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "src/offscreen.html", reasons: ["BLOBS"] }),
    );
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "OFFSCREEN_FETCH",
      url: "https://x/big.bin",
    });
    expect(url).toBe("blob:offscreen-url");
  });

  test("reuses an existing offscreen document", async () => {
    global.chrome.offscreen.hasDocument = jest.fn(() => Promise.resolve(true));
    await Download.fetchViaOffscreen("https://x/a");
    expect(global.chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  test("tolerates a concurrent create-document race", async () => {
    global.chrome.offscreen.createDocument = jest.fn(() =>
      Promise.reject(new Error("Only a single offscreen document may be created")),
    );
    await expect(Download.fetchViaOffscreen("https://x/a")).resolves.toBe("blob:offscreen-url");
  });

  test("rejects when the offscreen fetch reports an error", async () => {
    global.chrome.runtime.sendMessage = jest.fn(() => Promise.resolve({ error: "HTTP 403" }));
    await expect(Download.fetchViaOffscreen("https://x/a")).rejects.toThrow("HTTP 403");
  });
});

describe("onDeterminingFilename listener (Chrome)", () => {
  let listener;
  let sessionStore;

  beforeEach(async () => {
    jest.resetModules();
    sessionStore = {};

    global.chrome = {
      downloads: {
        onDeterminingFilename: {
          addListener: jest.fn(),
        },
      },
    };
    global.browser = { runtime: { id: "self-extension-id" } };
    global.options = { conflictAction: "uniquify" };
    global.SessionState = {
      available: () => true,
      get: jest.fn((key) => Promise.resolve({ [key]: sessionStore[key] })),
      set: jest.fn((obj) => {
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      }),
      update: jest.fn((key, fn) => {
        sessionStore[key] = fn(sessionStore[key]);
        return Promise.resolve();
      }),
    };

    await import("../src/download.js");
    [[listener]] = global.chrome.downloads.onDeterminingFilename.addListener.mock.calls;
  });

  const flush = async () => {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  };

  test("ignores downloads from other extensions", () => {
    const suggest = jest.fn();
    const returned = listener({ byExtensionId: "someone-else", filename: "x" }, suggest);
    expect(returned).toBe(false);
    expect(suggest).not.toHaveBeenCalled();
  });

  test("recovers the persisted filename after a service worker restart", async () => {
    // Module-fresh download.js has empty globalChromeState (no .path),
    // simulating a service worker that restarted mid-download. The filename map
    // is keyed by the download URL so overlapping downloads don't clobber it.
    sessionStore.siFinalFilenames = { "https://x/recover.png": "route/recovered.txt" };

    const suggest = jest.fn();
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
    await flush();

    expect(suggest).toHaveBeenCalledWith({
      filename: "route/recovered.txt",
      conflictAction: "uniquify",
    });
  });

  test("falls back to default naming when nothing was persisted", async () => {
    const suggest = jest.fn();
    const returned = listener(
      { byExtensionId: "self-extension-id", filename: "original.txt" },
      suggest,
    );

    expect(returned).toBe(true);
    await flush();
    expect(suggest).toHaveBeenCalledWith();
  });
});
