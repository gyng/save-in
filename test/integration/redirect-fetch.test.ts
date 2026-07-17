import { createServer, type RequestListener, type Server } from "node:http";
import { options } from "../../src/config/options-data.ts";
import { configureRoutingPorts, routingPorts } from "../../src/routing/ports.ts";
import { resolveHead } from "../../src/routing/variable.ts";
import type { RefererProtection } from "../../src/shared/protected-fetch.ts";
import { fetchFollowingRedirects } from "../../src/shared/redirect-fetch.ts";
import { closeServer, listenOnLoopback } from "./server.ts";

const servers: Server[] = [];

const listen = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  const { port } = await listenOnLoopback(server);
  return `http://127.0.0.1:${port}`;
};

describe("redirect-aware extension fetches over HTTP", () => {
  beforeEach(() => {
    options.includeFetchCredentials = false;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(closeServer));
  });

  test("follows a real cross-origin redirect and exposes the final URL", async () => {
    const targetOrigin = await listen((_request, response) => {
      response.writeHead(200, { "Content-Type": "image/webp" });
      response.end("image bytes");
    });
    const sourceOrigin = await listen((_request, response) => {
      response.writeHead(302, { Location: `${targetOrigin}/final.webp` });
      response.end();
    });

    const result = await resolveHead({ url: `${sourceOrigin}/start` });

    expect(result).toEqual({
      contentType: "image/webp",
      finalUrl: `${targetOrigin}/final.webp`,
    });
  });

  test("falls back to a body-cancelled GET when the server rejects HEAD", async () => {
    const methods: string[] = [];
    let closeFinalResponse!: (writableEnded: boolean) => void;
    const finalResponseClosed = new Promise<boolean>((resolve) => {
      closeFinalResponse = resolve;
    });
    let origin = "";
    origin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.method === "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      if (request.url === "/start") {
        response.writeHead(302, { Location: `${origin}/final.bin` });
        response.end();
        return;
      }
      response.once("close", () => closeFinalResponse(response.writableEnded));
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.write("download prefix");
    });

    const result = await resolveHead({ url: `${origin}/start` });

    expect(result).toEqual({
      contentType: "application/octet-stream",
      finalUrl: `${origin}/final.bin`,
    });
    expect(methods).toEqual(["HEAD /start", "GET /start", "GET /final.bin"]);
    await expect(finalResponseClosed).resolves.toBe(false);
  });

  test("falls back to GET when the HEAD connection drops", async () => {
    const methods: string[] = [];
    const origin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.method === "HEAD") {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("download bytes");
    });

    await expect(resolveHead({ url: `${origin}/file.txt` })).resolves.toEqual({
      contentType: "text/plain",
      finalUrl: `${origin}/file.txt`,
    });
    expect(methods).toEqual(["HEAD /file.txt", "GET /file.txt"]);
  });

  // Node has no declarativeNetRequest, so these cases exercise the seam the
  // browser rule sits behind: the retry loop must extend protection to the
  // exact redirect target and refetch, mirroring RefererRules.extend's
  // refusal of already-covered URLs.
  const withFakeProtection = async <T>(
    granted: Set<string>,
    extendCalls: string[],
    run: () => Promise<T>,
  ): Promise<T> => {
    const original = routingPorts.withRequestReferer;
    configureRoutingPorts({
      withRequestReferer: (url, _referer, operation) => {
        const covered = new Set([url]);
        const protection: RefererProtection = {
          extend: async (candidate) => {
            extendCalls.push(candidate);
            if (covered.has(candidate)) return false;
            covered.add(candidate);
            granted.add(candidate);
            return true;
          },
        };
        return operation(protection);
      },
    });
    try {
      return await run();
    } finally {
      configureRoutingPorts({ withRequestReferer: original });
    }
  };

  test("re-covers a redirected metadata HEAD after extending protection", async () => {
    const methods: string[] = [];
    const granted = new Set<string>();
    const extendCalls: string[] = [];
    let targetOrigin = "";
    targetOrigin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (!granted.has(`${targetOrigin}${request.url}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "image/webp" });
      response.end();
    });
    const sourceOrigin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      response.writeHead(302, { Location: `${targetOrigin}/final.webp` });
      response.end();
    });

    const result = await withFakeProtection(granted, extendCalls, () =>
      resolveHead({
        url: `${sourceOrigin}/start`,
        protectedFetchReferer: "https://gallery.example/view",
      }),
    );

    expect(result).toEqual({
      contentType: "image/webp",
      finalUrl: `${targetOrigin}/final.webp`,
    });
    expect(extendCalls).toEqual([`${targetOrigin}/final.webp`]);
    expect(methods).toEqual(["HEAD /start", "HEAD /final.webp", "HEAD /start", "HEAD /final.webp"]);
  });

  test("extends protection from the GET fallback when HEAD is rejected", async () => {
    const methods: string[] = [];
    const granted = new Set<string>();
    const extendCalls: string[] = [];
    let origin = "";
    origin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.method === "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      if (request.url === "/start") {
        response.writeHead(302, { Location: `${origin}/final.bin` });
        response.end();
        return;
      }
      if (!granted.has(`${origin}${request.url}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end();
    });

    const result = await withFakeProtection(granted, extendCalls, () =>
      resolveHead({
        url: `${origin}/start`,
        protectedFetchReferer: "https://gallery.example/view",
      }),
    );

    expect(result).toEqual({
      contentType: "application/octet-stream",
      finalUrl: `${origin}/final.bin`,
    });
    // The rejected HEAD offers only the already-covered original URL; the
    // redirect target is discovered and extended by the GET fallback.
    expect(extendCalls).toEqual([`${origin}/start`, `${origin}/final.bin`]);
    expect(methods).toEqual([
      "HEAD /start",
      "GET /start",
      "GET /final.bin",
      "GET /start",
      "GET /final.bin",
    ]);
  });

  test("degrades to unextended metadata when protection refuses to extend", async () => {
    const methods: string[] = [];
    let origin = "";
    origin = await listen((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.url === "/start") {
        response.writeHead(302, { Location: `${origin}/final.bin` });
        response.end();
        return;
      }
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end();
    });
    const original = routingPorts.withRequestReferer;
    configureRoutingPorts({
      withRequestReferer: (_url, _referer, operation) => operation({ extend: async () => false }),
    });

    try {
      await expect(
        resolveHead({
          url: `${origin}/start`,
          protectedFetchReferer: "https://gallery.example/view",
        }),
      ).resolves.toEqual({
        contentType: "text/plain",
        finalUrl: `${origin}/final.bin`,
      });
    } finally {
      configureRoutingPorts({ withRequestReferer: original });
    }
    expect(methods).toEqual(["HEAD /start", "HEAD /final.bin", "GET /start", "GET /final.bin"]);
  });

  test("rejects a redirect loop instead of hanging", async () => {
    let origin = "";
    origin = await listen((_request, response) => {
      response.writeHead(302, { Location: `${origin}/loop` });
      response.end();
    });

    await expect(fetchFollowingRedirects(`${origin}/loop`, {}, 1000)).rejects.toThrow();
  });

  test("times out while waiting for redirect response headers", async () => {
    const origin = await listen(() => {
      // Deliberately leave the response open until the fetch helper aborts.
    });

    await expect(fetchFollowingRedirects(`${origin}/slow`, {}, 25)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  test("forwards a caller abort after the HTTP request has started", async () => {
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    let markConnectionClosed!: () => void;
    const connectionClosed = new Promise<void>((resolve) => {
      markConnectionClosed = resolve;
    });
    const origin = await listen((_request, response) => {
      markRequestStarted();
      response.once("close", markConnectionClosed);
    });
    const caller = new AbortController();
    const pending = fetchFollowingRedirects(`${origin}/abort`, { signal: caller.signal }, 1000);

    await requestStarted;
    caller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "caller stopped" });
    await connectionClosed;
  });
});
