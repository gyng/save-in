// @ts-check

// Minimal WebDriver BiDi client used only for trusted Firefox input. RDP
// remains the extension/tab evaluation channel; BiDi supplies the browser's
// native input source that DOM-dispatched events cannot emulate.

/** @typedef {{context: string, url?: string, children?: BidiContext[]}} BidiContext */
/** @typedef {{resolve: (value: unknown) => void, reject: (error: unknown) => void, timer: NodeJS.Timeout}} Pending */
/**
 * @typedef {{
 *   "session.new": {params: Record<string, unknown>, result: Record<string, unknown>},
 *   "session.subscribe": {
 *     params: {events: string[]}, result: Record<string, unknown>
 *   },
 *   "browsingContext.getTree": {
 *     params: {maxDepth: number}, result: {contexts: BidiContext[]}
 *   },
 *   "script.callFunction": {
 *     params: Record<string, unknown>,
 *     result: {
 *       type: string,
 *       result?: {type: string, value?: string},
 *       exceptionDetails?: {text?: string}
 *     }
 *   },
 *   "browsingContext.close": {
 *     params: {context: string}, result: Record<string, unknown>
 *   },
 *   "input.performActions": {
 *     params: Record<string, unknown>, result: Record<string, unknown>
 *   },
 *   "browsingContext.captureScreenshot": {
 *     params: {context: string}, result: {data: string}
 *   }
 * }} BidiCommandMap
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {WebSocket} socket @param {number} timeoutMs */
const waitForSocketOpen = (socket, timeoutMs) =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve(undefined);
    };
    const onError = () => {
      cleanup();
      reject(new Error("BiDi socket failed"));
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error("Timed out connecting to WebDriver BiDi"));
    }, timeoutMs);
    timer.unref();
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });

class FirefoxBidi {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    /** @type {Set<{handleEvent: (method: string, params: unknown) => void, close: () => void}>} */
    this.realms = new Set();
    /** @type {Promise<void> | undefined} */
    this.lifecycleEventsReady = undefined;
    /** @type {Map<number, Pending>} */
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const packet = /** @type {unknown} */ (JSON.parse(String(event.data)));
      if (!isRecord(packet)) return;
      if (typeof packet.method === "string") {
        for (const realm of this.realms) realm.handleEvent(packet.method, packet.params);
        return;
      }
      if (typeof packet.id !== "number") return;
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      clearTimeout(pending.timer);
      if (packet.type === "success") pending.resolve(packet.result);
      else {
        const message =
          typeof packet.message === "string"
            ? packet.message
            : typeof packet.error === "string"
              ? packet.error
              : "WebDriver BiDi error";
        pending.reject(new Error(message));
      }
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
        await waitForSocketOpen(socket, Math.max(1, deadline - Date.now()));
        const client = new FirefoxBidi(socket);
        await client.send("session.new", { capabilities: { alwaysMatch: {} } }, 30000);
        return client;
      } catch (error) {
        lastError = error;
        socket?.close();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new Error(`Firefox did not expose WebDriver BiDi on port ${port}`, { cause: lastError });
  }

  /**
   * @template {keyof BidiCommandMap} Method
   * @param {Method} method
   * @param {BidiCommandMap[Method]["params"]} params
   * @param {number} [timeoutMs]
   * @returns {Promise<BidiCommandMap[Method]["result"]>}
   */
  send(method, params, timeoutMs = 15000) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WebDriver BiDi timeout: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(/** @type {BidiCommandMap[Method]["result"]} */ (value)),
        reject,
        timer,
      });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /** @param {string} urlSubstr */
  async findContext(urlSubstr) {
    const result = await this.send("browsingContext.getTree", { maxDepth: 8 });
    const pending = [...result.contexts];
    while (pending.length) {
      const context = pending.shift();
      if (typeof context?.url === "string" && context.url.includes(urlSubstr)) {
        return context.context;
      }
      if (Array.isArray(context?.children)) pending.push(...context.children);
    }
    throw Object.assign(new Error(`No Firefox BiDi context matching "${urlSubstr}"`), {
      code: "E2E_CONTROL_TARGET_MISSING",
    });
  }

  async ensureLifecycleEvents() {
    this.lifecycleEventsReady ??= this.send("session.subscribe", {
      events: ["browsingContext.contextCreated", "browsingContext.contextDestroyed"],
    }).then(() => undefined);
    await this.lifecycleEventsReady;
  }

  /**
   * Caches one control context and follows its create/destroy lifecycle through
   * BiDi events. Other page helpers keep using on-demand discovery.
   *
   * @param {string} urlSubstr
   */
  createPersistentRealm(urlSubstr) {
    /** @type {"missing" | "starting" | "ready" | "stale"} */
    let state = "missing";
    /** @type {string | undefined} */
    let context;
    /** @type {Promise<void> | undefined} */
    let starting;
    const unavailable = (/** @type {unknown} */ cause) =>
      Object.assign(new Error(`E2E control realm is unavailable: ${urlSubstr}`, { cause }), {
        code: "E2E_CONTROL_TARGET_MISSING",
      });
    const invalidate = () => {
      context = undefined;
      state = state === "missing" ? "missing" : "stale";
    };
    const realm = {
      state: () => state,
      invalidate,
      /** @param {unknown} error */
      isSameRealm: async (error) => {
        const dispatchedRealm =
          error instanceof Error
            ? /** @type {Error & {e2eControlRealmId?: string}} */ (error).e2eControlRealmId
            : undefined;
        if (!dispatchedRealm) return false;
        try {
          await this.ensureLifecycleEvents();
          const discovered = await this.findContext(urlSubstr);
          if (discovered !== dispatchedRealm) return false;
          context = discovered;
          state = "ready";
          return true;
        } catch {
          return false;
        }
      },
      /** @param {string} method @param {unknown} params */
      handleEvent: (method, params) => {
        if (!isRecord(params)) return;
        const eventContext =
          typeof params.context === "string"
            ? params.context
            : isRecord(params.context) && typeof params.context.context === "string"
              ? params.context.context
              : undefined;
        if (method === "browsingContext.contextDestroyed" && eventContext === context) {
          context = undefined;
          state = "stale";
          return;
        }
        const eventUrl =
          isRecord(params.context) && typeof params.context.url === "string"
            ? params.context.url
            : undefined;
        if (
          method === "browsingContext.contextCreated" &&
          eventContext &&
          eventUrl?.includes(urlSubstr)
        ) {
          context = eventContext;
          state = "ready";
        }
      },
      /**
       * @param {string} functionDeclaration
       * @param {unknown[]} [args]
       * @param {number} [timeoutMs]
       */
      callFunction: async (functionDeclaration, args = [], timeoutMs = 15000) => {
        if (state !== "ready" || !context) {
          starting ??= (async () => {
            state = "starting";
            try {
              await this.ensureLifecycleEvents();
              context = await this.findContext(urlSubstr);
              state = "ready";
            } catch (error) {
              context = undefined;
              state = "missing";
              throw unavailable(error);
            }
          })().finally(() => {
            starting = undefined;
          });
          await starting;
        }
        const activeContext = context;
        if (!activeContext) throw unavailable("realm became stale");
        try {
          return await this.callFunctionInContext(
            activeContext,
            functionDeclaration,
            args,
            timeoutMs,
          );
        } catch (error) {
          invalidate();
          const failure = error instanceof Error ? error : new Error(String(error));
          Object.assign(failure, { e2eControlRealmId: activeContext });
          throw failure;
        }
      },
      /** @param {string} functionDeclaration @param {unknown} expected @param {number} [timeoutMs] */
      waitForFunction: async (functionDeclaration, expected, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        let lastError;
        while (Date.now() < deadline) {
          try {
            const value = await realm.callFunction(
              functionDeclaration,
              [],
              Math.min(2500, Math.max(1, deadline - Date.now())),
            );
            if (Object.is(value, expected)) return value;
            lastError = new Error(`Control realm returned ${String(value)}`);
          } catch (error) {
            lastError = error;
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
        throw new Error(`Control realm did not become ready: ${urlSubstr}`, { cause: lastError });
      },
      close: () => {
        invalidate();
        state = "missing";
        this.realms.delete(realm);
      },
    };
    this.realms.add(realm);
    return realm;
  }

  /**
   * Calls a function in the page realm with JSON-compatible structured
   * arguments. This avoids building console-evaluation expressions from test
   * data while preserving Firefox's real extension page and runtime boundary.
   *
   * @param {string} urlSubstr
   * @param {string} functionDeclaration
   * @param {unknown[]} [args]
   * @param {number} [timeoutMs]
   */
  async callFunction(urlSubstr, functionDeclaration, args = [], timeoutMs = 15000) {
    const context = await this.findContext(urlSubstr);
    return this.callFunctionInContext(context, functionDeclaration, args, timeoutMs);
  }

  /**
   * @param {string} context
   * @param {string} functionDeclaration
   * @param {unknown[]} [args]
   * @param {number} [timeoutMs]
   */
  async callFunctionInContext(context, functionDeclaration, args = [], timeoutMs = 15000) {
    const result = await this.send(
      "script.callFunction",
      {
        functionDeclaration,
        awaitPromise: true,
        target: { context },
        arguments: args.map((value) => ({ type: "string", value: JSON.stringify(value) })),
      },
      timeoutMs,
    );
    if (result?.type !== "success") {
      const message = result?.exceptionDetails?.text || "Firefox BiDi function call failed";
      throw new Error(message);
    }
    const remote = result.result;
    if (remote?.type === "undefined") return undefined;
    if (remote?.type !== "string") {
      throw new Error(
        `Firefox BiDi function returned unsupported type: ${remote?.type || "missing"}`,
      );
    }
    return remote.value;
  }

  /** @param {string} urlSubstr */
  async closeContext(urlSubstr) {
    const context = await this.findContext(urlSubstr);
    return this.send("browsingContext.close", { context });
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

  /** @param {string} urlSubstr */
  async captureScreenshot(urlSubstr) {
    const context = await this.findContext(urlSubstr);
    const result = await this.send("browsingContext.captureScreenshot", { context });
    if (typeof result?.data !== "string") {
      throw new Error("Firefox BiDi screenshot did not return image data");
    }
    return result.data;
  }

  close() {
    for (const realm of this.realms) realm.close();
    this.failPending(new Error("WebDriver BiDi connection closed"));
    this.socket.close();
  }
}

module.exports = { FirefoxBidi, waitForSocketOpen };
