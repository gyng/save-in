// Minimal Chrome DevTools Protocol client (no dependencies, Node >= 22 for
// the global WebSocket). Used by dev-chrome.js and e2e-chrome.js.

const getJson = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.json();
};

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "CDP error"));
        else resolve(msg.result);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error(`Failed to connect to ${url}`)));
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 15000) {
    this.id += 1;
    const id = this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeoutMs).unref();
    });
  }

  close() {
    this.ws.close();
  }
}

const connectBrowser = async (port) => {
  const version = await getJson(port, "/json/version");
  return Cdp.connect(version.webSocketDebuggerUrl);
};

const listTargets = (port) => getJson(port, "/json");

// Evaluates an expression in the first live target whose URL contains
// urlSubstr. Skips targets whose extension context has been invalidated.
const evalInTarget = async (port, urlSubstr, expression) => {
  const targets = (await listTargets(port)).filter((t) => t.url.includes(urlSubstr));
  if (targets.length === 0) {
    throw new Error(`No target matching "${urlSubstr}"`);
  }

  let lastError = null;
  for (const target of targets) {
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    try {
      await cdp.send("Runtime.enable");
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (!result.exceptionDetails) {
        return result.result.value;
      }
      lastError = new Error(result.exceptionDetails.exception?.description || "evaluation failed");
    } finally {
      cdp.close();
    }
  }
  throw lastError;
};

// The MV3 service worker disappears from the target list when idle:
// wake it via an extension page first, then attach quickly.
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
const dispatchInput = async (port, urlSubstr, events) => {
  const target = (await listTargets(port)).find((t) => t.url.includes(urlSubstr));
  if (!target) {
    throw new Error(`No target matching "${urlSubstr}"`);
  }
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    for (const { method, params } of events) {
      // eslint-disable-next-line no-await-in-loop
      await cdp.send(method, params);
    }
  } finally {
    cdp.close();
  }
};

const openTab = async (port, url) => {
  const browser = await connectBrowser(port);
  try {
    return await browser.send("Target.createTarget", { url });
  } finally {
    browser.close();
  }
};

const loadUnpacked = async (port, path) => {
  const browser = await connectBrowser(port);
  try {
    const { id } = await browser.send("Extensions.loadUnpacked", { path });
    return id;
  } finally {
    browser.close();
  }
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

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
  connectBrowser,
  listTargets,
  evalInTarget,
  evalInServiceWorker,
  dispatchInput,
  openTab,
  loadUnpacked,
  sleep,
  waitForCdp,
};
