// @ts-check

// Minimal WebDriver BiDi client used only for trusted Firefox input. RDP
// remains the extension/tab evaluation channel; BiDi supplies the browser's
// native input source that DOM-dispatched events cannot emulate.

/** @typedef {{resolve: (value: any) => void, reject: (error: unknown) => void, timer: NodeJS.Timeout}} Pending */

class FirefoxBidi {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    /** @type {Map<number, Pending>} */
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      /** @type {any} */
      const packet = JSON.parse(String(event.data));
      if (typeof packet?.id !== "number") return;
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      clearTimeout(pending.timer);
      if (packet.type === "success") pending.resolve(packet.result);
      else pending.reject(new Error(packet.message || packet.error || "WebDriver BiDi error"));
    });
    const fail = () => this.failPending(new Error("WebDriver BiDi connection closed"));
    socket.addEventListener("close", fail);
    socket.addEventListener("error", fail);
  }

  /** @param {unknown} error */
  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** @param {number} port @param {number} [timeoutMs] */
  static async connect(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      /** @type {WebSocket | undefined} */
      let socket;
      try {
        socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
        await new Promise((resolve, reject) => {
          socket?.addEventListener("open", resolve, { once: true });
          socket?.addEventListener("error", () => reject(new Error("BiDi socket failed")), {
            once: true,
          });
        });
        const client = new FirefoxBidi(socket);
        await client.send("session.new", { capabilities: { alwaysMatch: {} } }, 30000);
        return client;
      } catch (error) {
        lastError = error;
        socket?.close();
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    throw new Error(`Firefox did not expose WebDriver BiDi on port ${port}`, { cause: lastError });
  }

  /** @param {string} method @param {Record<string, unknown>} params @param {number} [timeoutMs] */
  send(method, params, timeoutMs = 15000) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WebDriver BiDi timeout: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** @param {string} urlSubstr */
  async findContext(urlSubstr) {
    const result = await this.send("browsingContext.getTree", { maxDepth: 8 });
    /** @type {any[]} */
    const pending = [...(Array.isArray(result?.contexts) ? result.contexts : [])];
    while (pending.length) {
      const context = pending.shift();
      if (typeof context?.url === "string" && context.url.includes(urlSubstr)) {
        return context.context;
      }
      if (Array.isArray(context?.children)) pending.push(...context.children);
    }
    throw new Error(`No Firefox BiDi context matching "${urlSubstr}"`);
  }

  /** @param {string} urlSubstr @param {number} x @param {number} y */
  async altClick(urlSubstr, x, y) {
    const context = await this.findContext(urlSubstr);
    return this.send("input.performActions", {
      context,
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "\uE00A" },
            { type: "pause", duration: 0 },
            { type: "pause", duration: 0 },
            { type: "pause", duration: 0 },
            { type: "keyUp", value: "\uE00A" },
          ],
        },
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pause", duration: 0 },
            { type: "pointerMove", x, y, duration: 0, origin: "viewport" },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
            { type: "pause", duration: 0 },
          ],
        },
      ],
    });
  }

  close() {
    this.failPending(new Error("WebDriver BiDi connection closed"));
    this.socket.close();
  }
}

module.exports = { FirefoxBidi };
