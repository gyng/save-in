// The Firefox e2e RDP client (scripts/lib/firefox-rdp.js). These guard the
// "exit 1 despite passing" artifact: an unref'd timeout rejecting after the
// suite finished. close() must settle everything still pending.
import { EventEmitter } from "events";

const { FirefoxRdp } = (await import("../scripts/lib/firefox-rdp.js")).default;

// A fake net.Socket: FirefoxRdp only needs write/destroy plus EventEmitter's
// on/emit, so the mock's shape is intentionally untyped
const makeSocket = (): any => {
  const s = new EventEmitter();
  (s as any).write = vi.fn();
  (s as any).destroy = vi.fn();
  return s;
};

// RDP framing: "<byteLength>:<json>"
const frame = (obj: Record<string, unknown>) => {
  const j = JSON.stringify(obj);
  return Buffer.from(`${Buffer.byteLength(j)}:${j}`);
};

describe("FirefoxRdp waitForEvent", () => {
  test("resolves on a matching packet", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    const p = client.waitForEvent((pkt) => pkt.from === "root");
    sock.emit("data", frame({ from: "root", type: "hello" }));
    await expect(p).resolves.toMatchObject({ from: "root" });
    // waiter consumed
    expect(client.eventWaiters).toHaveLength(0);
  });

  test("consumes an async event that arrived before its waiter", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    sock.emit("data", frame({ from: "console1", type: "evaluationResult", resultID: "r1" }));

    await expect(
      client.waitForEvent((pkt) => pkt.type === "evaluationResult" && pkt.resultID === "r1"),
    ).resolves.toMatchObject({ resultID: "r1" });
    expect(client.eventBacklog).toHaveLength(0);
  });

  test("does not retain unrelated lifecycle events for future operations", () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);

    sock.emit("data", frame({ from: "root", type: "tabListChanged" }));

    expect(client.eventBacklog).toHaveLength(0);
  });

  test("rejects on timeout and drops the waiter", async () => {
    vi.useFakeTimers();
    try {
      const sock = makeSocket();
      const client = new FirefoxRdp(sock);
      const p = client.waitForEvent(() => false, 1000);
      const assertion = expect(p).rejects.toThrow("RDP event timeout");
      vi.advanceTimersByTime(1001);
      await assertion;
      expect(client.eventWaiters).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears its timeout on resolve so it can't reject later", async () => {
    vi.useFakeTimers();
    try {
      const sock = makeSocket();
      const client = new FirefoxRdp(sock);
      const p = client.waitForEvent((pkt) => pkt.type === "ready", 1000);
      sock.emit("data", frame({ from: "x", type: "ready" }));
      await expect(p).resolves.toMatchObject({ type: "ready" });
      // If the timer weren't cleared it would fire here; the promise is already
      // settled so this must be a no-op (no unhandled rejection)
      vi.advanceTimersByTime(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FirefoxRdp close()", () => {
  test("settles a still-pending waiter instead of rejecting after teardown", async () => {
    vi.useFakeTimers();
    try {
      const sock = makeSocket();
      const client = new FirefoxRdp(sock);
      const p = client.waitForEvent((pkt) => pkt.type === "never");
      client.close();
      // settled (undefined), not rejected — no unhandled rejection at teardown
      await expect(p).resolves.toBeUndefined();
      vi.advanceTimersByTime(60000); // timer was cleared; nothing fires
      expect(sock.destroy).toHaveBeenCalled();
      expect(client.eventWaiters).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("settles a still-pending request instead of rejecting after teardown", async () => {
    vi.useFakeTimers();
    try {
      const sock = makeSocket();
      const client = new FirefoxRdp(sock);
      const p = client.request({ to: "actor1", type: "ping" });
      client.close();
      await expect(p).resolves.toBeUndefined();
      vi.advanceTimersByTime(60000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FirefoxRdp request", () => {
  test("resolves with the actor's next reply (per-actor FIFO)", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    const p = client.request({ to: "actor1", type: "getThing" });
    expect(sock.write).toHaveBeenCalledTimes(1);
    sock.emit("data", frame({ from: "actor1", value: 42 }));
    await expect(p).resolves.toMatchObject({ value: 42 });
  });

  test("rejects when the reply carries an error", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    const p = client.request({ to: "actor1", type: "boom" });
    sock.emit("data", frame({ from: "actor1", error: "badRequest", message: "nope" }));
    await expect(p).rejects.toThrow(/badRequest/);
  });
});

describe("FirefoxRdp evaluate", () => {
  test("rejects a malformed asynchronous evaluation acknowledgement", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    const evaluated = client.evaluate("console1", '"hello"');

    sock.emit("data", frame({ from: "console1", resultID: 42 }));

    await expect(evaluated).rejects.toThrow("evaluateJSAsync did not return resultID");
  });

  test("retrieves the complete value represented by a long-string grip", async () => {
    const sock = makeSocket();
    const client = new FirefoxRdp(sock);
    const evaluated = client.evaluate("console1", '"hello world"');

    sock.emit("data", frame({ from: "console1", resultID: "result1" }));
    await Promise.resolve();
    sock.emit(
      "data",
      frame({
        from: "console1",
        type: "evaluationResult",
        resultID: "result1",
        result: { type: "longString", actor: "long1", initial: "hello", length: 11 },
      }),
    );
    await vi.waitFor(() => expect(sock.write).toHaveBeenCalledTimes(2));
    sock.emit("data", frame({ from: "long1", substring: " world" }));

    await expect(evaluated).resolves.toBe("hello world");
  });
});
