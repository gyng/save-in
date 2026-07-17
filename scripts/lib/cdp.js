// @ts-check

// Minimal Chrome DevTools Protocol client (no dependencies, Node >= 22 for
// the global WebSocket). Used by dev-chrome.js and e2e-chrome.js.

/** @typedef {{id: string, type: string, url: string, webSocketDebuggerUrl: string}} CdpTarget */
/** @typedef {{resolve: (value: unknown) => void, reject: (error: unknown) => void}} PendingCommand */
/**
 * @typedef {{
 *   "Runtime.enable": {params: Record<string, never>, result: Record<string, unknown>},
 *   "Runtime.evaluate": {
 *     params: {expression: string, awaitPromise?: boolean, returnByValue?: boolean},
 *     result: {
 *       result: {value?: unknown, objectId?: string},
 *       exceptionDetails?: {exception?: {description?: string}}
 *     }
 *   },
 *   "Runtime.callFunctionOn": {
 *     params: {
 *       functionDeclaration: string,
 *       objectId: string,
 *       arguments?: Array<{value: unknown}>,
 *       awaitPromise?: boolean,
 *       returnByValue?: boolean
 *     },
 *     result: {
 *       result: {value?: unknown},
 *       exceptionDetails?: {exception?: {description?: string}}
 *     }
 *   },
 *   "Target.createTarget": {params: {url: string}, result: {targetId: string}},
 *   "Target.closeTarget": {params: {targetId: string}, result: {success?: boolean}},
 *   "Target.getTargets": {
 *     params: {filter?: Array<{type: string}>},
 *     result: {targetInfos: Array<{targetId: string, type: string, url: string}>}
 *   },
 *   "Extensions.loadUnpacked": {
 *     params: {path: string, enableInIncognito?: boolean}, result: {id: string}
 *   },
 *   "Extensions.triggerAction": {
 *     params: {id: string, targetId: string}, result: Record<string, unknown>
 *   },
 *   "Emulation.setDeviceMetricsOverride": {
 *     params: {
 *       width: number, height: number, deviceScaleFactor: number, mobile: boolean,
 *       screenWidth: number, screenHeight: number
 *     },
 *     result: Record<string, unknown>
 *   },
 *   "Emulation.setDefaultBackgroundColorOverride": {
 *     params: {color: {r: number, g: number, b: number, a: number}},
 *     result: Record<string, unknown>
 *   },
 *   "Emulation.setEmulatedMedia": {
 *     params: {features: Array<{name: string, value: string}>},
 *     result: Record<string, unknown>
 *   },
 *   "Page.enable": {params: Record<string, never>, result: Record<string, unknown>},
 *   "Page.bringToFront": {params: Record<string, never>, result: Record<string, unknown>},
 *   "Page.reload": {params: {ignoreCache?: boolean}, result: Record<string, unknown>},
 *   "Page.handleJavaScriptDialog": {params: {accept: boolean}, result: Record<string, unknown>},
 *   "Page.captureScreenshot": {
 *     params: {
 *       format: "png", fromSurface: boolean, captureBeyondViewport: boolean
 *     },
 *     result: {data: string}
 *   },
 *   "Input.dispatchKeyEvent": {params: Record<string, unknown>, result: Record<string, unknown>},
 *   "Input.dispatchMouseEvent": {params: Record<string, unknown>, result: Record<string, unknown>}
 * }} CdpCommandMap
 */

// Live, append-only op trace. A hang cannot be captured after the fact: the
// failure artifact is written once the test has already given up, by which time
// the hung call still has not returned and so never appears. Tracing on ENTRY
// means the last unpaired "start" line names the call that hung. Off unless
// E2E_TRACE is set, so normal runs pay nothing.
const TRACE_PATH = process.env.E2E_TRACE || "";
let traceSeq = 0;
/** @param {string} op @param {Record<string, unknown>} [detail] */
const traceStart = (op, detail = {}) => {
  if (!TRACE_PATH) return () => {};
  const id = (traceSeq += 1);
  const startedAt = Date.now();
  const write = (/** @type {Record<string, unknown>} */ row) => {
    try {
      require("fs").appendFileSync(TRACE_PATH, `${JSON.stringify(row)}\n`);
    } catch {
      // Tracing must never change the outcome it is measuring.
    }
  };
  write({ id, phase: "start", op, t: startedAt, ...detail });
  return (/** @type {unknown} */ error) =>
    write({
      id,
      phase: error === undefined ? "ok" : "error",
      op,
      ms: Date.now() - startedAt,
      ...(error === undefined
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    });
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** @param {number} port @param {string} path @param {number} [timeoutMs] @returns {Promise<unknown>} */
const getJson = async (port, path, timeoutMs = 5000) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`CDP endpoint ${path} returned ${res.status} ${res.statusText}`.trim());
  }
  return res.json();
};

class Cdp {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    /** @type {Map<number, PendingCommand>} */
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      /** @type {unknown} */
      const parsed = JSON.parse(String(ev.data));
      if (process.env.CDP_DEBUG) console.error("CDP <-", ev.data);
      if (!isRecord(parsed) || typeof parsed.id !== "number") return;
      const pending = this.pending.get(parsed.id);
      if (pending) {
        const { resolve, reject } = pending;
        this.pending.delete(parsed.id);
        if (isRecord(parsed.error)) {
          reject(
            new Error(
              typeof parsed.error.message === "string" ? parsed.error.message : "CDP error",
            ),
          );
        } else {
          resolve(parsed.result);
        }
      }
    });
    ws.addEventListener("close", () => this.failPending(new Error("CDP connection closed")));
    ws.addEventListener("error", () => this.failPending(new Error("CDP connection failed")));
  }

  /** @param {unknown} error */
  failPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  /** @param {string} url @param {number} [timeoutMs] */
  static async connect(url, timeoutMs = 5000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to ${url}`));
      }, timeoutMs);
      /** @param {() => void} callback */
      const settle = (callback) => {
        clearTimeout(timer);
        callback();
      };
      ws.addEventListener("open", () => settle(() => resolve(undefined)), { once: true });
      ws.addEventListener(
        "error",
        () => settle(() => reject(new Error(`Failed to connect to ${url}`))),
        { once: true },
      );
    });
    return new Cdp(ws);
  }

  /**
   * @template {keyof CdpCommandMap} Method
   * @param {Method} method
   * @param {CdpCommandMap[Method]["params"]} [params]
   * @param {number} [timeoutMs]
   * @returns {Promise<CdpCommandMap[Method]["result"]>}
   */
  send(method, params, timeoutMs = 15000) {
    this.id += 1;
    const id = this.id;
    const message = JSON.stringify({ id, method, params: params ?? {} });
    if (process.env.CDP_DEBUG) console.error("CDP ->", message);
    const traceEnd = traceStart(`send:${method}`, { timeoutMs });
    /** @type {Promise<CdpCommandMap[Method]["result"]>} */
    const command = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(/** @type {CdpCommandMap[Method]["result"]} */ (value));
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.ws.send(message);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
    return command.then(
      (value) => {
        traceEnd(undefined);
        return value;
      },
      (error) => {
        traceEnd(error);
        throw error;
      },
    );
  }

  close() {
    this.failPending(new Error("CDP connection closed"));
    this.ws.close();
  }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<T>}
 */
const retryUntil = async (operation, timeoutMs, message) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(message, { cause: error });
      await nextTurn();
    }
  }
};

/** @param {number} port */
const connectBrowser = (port) =>
  retryUntil(
    async () => {
      // Refresh the browser endpoint on every attempt; Chrome can replace it
      // while finishing startup.
      const version = await getJson(port, "/json/version");
      if (!isRecord(version) || typeof version.webSocketDebuggerUrl !== "string") {
        throw new Error("CDP version endpoint did not include a WebSocket debugger URL");
      }
      return await Cdp.connect(version.webSocketDebuggerUrl);
    },
    5000,
    "CDP connection failed",
  );

/** @param {unknown} value @returns {value is CdpTarget} */
const isCdpTarget = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.type === "string" &&
  typeof value.url === "string" &&
  typeof value.webSocketDebuggerUrl === "string";

/** @param {number} port @returns {Promise<CdpTarget[]>} */
const listTargets = async (port) => {
  const targets = await getJson(port, "/json");
  if (!Array.isArray(targets) || !targets.every(isCdpTarget)) {
    throw new Error("CDP target endpoint returned an invalid target list");
  }
  return targets;
};

/** @param {CdpTarget[]} targets @param {string} [expectedResource] */
const extensionIdFromTargets = (targets, expectedResource = "background.sw.js") => {
  for (const target of targets) {
    if (target.type !== "service_worker") continue;
    const match = target.url.match(
      new RegExp(
        `^chrome-extension://([a-p]{32})/${expectedResource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#]|$)`,
      ),
    );
    if (match?.[1]) return match[1];
  }
  return undefined;
};

/** @param {number} port */
const waitForExtensionId = (port) =>
  retryUntil(
    async () => {
      const extensionId = extensionIdFromTargets(await listTargets(port));
      if (!extensionId) throw new Error("extension target is not available");
      return extensionId;
    },
    15000,
    "Chrome did not expose the unpacked extension background target",
  );

// Evaluates an expression in the first live target whose URL contains
// urlSubstr. Skips targets whose extension context has been invalidated.
/** @param {number} port @param {string} urlSubstr @param {string} expression @returns {Promise<any>} */
const evalInTarget = async (port, urlSubstr, expression) => {
  let lastError = null;
  // A missing target or a dead endpoint is transient: the options page drops
  // out of the target list momentarily across a reload or a service-worker
  // respawn, and the old fixed three setImmediate retries could all fall inside
  // that gap (this is what evalOptions lacked and the control transport gets
  // from its recovery). Wait those out to a deadline. A genuine evaluation
  // exception is not transient, so cap those separately and surface them fast.
  const deadline = Date.now() + 10000;
  let evalExceptions = 0;
  for (;;) {
    const targets = (await listTargets(port)).filter((t) => t.url.includes(urlSubstr));
    if (targets.length === 0) lastError = new Error(`No target matching "${urlSubstr}"`);
    for (const target of targets) {
      /** @type {Cdp | undefined} */
      let cdp;
      try {
        cdp = await Cdp.connect(target.webSocketDebuggerUrl);
        const result = await cdp.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (!result.exceptionDetails) {
          return result.result.value;
        }
        evalExceptions += 1;
        lastError = new Error(
          result.exceptionDetails.exception?.description || "evaluation failed",
        );
      } catch (error) {
        // A connect/transport failure is the dead-endpoint case, not the page's
        // own error; keep waiting for a fresh target rather than counting it.
        lastError = error;
      } finally {
        cdp?.close();
      }
    }
    if (evalExceptions >= 3 || Date.now() >= deadline) throw lastError;
    await nextTurn();
  }
};

/**
 * Calls a function in a page target with structured arguments. The only
 * evaluated expression is the fixed global-object bootstrap required by CDP;
 * callers do not interpolate data or executable expressions.
 *
 * @param {number} port
 * @param {string} urlSubstr
 * @param {string} functionDeclaration
 * @param {unknown[]} [args]
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>}
 */
const callFunctionInTarget = async (
  port,
  urlSubstr,
  functionDeclaration,
  args = [],
  timeoutMs = 15000,
) => {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const targets = (await listTargets(port)).filter((target) => target.url.includes(urlSubstr));
    // Worst case here is 3 attempts x (connect + evaluate + callFunctionOn),
    // which outruns the 90s test timeout — so which attempt stalled, and how
    // many targets it could see, is the whole question when one of these hangs.
    traceStart(`callFunctionInTarget:attempt`, {
      attempt,
      urlSubstr,
      targets: targets.length,
      allTargets: (await listTargets(port)).map((t) => `${t.type}:${t.url.slice(0, 60)}`),
    })(undefined);
    if (targets.length === 0) {
      lastError = Object.assign(new Error(`No target matching "${urlSubstr}"`), {
        code: "E2E_CONTROL_TARGET_MISSING",
      });
    }
    for (const target of targets) {
      /** @type {Cdp | undefined} */
      let client;
      /** @type {string | undefined} */
      let objectId;
      try {
        client = await Cdp.connect(target.webSocketDebuggerUrl);
        const root = await client.send("Runtime.evaluate", { expression: "globalThis" }, timeoutMs);
        objectId = root.result.objectId;
        if (!objectId) throw new Error("CDP did not return the page global object");
      } catch (error) {
        lastError = error;
        client?.close();
        continue;
      }

      try {
        // Do not retry after dispatch. A timeout or disconnect can happen after
        // the browser completed a side effect, so repeating the call could
        // create a second download/tab or apply a mutation twice.
        const result = await client.send(
          "Runtime.callFunctionOn",
          {
            functionDeclaration,
            objectId,
            arguments: args.map((value) => ({ value: JSON.stringify(value) })),
            awaitPromise: true,
            returnByValue: true,
          },
          timeoutMs,
        );
        if (!result.exceptionDetails) return result.result.value;
        throw new Error(result.exceptionDetails.exception?.description || "function call failed");
      } finally {
        client.close();
      }
    }
    if (attempt < 2) await nextTurn();
  }
  throw lastError;
};

// The MV3 service worker disappears from the target list when idle:
// wake it via an extension page first, then attach quickly.
/** @param {number} port @param {string} extensionId @param {string} expression @returns {Promise<any>} */
const evalInServiceWorker = async (port, extensionId, expression) => {
  await evalInTarget(
    port,
    `${extensionId}/src/options/options.html`,
    "new Promise(res => chrome.runtime.sendMessage({type:'WAKE_WARM'}, () => res('ok')))",
  );

  const sw = (await listTargets(port)).find(
    (t) => t.type === "service_worker" && t.url.includes(extensionId),
  );
  if (!sw) {
    throw new Error("Service worker did not wake up");
  }

  const cdp = await Cdp.connect(sw.webSocketDebuggerUrl);
  try {
    await cdp.send("Runtime.enable");
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluation failed");
    }
    return result.result.value;
  } finally {
    cdp.close();
  }
};

// Dispatches trusted input events (Input domain) to the first target whose
// URL contains urlSubstr. Synthetic DOM events don't carry legacy fields
// like keyCode across content-script world boundaries; real input does.
/**
 * @typedef {"Input.dispatchKeyEvent" | "Input.dispatchMouseEvent"} InputCommand
 * @typedef {{
 *   [Method in InputCommand]: {
 *     method: Method,
 *     params: CdpCommandMap[Method]["params"]
 *   }
 * }[InputCommand]} InputEvent
 */
/** @param {number} port @param {string} urlSubstr @param {InputEvent[]} events */
const dispatchInput = async (port, urlSubstr, events) => {
  const target = (await listTargets(port)).find((t) => t.url.includes(urlSubstr));
  if (!target) {
    throw new Error(`No target matching "${urlSubstr}"`);
  }
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    for (const { method, params } of events) {
      await cdp.send(method, params);
    }
  } finally {
    cdp.close();
  }
};

/** @param {number} port @param {string} url */
const openTab = async (port, url) => {
  const browser = await connectBrowser(port);
  try {
    return await browser.send("Target.createTarget", { url });
  } finally {
    browser.close();
  }
};

/** @param {number} port @param {string} urlSubstr @param {string} url */
const replaceTab = async (port, urlSubstr, url) => {
  const targets = (await listTargets(port)).filter(
    (target) => target.type === "page" && target.url.includes(urlSubstr),
  );
  const browser = await connectBrowser(port);
  try {
    for (const target of targets) {
      await browser.send("Target.closeTarget", { targetId: target.id });
    }
    return await browser.send("Target.createTarget", { url });
  } finally {
    browser.close();
  }
};

/** @param {number} port @param {string} urlSubstr @param {number} width @param {number} height */
const setViewport = async (port, urlSubstr, width, height) => {
  const target = (await listTargets(port)).find(
    (candidate) => candidate.type === "page" && candidate.url.includes(urlSubstr),
  );
  if (!target) throw new Error(`No page target matching "${urlSubstr}"`);
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
  } finally {
    page.close();
  }
};

/**
 * @param {number} port
 * @param {string} urlSubstr
 * @param {{width?: number, height?: number, deviceScaleFactor?: number, fromSurface?: boolean}} [options]
 */
const captureScreenshot = async (port, urlSubstr, options = {}) => {
  const { width, height, deviceScaleFactor = 1, fromSurface = true } = options;
  const target = (await listTargets(port)).find(
    (candidate) => candidate.type === "page" && candidate.url.includes(urlSubstr),
  );
  if (!target) throw new Error(`No page target matching "${urlSubstr}"`);
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await page.send("Page.enable");
    await page.send("Page.bringToFront");
    if (width && height) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
    }
    await page.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 255, g: 255, b: 255, a: 1 },
    });
    await page.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
    await page.send("Runtime.evaluate", {
      // The second animation frame runs after Chrome had a rendering
      // opportunity for the first, avoiding partially black foreground tiles.
      expression:
        "document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
      awaitPromise: true,
    });
    const { data } = await page.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface,
        captureBeyondViewport: false,
      },
      5000,
    );
    return data;
  } finally {
    page.close();
  }
};

/**
 * @param {number} port
 * @param {string} path
 * @param {{enableInIncognito?: boolean}} [options]
 */
const loadUnpacked = async (port, path, options = {}) => {
  const browser = await connectBrowser(port);
  try {
    const { id } = await browser.send("Extensions.loadUnpacked", { path, ...options });
    return id;
  } finally {
    browser.close();
  }
};

/** @param {number} port @param {string} extensionId @param {string} urlSubstr */
const triggerAction = async (port, extensionId, urlSubstr) => {
  const browser = await connectBrowser(port);
  try {
    const { targetInfos } = await browser.send("Target.getTargets", {
      filter: [{ type: "tab" }],
    });
    const target = targetInfos.find((candidate) => candidate.url.includes(urlSubstr));
    if (!target) throw new Error(`No tab target matching "${urlSubstr}"`);
    await browser.send("Extensions.triggerAction", {
      id: extensionId,
      targetId: target.targetId,
    });
  } finally {
    browser.close();
  }
};

/** @param {number} port @param {string} extensionId */
const stopServiceWorker = async (port, extensionId) => {
  const target = (await listTargets(port)).find(
    (candidate) => candidate.type === "service_worker" && candidate.url.includes(extensionId),
  );
  if (!target) return false;
  const browser = await connectBrowser(port);
  try {
    const result = await browser.send("Target.closeTarget", { targetId: target.id });
    return result.success !== false;
  } finally {
    browser.close();
  }
};

// Reloads every open page target whose URL contains urlSubstr, in place
// (so a reloaded unpacked extension is picked up without opening a new
// tab). Returns how many were reloaded.

// A reload runs the page's beforeunload handlers, and the options page guards
// unsaved edits with one. Headless Chrome only dismisses the resulting modal by
// itself while no client owns the Page domain: enabling it — as the screenshot
// path already does — makes the dialog this client's to answer, and an
// unanswered one blocks the renderer, so every later Runtime.evaluate on the
// target times out with the page still listed and CDP still healthy. Answer the
// dialog rather than avoid Page.enable: whether some other caller has enabled it
// is not something a reload can know, and a reload that can deadlock the whole
// browser is not worth the coupling. Accepting matches the reload the caller
// asked for; a scenario that needs the edits kept has to save them first.
/** @param {Cdp} connection */
const acceptDialogs = (connection) => {
  connection.ws.addEventListener("message", (ev) => {
    /** @type {unknown} */
    const parsed = JSON.parse(String(ev.data));
    if (!isRecord(parsed) || parsed.method !== "Page.javascriptDialogOpening") return;
    void connection.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
};

/** @param {number} port @param {string} urlSubstr */
const reloadTargets = async (port, urlSubstr) => {
  const targets = (await listTargets(port)).filter(
    (t) => t.type === "page" && t.url.includes(urlSubstr),
  );
  let count = 0;
  for (const t of targets) {
    const c = await Cdp.connect(t.webSocketDebuggerUrl);
    try {
      await c.send("Page.enable");
      acceptDialogs(c);
      await c.send("Page.reload", { ignoreCache: true });
      count += 1;
    } finally {
      c.close();
    }
  }
  return count;
};

/** @param {number} port */
const waitForCdp = (port) =>
  retryUntil(
    async () => {
      await getJson(port, "/json/version");
    },
    15000,
    `Chrome did not open CDP port ${port}`,
  );

module.exports = {
  Cdp,
  getJson,
  connectBrowser,
  extensionIdFromTargets,
  listTargets,
  callFunctionInTarget,
  evalInTarget,
  evalInServiceWorker,
  dispatchInput,
  openTab,
  replaceTab,
  setViewport,
  captureScreenshot,
  loadUnpacked,
  triggerAction,
  stopServiceWorker,
  reloadTargets,
  waitForCdp,
  waitForExtensionId,
};
