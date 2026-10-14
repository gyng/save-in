import { createHash } from "node:crypto";
import { servePageBlob } from "../../src/content/page-blob.ts";
import { preparePageBlob, readPageBlob } from "../../src/downloads/page-blob.ts";
import type { DownloadPipelineState } from "../../src/downloads/download-types.ts";
import {
  PAGE_BLOB_CHUNK_BYTES,
  PAGE_BLOB_PORT,
  PAGE_BLOB_TIMEOUT_MS,
} from "../../src/shared/page-blob.ts";
import { installHostProperty, webExtensionEvent } from "../support/webextension-host.fixture.ts";

const makePort = () => ({
  name: PAGE_BLOB_PORT,
  sender: { id: chrome.runtime.id },
  onMessage: {
    ...webExtensionEvent<[unknown, chrome.runtime.Port]>(),
    addRules: vi.fn(),
    removeRules: vi.fn(),
    getRules: vi.fn(),
  },
  onDisconnect: {
    ...webExtensionEvent<[chrome.runtime.Port]>(),
    addRules: vi.fn(),
    removeRules: vi.fn(),
    getRules: vi.fn(),
  },
  postMessage: vi.fn<(message: unknown) => void>(),
  disconnect: vi.fn(),
});
type TestPort = ReturnType<typeof makePort>;

const linkPorts = (client: TestPort, server: TestPort) => {
  let closed = false;
  for (const [from, to] of [
    [client, server],
    [server, client],
  ] as const) {
    from.postMessage.mockImplementation((message) => {
      if (closed) throw new Error("Port disconnected");
      queueMicrotask(() => {
        if (!closed) to.onMessage.emit(message, to);
      });
    });
    from.disconnect.mockImplementation(() => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => to.onDisconnect.emit(to));
    });
  }
};

const messagesOfType = (port: TestPort, type: string) =>
  port.postMessage.mock.calls.filter(
    ([message]) =>
      typeof message === "object" && message !== null && Reflect.get(message, "type") === type,
  );

describe("page-owned blob transfer", () => {
  const url = "blob:https://page.test/image-id";
  const target = { tabId: 12, frameId: 0, url };
  let pairs: { client: TestPort; server: TestPort }[];
  let client: TestPort;
  let server: TestPort;
  const connectToServer = () =>
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => {
        const pair = { client: makePort(), server: makePort() };
        linkPorts(pair.client, pair.server);
        pairs.push(pair);
        servePageBlob(pair.server);
        return pair.client;
      }),
    );
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "https://page.test" });
    pairs = [];
    client = makePort();
    server = makePort();
    linkPorts(client, server);
    connectToServer();
  });
  afterEach(() => {
    for (const pair of [{ client, server }, ...pairs]) {
      pair.client.disconnect();
      pair.server.disconnect();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const connectToClient = () =>
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => client),
    );
  const stubPageBlob = (bytes: Uint8Array<ArrayBuffer> | string, type = "image/png") =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { headers: { "Content-Type": type } })),
    );
  const makeBlobState = (): DownloadPipelineState => ({
    path: { finalize: () => "", toString: () => "" },
    scratch: {},
    info: { url, currentTab: { id: 12 }, frameId: 7 },
  });

  test("relays multiple bounded chunks one request at a time and preserves bytes", async () => {
    const bytes = Uint8Array.from({ length: PAGE_BLOB_CHUNK_BYTES * 2 + 17 }, (_, i) => i % 251);
    stubPageBlob(bytes);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const chunks: Uint8Array<ArrayBuffer>[] = [];

    const metadata = await readPageBlob({ tabId: 12, frameId: 7, url }, undefined, (chunk) => {
      chunks.push(chunk);
    });

    expect(metadata).toEqual({ size: bytes.length, mime: "image/png" });
    expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
    expect(browser.tabs.connect).toHaveBeenCalledWith(12, { name: PAGE_BLOB_PORT, frameId: 7 });
    expect(messagesOfType(pairs[0]!.server, "chunk")).toHaveLength(3);
    expect(pairs[0]!.client.disconnect).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
  });

  test("reads only metadata when no consumer asks for bytes", async () => {
    stubPageBlob(new Uint8Array(PAGE_BLOB_CHUNK_BYTES * 3));

    await expect(readPageBlob(target)).resolves.toEqual({
      size: PAGE_BLOB_CHUNK_BYTES * 3,
      mime: "image/png",
    });

    expect(messagesOfType(pairs[0]!.client, "read")).toHaveLength(0);
    expect(messagesOfType(pairs[0]!.server, "chunk")).toHaveLength(0);
    expect(pairs[0]!.client.disconnect).toHaveBeenCalledOnce();
  });

  test.each(["https://page.test/image.png", "blob:https://other.test/id", "blob:null/id"])(
    "does not fetch a nonlocal source: %s",
    async (source) => {
      vi.stubGlobal("fetch", vi.fn());
      await expect(readPageBlob({ ...target, url: source })).rejects.toThrow("no longer available");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("rejects a revoked blob and releases the port", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network error")));
    await expect(readPageBlob(target)).rejects.toThrow("no longer available");
    expect(pairs[0]!.client.onMessage.hasListeners()).toBe(false);
    expect(pairs[0]!.server.onMessage.hasListeners()).toBe(false);
  });

  test("rejects an already canceled read without connecting", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Canceled"));
    await expect(readPageBlob(target, controller.signal)).rejects.toThrow("Canceled");
    expect(browser.tabs.connect).not.toHaveBeenCalled();
  });

  test("cancellation aborts the content fetch and releases both listener sets", async () => {
    let contentSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        contentSignal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) =>
          contentSignal?.addEventListener("abort", () => reject(contentSignal?.reason), {
            once: true,
          }),
        );
      }),
    );
    const controller = new AbortController();
    const result = readPageBlob(target, controller.signal);
    const rejected = expect(result).rejects.toThrow("Canceled");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort(new Error("Canceled"));
    await rejected;
    expect(contentSignal?.aborted).toBe(true);
    expect(pairs[0]!.client.onMessage.hasListeners()).toBe(false);
    expect(pairs[0]!.server.onMessage.hasListeners()).toBe(false);
  });

  test("fails a silent or stale content script after a bounded wait", async () => {
    vi.useFakeTimers();
    connectToClient();
    const result = expect(readPageBlob(target)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(PAGE_BLOB_TIMEOUT_MS);
    await result;
    expect(client.onMessage.hasListeners()).toBe(false);
  });

  test("fails when the port cannot carry the first request", async () => {
    connectToClient();
    client.postMessage.mockImplementation(() => {
      throw new Error("Port disconnected");
    });
    await expect(readPageBlob(target)).rejects.toThrow("Port disconnected");
  });

  test.each([
    ["a non-object response", null, "Invalid blob response"],
    ["a negative size", { type: "metadata", size: -1, mime: "" }, "Invalid blob metadata"],
    ["a fractional size", { type: "metadata", size: 1.5, mime: "" }, "Invalid blob metadata"],
    ["a non-numeric size", { type: "metadata", size: "1", mime: "" }, "Invalid blob metadata"],
    ["a non-string type", { type: "metadata", size: 1, mime: 1 }, "Invalid blob metadata"],
    [
      "an oversized type",
      { type: "metadata", size: 1, mime: "x".repeat(256) },
      "Invalid blob metadata",
    ],
    ["a chunk before metadata", { type: "chunk", data: "AA==" }, "Incomplete"],
  ])("rejects %s", async (_name, message, error) => {
    connectToClient();
    const result = expect(readPageBlob(target, undefined, () => {})).rejects.toThrow(error);
    client.onMessage.emit(message, client);
    await result;
  });

  test.each([
    ["an incomplete response", [{ type: "done" }], "Incomplete"],
    ["a chunk past the declared size", [{ type: "chunk", data: "AAAA" }], "Invalid blob length"],
    ["an empty chunk", [{ type: "chunk", data: "" }], "Invalid blob length"],
    ["a non-string chunk", [{ type: "chunk", data: 1 }], "Invalid blob chunk"],
    [
      "an oversized transport chunk",
      [{ type: "chunk", data: "A".repeat(PAGE_BLOB_CHUNK_BYTES * 2) }],
      "Invalid blob chunk",
    ],
  ])("rejects %s before constructing a download", async (_name, messages, error) => {
    connectToClient();
    const result = expect(readPageBlob(target, undefined, () => {})).rejects.toThrow(error);
    client.onMessage.emit({ type: "metadata", size: 2, mime: "image/png" }, client);
    for (const message of messages) client.onMessage.emit(message, client);
    await result;
  });

  test("rejects a chunk sent to a metadata-only read", async () => {
    connectToClient();
    client.postMessage.mockImplementation(() => {});
    let settled = false;
    const result = readPageBlob(target).finally(() => (settled = true));
    client.onMessage.emit({ type: "chunk", data: "AA==" }, client);
    await expect(result).rejects.toThrow("Incomplete");
    expect(settled).toBe(true);
  });

  test("routing learns the type without transferring or announcing the bytes", async () => {
    stubPageBlob(new Uint8Array(PAGE_BLOB_CHUNK_BYTES * 2));
    const state = makeBlobState();
    const onContentFetchStart = vi.fn();
    state.info.onContentFetchStart = onContentFetchStart;

    await preparePageBlob(state);

    expect(state.info.mime).toBe("image/png");
    expect(state.info.resolvedHead).toEqual({ contentType: "image/png", finalUrl: url });
    expect(state.info.contentPromise).toBeUndefined();
    expect(onContentFetchStart).not.toHaveBeenCalled();
    expect(messagesOfType(pairs[0]!.server, "chunk")).toHaveLength(0);
    expect(browser.tabs.connect).toHaveBeenCalledWith(12, { name: PAGE_BLOB_PORT, frameId: 7 });
  });

  test("marks a MIME-derived name as synthetic so a fetch rewrite can drop it", async () => {
    stubPageBlob("x");
    const state = makeBlobState();

    await preparePageBlob(state);

    expect(state.info.suggestedFilename).toBe("image-id.png");
    expect(state.scratch.syntheticSuggestedFilename).toBe(true);
  });

  test("keeps a page-supplied name and names nothing for an unknown type", async () => {
    stubPageBlob("x", "application/x-unknown");
    const named = makeBlobState();
    named.info.suggestedFilename = "chosen.png";
    const unnamed = makeBlobState();

    await preparePageBlob(named);
    await preparePageBlob(unnamed);

    expect(named.info.suggestedFilename).toBe("chosen.png");
    expect(named.scratch.syntheticSuggestedFilename).toBeUndefined();
    expect(unnamed.info.suggestedFilename).toBeUndefined();
  });

  test("loads the bytes on demand and hashes them only when asked", async () => {
    const bytes = Uint8Array.from({ length: PAGE_BLOB_CHUNK_BYTES + 3 }, (_, i) => i % 7);
    stubPageBlob(bytes);
    const state = makeBlobState();
    await preparePageBlob(state);
    const load = state.info.loadContent;
    if (!load) throw new Error("loader missing");

    const plain = await load("request", false);
    const hashed = await load("request", true);

    expect(plain.sha256).toBe("");
    expect(hashed.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(plain.ownedObjectUrl).toBe(plain.downloadUrl);
    const response = await fetch(plain.downloadUrl);
    expect(response.ok).toBe(true);
    expect(pairs).toHaveLength(3);
    URL.revokeObjectURL(plain.downloadUrl);
    URL.revokeObjectURL(hashed.downloadUrl);
  });

  test("hands a worker without object URLs a self-contained copy it does not own", async () => {
    stubPageBlob("x");
    const state = makeBlobState();
    await preparePageBlob(state);
    const load = state.info.loadContent;
    if (!load) throw new Error("loader missing");
    const createObjectURL = URL.createObjectURL;
    Reflect.set(URL, "createObjectURL", undefined);
    const content = await load("request", false).finally(() =>
      Reflect.set(URL, "createObjectURL", createObjectURL),
    );

    expect(content.downloadUrl).toBe("data:image/png;base64,eA==");
    expect(content.ownedObjectUrl).toBeUndefined();
  });

  test("abandons on-demand bytes canceled during the transfer", async () => {
    stubPageBlob("x");
    const state = makeBlobState();
    await preparePageBlob(state);
    const controller = new AbortController();
    state.info.abortSignal = controller.signal;
    const create = vi.spyOn(URL, "createObjectURL");
    const load = state.info.loadContent;
    if (!load) throw new Error("loader missing");

    const loading = load("request", false);
    controller.abort(new Error("Canceled"));

    await expect(loading).rejects.toThrow("Canceled");
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ["no URL", { url: undefined }],
    ["an HTTP URL", { url: "https://page.test/image.png" }],
    ["no tab", { currentTab: null }],
    ["an invalid tab", { currentTab: { id: -1 } }],
    ["already fetched content", { contentPromise: Promise.resolve(null) }],
  ])("leaves a save with %s to the ordinary path", (_name, overrides) => {
    const state = makeBlobState();
    Object.assign(state.info, overrides);
    expect(preparePageBlob(state)).toBeUndefined();
  });

  test("leaves a prepared save alone and reads the top frame without a frame id", async () => {
    stubPageBlob("x");
    const state = makeBlobState();
    state.info.frameId = -1;
    await preparePageBlob(state);
    expect(browser.tabs.connect).toHaveBeenCalledWith(12, { name: PAGE_BLOB_PORT, frameId: 0 });
    expect(preparePageBlob(state)).toBeUndefined();
  });

  test("refuses a caller outside this extension", async () => {
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => {
        server.sender.id = "another-extension";
        servePageBlob(server);
        return client;
      }),
    );
    vi.stubGlobal("fetch", vi.fn());
    await expect(readPageBlob(target)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
