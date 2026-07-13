// Minimal Chrome DevTools Protocol client (no dependencies, Node >= 22 for
// the global WebSocket). Used by dev-chrome.js and e2e-chrome.js.

/** @typedef {{id?: number, type: string, url: string, webSocketDebuggerUrl: string}} CdpTarget */
/** @typedef {{resolve: (value: any) => void, reject: (error: unknown) => void}} PendingCommand */

/** @param {number} port @param {string} path @param {number} [timeoutMs] @returns {Promise<any>} */
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
      const msg = JSON.parse(String(ev.data));
      if (process.env.CDP_DEBUG) console.error("CDP <-", ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        const { resolve, reject } = pending;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "CDP error"));
        else resolve(msg.result);
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

  /** @param {string} method @param {Record<string, any>} [params] @param {number} [timeoutMs] @returns {Promise<any>} */
  send(method, params = {}, timeoutMs = 15000) {
    this.id += 1;
    const id = this.id;
    const message = JSON.stringify({ id, method, params });
    if (process.env.CDP_DEBUG) console.error("CDP ->", message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
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
  }

  close() {
    this.failPending(new Error("CDP connection closed"));
    this.ws.close();
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** @param {number} port @param {number} [attempts] */
const connectBrowser = async (port, attempts = 5) => {
  /** @type {unknown} */
  let lastError = new Error("CDP connection failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // Refresh the browser endpoint on every attempt; Chrome can replace it
      // while finishing startup.
      const version = await getJson(port, "/json/version");
      return await Cdp.connect(version.webSocketDebuggerUrl);
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw lastError;
};

/** @param {number} port @returns {Promise<CdpTarget[]>} */
const listTargets = (port) => getJson(port, "/json");

// Evaluates an expression in the first live target whose URL contains
// urlSubstr. Skips targets whose extension context has been invalidated.
/** @param {number} port @param {string} urlSubstr @param {string} expression @returns {Promise<any>} */
const evalInTarget = async (port, urlSubstr, expression) => {
  const targets = (await listTargets(port)).filter((t) => t.url.includes(urlSubstr));
  if (targets.length === 0) {
    throw new Error(`No target matching "${urlSubstr}"`);
  }

  let lastError = null;
  for (const target of targets) {
    /** @type {Cdp | undefined} */
    let cdp;
    try {
      cdp = await Cdp.connect(target.webSocketDebuggerUrl);
      await cdp.send("Runtime.enable", {}, 3000);
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (!result.exceptionDetails) {
        return result.result.value;
      }
      lastError = new Error(result.exceptionDetails.exception?.description || "evaluation failed");
    } catch (error) {
      lastError = error;
    } finally {
      cdp?.close();
    }
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
/** @param {number} port @param {string} urlSubstr @param {Array<{method: string, params: Record<string, any>}>} events */
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
      // rAF runs before paint. The short timer lets Chrome commit that frame so
      // a newly foregrounded tab cannot produce partially black tiles.
      expression:
        "document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))))",
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

/** @param {number} port @param {string} path */
const loadUnpacked = async (port, path) => {
  const browser = await connectBrowser(port);
  try {
    const { id } = await browser.send("Extensions.loadUnpacked", { path });
    return id;
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
      await c.send("Page.reload", { ignoreCache: true });
      count += 1;
    } finally {
      c.close();
    }
  }
  return count;
};

/** @param {number} port @param {number} [attempts] */
const waitForCdp = async (port, attempts = 30) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await getJson(port, "/json/version");
      return;
    } catch (e) {
      await sleep(500);
    }
  }
  throw new Error(`Chrome did not open CDP port ${port}`);
};

module.exports = {
  Cdp,
  getJson,
  connectBrowser,
  listTargets,
  evalInTarget,
  evalInServiceWorker,
  dispatchInput,
  openTab,
  captureScreenshot,
  loadUnpacked,
  stopServiceWorker,
  reloadTargets,
  sleep,
  waitForCdp,
};
