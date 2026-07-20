import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  Cdp,
  callFunctionInTarget,
  createPersistentTargetSession,
  evalInTarget,
  extensionIdFromTargets,
  getJson,
  listTargets,
  waitForCdp,
} = require("../../scripts/lib/cdp.js") as {
  Cdp: new (socket: FakeSocket) => {
    send: (method: string, params?: object, timeoutMs?: number) => Promise<unknown>;
    close: () => void;
  };
  getJson: (port: number, path: string, timeoutMs?: number) => Promise<unknown>;
  callFunctionInTarget: (
    port: number,
    urlSubstr: string,
    functionDeclaration: string,
    args?: unknown[],
    timeoutMs?: number,
  ) => Promise<unknown>;
  createPersistentTargetSession: (
    port: number,
    urlSubstr: string,
  ) => {
    state: () => "missing" | "starting" | "ready" | "stale";
    callFunction: (
      functionDeclaration: string,
      args?: unknown[],
      timeoutMs?: number,
    ) => Promise<unknown>;
    close: () => void;
  };
  evalInTarget: (
    port: number,
    urlSubstr: string,
    expression: string,
    timeoutMs?: number,
  ) => Promise<unknown>;
  listTargets: (
    port: number,
  ) => Promise<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl: string }>>;
  extensionIdFromTargets: (
    targets: Array<{ type: string; url: string; webSocketDebuggerUrl: string }>,
    expectedResource?: string,
  ) => string | undefined;
  waitForCdp: (port: number) => Promise<void>;
};

type SocketEvent = { data?: string };
type SocketListener = (event: SocketEvent) => void;

class FakeSocket {
  listeners = new Map<string, SocketListener[]>();
  send = vi.fn<(message: string) => void>();
  close = vi.fn(() => this.emit("close"));

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: SocketEvent = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe("CDP transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("registers a request before sending so a synchronous response is not lost", async () => {
    const socket = new FakeSocket();
    socket.send.mockImplementation((message) => {
      const { id } = JSON.parse(message) as { id: number };
      socket.emit("message", { data: JSON.stringify({ id, result: { ready: true } }) });
    });
    const client = new Cdp(socket);

    await expect(client.send("Runtime.enable", {}, 100)).resolves.toEqual({ ready: true });
  });

  test("rejects pending requests immediately when the socket closes", async () => {
    const socket = new FakeSocket();
    const client = new Cdp(socket);
    const request = client.send("Runtime.evaluate", {}, 10_000);

    socket.emit("close");

    await expect(request).rejects.toThrow("CDP connection closed");
  });

  test("rejects an unsuccessful HTTP discovery response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getJson(9555, "/json/version", 25)).rejects.toThrow(
      "CDP endpoint /json/version returned 503 Unavailable",
    );
    expect(fetchMock.mock.calls[0]![1]!).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  test("rejects malformed target discovery payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ type: "page", url: "about:blank" }]),
      }),
    );

    await expect(listTargets(9555)).rejects.toThrow("invalid target list");
  });

  test("retries discovery without a settling timer", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("not listening"))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ Browser: "Chrome" }) });
    vi.stubGlobal("fetch", fetchMock);
    const timer = vi.spyOn(globalThis, "setTimeout");

    try {
      await waitForCdp(9555);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  test("does not repeat a side-effecting call after an ambiguous disconnect", async () => {
    let sockets = 0;
    let dispatches = 0;
    class ConnectableSocket extends FakeSocket {
      constructor() {
        super();
        sockets += 1;
        this.send.mockImplementation((message) => {
          const packet = JSON.parse(message) as { id: number; method: string };
          if (packet.method === "Runtime.evaluate") {
            this.emit("message", {
              data: JSON.stringify({ id: packet.id, result: { result: { objectId: "root" } } }),
            });
            return;
          }
          if (packet.method === "Runtime.callFunctionOn") {
            dispatches += 1;
            this.emit("close");
          }
        });
        queueMicrotask(() => this.emit("open"));
      }
    }
    vi.stubGlobal("WebSocket", ConnectableSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: "options",
              type: "page",
              url: "chrome-extension://save-in/options.html",
              webSocketDebuggerUrl: "ws://options",
            },
          ]),
      }),
    );

    await expect(
      callFunctionInTarget(9555, "options.html", "function () { return true; }", [], 100),
    ).rejects.toThrow("CDP connection closed");
    expect(dispatches).toBe(1);
    expect(sockets).toBe(1);
  });

  test("reuses one target discovery, socket, and realm across control calls", async () => {
    let sockets = 0;
    class ConnectableSocket extends FakeSocket {
      constructor() {
        super();
        sockets += 1;
        this.send.mockImplementation((message) => {
          const packet = JSON.parse(message) as { id: number; method: string };
          const result =
            packet.method === "Runtime.evaluate"
              ? { result: { objectId: "root" } }
              : { result: { value: "ok" } };
          this.emit("message", { data: JSON.stringify({ id: packet.id, result }) });
        });
        queueMicrotask(() => this.emit("open"));
      }
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "control",
            type: "page",
            url: "chrome-extension://save-in/test/e2e/control.html",
            webSocketDebuggerUrl: "ws://control",
          },
        ]),
    });
    vi.stubGlobal("WebSocket", ConnectableSocket);
    vi.stubGlobal("fetch", fetchMock);
    const session = createPersistentTargetSession(9555, "test/e2e/control.html");

    await expect(session.callFunction("function () {}")).resolves.toBe("ok");
    await expect(session.callFunction("function () {}")).resolves.toBe("ok");

    expect(session.state()).toBe("ready");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sockets).toBe(1);
    session.close();
  });

  test("bounds a target evaluation with the caller timeout and does not repeat it", async () => {
    let sockets = 0;
    class UnresponsiveSocket extends FakeSocket {
      constructor() {
        super();
        sockets += 1;
        queueMicrotask(() => this.emit("open"));
      }
    }
    vi.stubGlobal("WebSocket", UnresponsiveSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: "options",
              type: "page",
              url: "chrome-extension://save-in/options.html",
              webSocketDebuggerUrl: "ws://options",
            },
          ]),
      }),
    );

    await expect(evalInTarget(9555, "options.html", "sideEffect()", 25)).rejects.toThrow(
      "CDP timeout: Runtime.evaluate",
    );
    expect(sockets).toBe(1);
  });
});

test("discovers a legacy-loaded unpacked extension from its browser target", () => {
  expect(
    extensionIdFromTargets([
      { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://page" },
      {
        type: "background_page",
        url: `chrome-extension://${"b".repeat(32)}/background.html`,
        webSocketDebuggerUrl: "ws://built-in",
      },
      {
        type: "service_worker",
        url: `chrome-extension://${"a".repeat(32)}/background.sw.js`,
        webSocketDebuggerUrl: "ws://worker",
      },
    ]),
  ).toBe("a".repeat(32));
});

test("does not mistake another extension target for the legacy-loaded package", () => {
  expect(
    extensionIdFromTargets([
      {
        type: "service_worker",
        url: `chrome-extension://${"b".repeat(32)}/service_worker.js`,
        webSocketDebuggerUrl: "ws://built-in",
      },
      {
        type: "page",
        url: `chrome-extension://${"c".repeat(32)}/background.sw.js`,
        webSocketDebuggerUrl: "ws://page",
      },
    ]),
  ).toBeUndefined();
});
