import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Cdp, getJson } = require("../scripts/lib/cdp.js") as {
  Cdp: new (socket: FakeSocket) => {
    send: (method: string, params?: object, timeoutMs?: number) => Promise<unknown>;
    close: () => void;
  };
  getJson: (port: number, path: string, timeoutMs?: number) => Promise<unknown>;
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
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
