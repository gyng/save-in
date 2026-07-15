import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FirefoxBidi, waitForSocketOpen } = require("../../scripts/lib/firefox-bidi.js") as {
  FirefoxBidi: new (socket: WebSocket) => {
    pending: Map<number, unknown>;
    send(method: string, params: object, timeoutMs?: number): Promise<unknown>;
    close(): void;
  };
  waitForSocketOpen: (socket: WebSocket, timeoutMs: number) => Promise<void>;
};

class FakeSocket extends EventTarget {
  close = vi.fn();
  send = vi.fn();
}

afterEach(() => vi.useRealTimers());

test("bounds a BiDi connection attempt and closes the unused socket", async () => {
  vi.useFakeTimers();
  const socket = new FakeSocket();
  const opening = waitForSocketOpen(socket as unknown as WebSocket, 50);
  const assertion = expect(opening).rejects.toThrow("Timed out connecting");

  await vi.advanceTimersByTimeAsync(50);

  await assertion;
  expect(socket.close).toHaveBeenCalledOnce();
});

test("clears a command when WebSocket.send throws synchronously", async () => {
  const socket = new FakeSocket();
  socket.send.mockImplementation(() => {
    throw new Error("socket is closed");
  });
  const client = new FirefoxBidi(socket as unknown as WebSocket);

  await expect(client.send("session.new", {})).rejects.toThrow("socket is closed");

  expect(client.pending.size).toBe(0);
  client.close();
});
