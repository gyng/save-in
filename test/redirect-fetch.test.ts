import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { options } from "../src/config/options-data.ts";
import { fetchFollowingRedirects } from "../src/shared/redirect-fetch.ts";
import { resolveHead } from "../src/routing/variable.ts";

const servers: Server[] = [];

const listen = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );

describe("redirect-aware extension fetches", () => {
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

  test("uses the native follow mode when no response timeout is requested", async () => {
    const response = new Response("ok");
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);

    await expect(fetchFollowingRedirects("https://example.test/file")).resolves.toBe(response);
    expect(fetcher).toHaveBeenCalledWith("https://example.test/file", { redirect: "follow" });
  });

  test("forwards an already-aborted caller signal", async () => {
    const caller = new AbortController();
    caller.abort(new DOMException("caller stopped", "AbortError"));
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });

    await expect(
      fetchFollowingRedirects("https://example.test/file", { signal: caller.signal }, 100),
    ).rejects.toThrow("caller stopped");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("falls back to a body-cancelled GET when the server rejects HEAD", async () => {
    const methods: string[] = [];
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
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end("download bytes");
    });

    const result = await resolveHead({ url: `${origin}/start` });

    expect(result).toEqual({
      contentType: "application/octet-stream",
      finalUrl: `${origin}/final.bin`,
    });
    expect(methods).toEqual(["HEAD /start", "GET /start", "GET /final.bin"]);
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
});
