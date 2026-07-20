import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FirefoxBidi, waitForSocketOpen } = require("../../scripts/lib/firefox-bidi.js") as {
  FirefoxBidi: new (socket: WebSocket) => {
    pending: Map<number, unknown>;
    send(method: string, params: object, timeoutMs?: number): Promise<unknown>;
    createPersistentRealm(urlSubstr: string): {
      state(): "missing" | "starting" | "ready" | "stale";
      callFunction(
        functionDeclaration: string,
        args?: unknown[],
        timeoutMs?: number,
      ): Promise<unknown>;
      close(): void;
    };
    doubleClick(urlSubstr: string, x: number, y: number): Promise<unknown>;
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

test("reuses a control realm and marks it stale from lifecycle events", async () => {
  const socket = new FakeSocket();
  let treeReads = 0;
  socket.send.mockImplementation((serialized) => {
    const packet = JSON.parse(String(serialized)) as { id: number; method: string };
    if (packet.method === "browsingContext.getTree") treeReads += 1;
    const result =
      packet.method === "browsingContext.getTree"
        ? {
            contexts: [
              {
                context: "control-context",
                url: "moz-extension://save-in/test/e2e/control.html",
              },
            ],
          }
        : packet.method === "script.callFunction"
          ? { type: "success", result: { type: "string", value: "ok" } }
          : {};
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ id: packet.id, type: "success", result }),
      }),
    );
  });
  const client = new FirefoxBidi(socket as unknown as WebSocket);
  const realm = client.createPersistentRealm("test/e2e/control.html");

  await expect(realm.callFunction("() => 'ok'")).resolves.toBe("ok");
  await expect(realm.callFunction("() => 'ok'")).resolves.toBe("ok");

  expect(treeReads).toBe(1);
  expect(realm.state()).toBe("ready");
  socket.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        method: "browsingContext.contextDestroyed",
        params: { context: "control-context" },
      }),
    }),
  );
  expect(realm.state()).toBe("stale");
  client.close();
});

test("sends two primary-button presses as one trusted pointer action", async () => {
  const socket = new FakeSocket();
  const packets: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  socket.send.mockImplementation((serialized) => {
    const packet = JSON.parse(String(serialized)) as (typeof packets)[number];
    packets.push(packet);
    const result =
      packet.method === "browsingContext.getTree"
        ? { contexts: [{ context: "page", url: "https://example.test/image" }] }
        : {};
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ id: packet.id, type: "success", result }),
      }),
    );
  });
  const client = new FirefoxBidi(socket as unknown as WebSocket);

  await client.doubleClick("example.test", 12, 34);

  const action = packets.find(({ method }) => method === "input.performActions");
  expect(action?.params).toMatchObject({
    context: "page",
    actions: [
      {
        type: "pointer",
        actions: [
          { type: "pointerMove", x: 12, y: 34 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  });
  client.close();
});
