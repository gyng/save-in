import { createHash } from "node:crypto";
import { servePageBlob } from "../../src/content/page-blob.ts";
import { readPageBlob } from "../../src/downloads/page-blob.ts";
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

describe("page-owned blob transfer", () => {
  const url = "blob:https://page.test/image-id";
  let client: ReturnType<typeof makePort>;
  let server: ReturnType<typeof makePort>;
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "https://page.test" });
    client = makePort();
    server = makePort();
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
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => {
        servePageBlob(server);
        return client;
      }),
    );
  });
  afterEach(() => {
    client.disconnect();
    server.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("relays multiple bounded chunks, preserves MIME/bytes, and computes the hash", async () => {
    const bytes = Uint8Array.from({ length: PAGE_BLOB_CHUNK_BYTES * 2 + 17 }, (_, i) => i % 251);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "image/png" } })),
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const result = await readPageBlob(12, 7, url);

    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(result.blob.type).toBe("image/png");
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(browser.tabs.connect).toHaveBeenCalledWith(12, { name: PAGE_BLOB_PORT, frameId: 7 });
    expect(
      server.postMessage.mock.calls.filter(
        ([message]) =>
          typeof message === "object" &&
          message !== null &&
          Reflect.get(message, "type") === "chunk",
      ),
    ).toHaveLength(3);
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
  });

  test.each(["https://page.test/image.png", "blob:https://other.test/id", "blob:null/id"])(
    "does not fetch a nonlocal source: %s",
    async (source) => {
      vi.stubGlobal("fetch", vi.fn());
      await expect(readPageBlob(12, 0, source)).rejects.toThrow("no longer available");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("rejects a revoked blob and releases the port", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network error")));
    await expect(readPageBlob(12, 0, url)).rejects.toThrow("no longer available");
    expect(client.onMessage.hasListeners()).toBe(false);
    expect(server.onMessage.hasListeners()).toBe(false);
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
    const result = readPageBlob(12, 0, url, controller.signal);
    const rejected = expect(result).rejects.toThrow("Canceled");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort(new Error("Canceled"));
    await rejected;
    expect(contentSignal?.aborted).toBe(true);
    expect(client.onMessage.hasListeners()).toBe(false);
    expect(server.onMessage.hasListeners()).toBe(false);
  });

  test("fails a silent or stale content script after a bounded wait", async () => {
    vi.useFakeTimers();
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => client),
    );
    const result = expect(readPageBlob(12, 0, url)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(PAGE_BLOB_TIMEOUT_MS);
    await result;
    expect(client.onMessage.hasListeners()).toBe(false);
  });

  test("rejects an incomplete response before constructing a download", async () => {
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => client),
    );
    const result = expect(readPageBlob(12, 0, url)).rejects.toThrow("Incomplete");
    client.onMessage.emit({ type: "metadata", size: 10, mime: "image/png" }, client);
    client.onMessage.emit({ type: "done" }, client);
    await result;
  });

  test("rejects oversized transport chunks", async () => {
    installHostProperty(
      browser.tabs,
      "connect",
      vi.fn(() => client),
    );
    const result = expect(readPageBlob(12, 0, url)).rejects.toThrow("Invalid blob chunk");
    client.onMessage.emit(
      { type: "metadata", size: PAGE_BLOB_CHUNK_BYTES * 2, mime: "image/png" },
      client,
    );
    client.onMessage.emit({ type: "chunk", data: "A".repeat(PAGE_BLOB_CHUNK_BYTES * 2) }, client);
    await result;
  });

  test("refuses a caller outside this extension", async () => {
    server.sender.id = "another-extension";
    vi.stubGlobal("fetch", vi.fn());
    await expect(readPageBlob(12, 0, url)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
