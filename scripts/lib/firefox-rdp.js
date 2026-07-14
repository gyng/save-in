// @ts-check

// Minimal Firefox Remote Debugging Protocol client (the protocol behind
// about:debugging and web-ext). Packets are `<byteLength>:<json>` over TCP.
// Responses carry no request IDs: requests to one actor are answered in
// order, so replies are matched with a per-actor FIFO. Async console
// evaluation results arrive as separate typed packets.

const net = require("net");

/** @typedef {Record<string, unknown>} RdpPacket */
/**
 * @typedef {object} EventWaiter
 * @property {(packet: RdpPacket) => boolean} predicate
 * @property {(packet?: RdpPacket) => void} resolve
 * @property {() => void} [cancel]
 */
/**
 * @typedef {object} PendingRequest
 * @property {boolean} settled
 * @property {(packet?: RdpPacket) => void} resolve
 * @property {(error: unknown) => void} reject
 * @property {() => void} cancel
 * @property {NodeJS.Timeout} [timer]
 */

const EVENT_TYPES = new Set([
  "evaluationResult",
  "addonListChanged",
  "tabListChanged",
  "workerListChanged",
  "frameUpdate",
  "newSource",
  "resources-available-array",
  "target-available-form",
]);

/** @param {unknown} value @returns {value is RdpPacket} */
const isRdpPacket = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** @param {RdpPacket | undefined} packet @param {string} operation @returns {RdpPacket} */
const requirePacket = (packet, operation) => {
  if (!packet) throw new Error(`${operation} was cancelled`);
  return packet;
};

/** @param {RdpPacket} packet @param {string} key @param {string} operation */
const requireString = (packet, key, operation) => {
  const value = packet[key];
  if (typeof value !== "string") throw new Error(`${operation} did not return ${key}`);
  return value;
};

class FirefoxRdp {
  /** @param {import("net").Socket} socket */
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    /** @type {Map<string, PendingRequest[]>} */
    this.queues = new Map();
    /** @type {EventWaiter[]} */
    this.eventWaiters = [];
    /** @type {RdpPacket[]} */
    this.eventBacklog = [];
    /** @type {Map<string, string>} */
    this.tabConsoleActors = new Map();
    socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
      this.drain();
    });
  }

  /**
   * @param {number} port
   * @param {string} [host]
   * @returns {Promise<FirefoxRdp>}
   */
  static connect(port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host);
      const client = new FirefoxRdp(socket);
      let done = false;
      // A failed attempt (socket error, or no greeting) must settle the pending
      // greeting waiter — otherwise its unref'd timeout rejects unhandled ~30s
      // later. connectWithRetry makes several attempts before Firefox opens the
      // RDP port, so those orphaned timers are the "exit 1 despite passing"
      // artifact.
      /** @param {unknown} e */
      const fail = (e) => {
        if (done) return;
        done = true;
        client.close();
        reject(e);
      };
      socket.on("error", fail);
      // The root actor greets us on connect
      client
        .waitForEvent((p) => p.from === "root")
        .then((greeting) => {
          if (done || !greeting) return;
          done = true;
          resolve(client);
        }, fail);
    });
  }

  drain() {
    for (;;) {
      const sep = this.buffer.indexOf(0x3a); // ":"
      if (sep === -1) return;
      const length = parseInt(this.buffer.slice(0, sep).toString(), 10);
      if (Number.isNaN(length)) throw new Error("Bad RDP framing");
      if (this.buffer.length < sep + 1 + length) return;
      const json = this.buffer.slice(sep + 1, sep + 1 + length).toString();
      this.buffer = this.buffer.slice(sep + 1 + length);
      /** @type {unknown} */
      const parsed = JSON.parse(json);
      if (!isRdpPacket(parsed)) throw new Error("RDP packet must be an object");
      this.dispatch(parsed);
    }
  }

  /** @param {RdpPacket} packet */
  dispatch(packet) {
    if (process.env.RDP_DEBUG) console.error("RDP <-", JSON.stringify(packet));
    const waiterIdx = this.eventWaiters.findIndex((w) => w.predicate(packet));
    if (waiterIdx !== -1) {
      const waiter = this.eventWaiters.splice(waiterIdx, 1)[0];
      if (!waiter) throw new Error("RDP waiter disappeared during dispatch");
      waiter.resolve(packet);
      return;
    }

    if (packet.type === "evaluationResult") {
      // evaluateJSAsync can emit evaluationResult before its request reply is
      // handled and the resultID-specific waiter is registered. Retain a small
      // bounded backlog so that legitimate ordering does not become a 30s
      // timeout while still preventing unsolicited protocol events growing
      // without bound.
      this.eventBacklog.push(packet);
      if (this.eventBacklog.length > 100) this.eventBacklog.shift();
      return;
    }

    // Other lifecycle events only describe the instant at which they arrive.
    // Retaining them lets a later operation consume stale state as if it were
    // a fresh browser event.
    if (typeof packet.type === "string" && EVENT_TYPES.has(packet.type)) return;

    const queue = typeof packet.from === "string" ? this.queues.get(packet.from) : undefined;
    if (queue && queue.length > 0) {
      // Skip entries already settled by a timeout: leaving them in the queue
      // would desync every later reply for this actor
      let pending = queue.shift();
      while (pending && pending.settled) {
        pending = queue.shift();
      }
      if (!pending) return;
      pending.settled = true;
      if (typeof packet.error === "string") {
        pending.reject(
          new Error(`${packet.error}: ${typeof packet.message === "string" ? packet.message : ""}`),
        );
      } else {
        pending.resolve(packet);
      }
    }
  }

  /**
   * @param {(packet: RdpPacket) => boolean} predicate
   * @param {number} [timeoutMs]
   * @returns {Promise<RdpPacket | undefined>}
   */
  waitForEvent(predicate, timeoutMs = 30000) {
    const backlogIndex = this.eventBacklog.findIndex(predicate);
    if (backlogIndex !== -1) {
      const [packet] = this.eventBacklog.splice(backlogIndex, 1);
      return Promise.resolve(packet);
    }
    return new Promise((resolve, reject) => {
      /** @type {EventWaiter} */
      const waiter = { predicate, resolve: () => {} };
      const timer = setTimeout(() => {
        // Drop the waiter so it can't leak, then reject
        this.eventWaiters = this.eventWaiters.filter((w) => w !== waiter);
        reject(new Error("RDP event timeout"));
      }, timeoutMs);
      timer.unref();
      // dispatch() calls resolve on a match; clearing the timeout stops it from
      // firing after the promise settled — an unref'd timer rejecting after the
      // suite finished is the "exit 1 despite passing" artifact
      waiter.resolve = (packet) => {
        clearTimeout(timer);
        resolve(packet);
      };
      // close() calls this to settle a still-pending waiter without rejecting
      waiter.cancel = () => {
        clearTimeout(timer);
        resolve(undefined);
      };
      this.eventWaiters.push(waiter);
    });
  }

  /**
   * @param {RdpPacket & {to: string, type: string}} packet
   * @param {number} [timeoutMs]
   * @returns {Promise<RdpPacket | undefined>}
   */
  request(packet, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(packet.to)) this.queues.set(packet.to, []);
      // The entry stays in the queue on timeout but is flagged settled, so
      // dispatch() skips it instead of matching a later reply to it
      /** @type {PendingRequest} */
      const entry = {
        settled: false,
        resolve: () => {},
        reject: () => {},
        cancel: () => {},
      };
      entry.resolve = (p) => {
        if (entry.timer) clearTimeout(entry.timer);
        resolve(p);
      };
      entry.reject = (e) => {
        if (entry.timer) clearTimeout(entry.timer);
        reject(e);
      };
      // close() settles a still-pending request without rejecting
      entry.cancel = () => {
        if (entry.timer) clearTimeout(entry.timer);
        resolve(undefined);
      };
      this.queues.get(packet.to)?.push(entry);
      const json = JSON.stringify(packet);
      if (process.env.RDP_DEBUG) console.error("RDP ->", json);
      this.socket.write(`${Buffer.byteLength(json)}:${json}`);
      entry.timer = setTimeout(() => {
        if (!entry.settled) {
          entry.settled = true;
          reject(new Error(`RDP timeout: ${packet.type}`));
        }
      }, timeoutMs);
      entry.timer.unref();
    });
  }

  async getRoot() {
    const root = requirePacket(await this.request({ to: "root", type: "getRoot" }), "getRoot");
    const addonsActor = requireString(root, "addonsActor", "getRoot");
    return { ...root, addonsActor };
  }

  /** @param {string} addonsActor @param {string} addonPath */
  async installTemporaryAddon(addonsActor, addonPath) {
    return requirePacket(
      await this.request({ to: addonsActor, type: "installTemporaryAddon", addonPath }, 60000),
      "installTemporaryAddon",
    );
  }

  /** @param {string} addonId */
  async findAddonActor(addonId) {
    const response = requirePacket(
      await this.request({ to: "root", type: "listAddons" }),
      "listAddons",
    );
    const addons = Array.isArray(response.addons) ? response.addons.filter(isRdpPacket) : [];
    const addon = addons.find((candidate) => candidate.id === addonId);
    if (!addon) throw new Error(`Addon ${addonId} not in listAddons`);
    return requireString(addon, "actor", "listAddons");
  }

  /** @param {string} addonId */
  async reloadAddon(addonId) {
    const actor = await this.findAddonActor(addonId);
    const supported = requirePacket(
      await this.request({ to: actor, type: "requestTypes" }),
      "requestTypes",
    );
    if (!Array.isArray(supported.requestTypes) || !supported.requestTypes.includes("reload")) {
      throw new Error("Firefox add-on actor does not support reload");
    }
    requirePacket(await this.request({ to: actor, type: "reload" }, 60000), "reload");
    this.tabConsoleActors.clear();
  }

  // Finds the frame target a descriptor actor (addon or tab) exposes.
  // Firefox < 129 answers getTarget directly; >= 129 needs a watcher and
  // emits target-available-form events.
  /**
   * @param {string} descriptorActor
   * @param {(target: RdpPacket) => boolean} matches
   */
  async watchFrameTarget(descriptorActor, matches) {
    try {
      const response = requirePacket(
        await this.request({ to: descriptorActor, type: "getTarget" }),
        "getTarget",
      );
      // The legacy descriptor API returns its single definitive target, so no
      // watcher-side disambiguation is needed on Firefox 121–128.
      if (isRdpPacket(response.form) && typeof response.form.consoleActor === "string") {
        return response.form;
      }
    } catch (e) {
      if (!String(e instanceof Error ? e.message : e).includes("unrecognizedPacketType")) throw e;
    }

    const watcherResponse = requirePacket(
      await this.request({
        to: descriptorActor,
        type: "getWatcher",
        isServerTargetSwitchingEnabled: true,
      }),
      "getWatcher",
    );
    const watcher = requireString(watcherResponse, "actor", "getWatcher");

    // Register before watchTargets: Firefox may announce the target before it
    // acknowledges the request. The timeout remains a failure bound, not a
    // mandatory collection delay on every fresh document.
    const targetEvent = this.waitForEvent(
      (packet) =>
        packet.type === "target-available-form" &&
        packet.from === watcher &&
        isRdpPacket(packet.target) &&
        matches(packet.target),
      2000,
    );
    const [, packet] = await Promise.all([
      this.request({ to: watcher, type: "watchTargets", targetType: "frame" }),
      targetEvent,
    ]);
    const event = requirePacket(packet, "watchTargets");
    if (!isRdpPacket(event.target)) throw new Error("watchTargets did not return a target");
    return event.target;
  }

  /** @param {string} addonActor */
  async getConsoleActor(addonActor) {
    const target = await this.watchFrameTarget(
      addonActor,
      (candidate) =>
        typeof candidate.url === "string" &&
        candidate.url.includes("_generated_background_page") &&
        typeof candidate.consoleActor === "string",
    );
    if (typeof target.consoleActor !== "string") throw new Error("No background target found");
    return target.consoleActor;
  }

  // Console actor for an open browser tab whose URL contains urlSubstr.
  // Evaluations run in the page's content window (not the extension sandbox),
  // so they see the real DOM but not content-script variables.
  /** @param {string} urlSubstr */
  async getTabConsoleActor(urlSubstr) {
    const response = requirePacket(
      await this.request({ to: "root", type: "listTabs" }),
      "listTabs",
    );
    const tabs = Array.isArray(response.tabs) ? response.tabs.filter(isRdpPacket) : [];
    const tab = tabs.find(
      (candidate) => typeof candidate.url === "string" && candidate.url.includes(urlSubstr),
    );
    if (!tab) {
      throw new Error(
        `No tab matching "${urlSubstr}" (saw: ${tabs.map((candidate) => String(candidate.url || "")).join(", ")})`,
      );
    }
    const tabActor = requireString(tab, "actor", "listTabs");

    const cached = this.tabConsoleActors.get(tabActor);
    if (cached) return cached;

    const target = await this.watchFrameTarget(
      tabActor,
      (candidate) =>
        typeof candidate.url === "string" &&
        candidate.url.includes(urlSubstr) &&
        typeof candidate.consoleActor === "string",
    );
    if (typeof target.consoleActor !== "string") {
      throw new Error(`No console actor for tab "${urlSubstr}"`);
    }
    this.tabConsoleActors.set(tabActor, target.consoleActor);
    return target.consoleActor;
  }

  // Evaluates in the extension background context; returns the string value.
  // Wrap complex results with JSON.stringify inside the expression. The
  // expression is wrapped in a top-level await so promises resolve to values
  // (the console actor maps await inputs to async evaluation).
  /**
   * @param {string} consoleActor
   * @param {string} text
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  async evaluate(consoleActor, text, timeoutMs = 30000) {
    const request = requirePacket(
      await this.request({
        to: consoleActor,
        type: "evaluateJSAsync",
        text: `(async () => (${text}))()`,
        mapped: { await: true },
      }),
      "evaluateJSAsync",
    );
    const resultID = requireString(request, "resultID", "evaluateJSAsync");
    const result = await this.waitForEvent(
      (p) => p.type === "evaluationResult" && p.resultID === resultID,
      timeoutMs,
    );
    if (!result) throw new Error("Evaluation cancelled");
    if (typeof result.exceptionMessage === "string") {
      throw new Error(`Evaluation failed: ${result.exceptionMessage}`);
    }
    let value = result.result;
    if (isRdpPacket(value) && value.type === "longString") {
      const initial = typeof value.initial === "string" ? value.initial : "";
      const length = typeof value.length === "number" ? value.length : initial.length;
      if (typeof value.actor !== "string" || length <= initial.length) {
        value = initial;
      } else {
        const remainder = requirePacket(
          await this.request(
            {
              to: value.actor,
              type: "substring",
              start: initial.length,
              end: length,
            },
            timeoutMs,
          ),
          "substring",
        );
        value = initial + (typeof remainder.substring === "string" ? remainder.substring : "");
      }
    }
    return value;
  }

  close() {
    // Settle anything still pending so its unref'd timeout can't reject after
    // teardown (the "exit 1 despite passing" artifact)
    for (const waiter of this.eventWaiters) {
      if (waiter.cancel) waiter.cancel();
    }
    this.eventWaiters = [];
    this.eventBacklog = [];
    for (const queue of this.queues.values()) {
      for (const entry of queue) {
        if (!entry.settled && entry.cancel) {
          entry.settled = true;
          entry.cancel();
        }
      }
    }
    this.queues.clear();
    this.socket.destroy();
  }
}

module.exports = { FirefoxRdp };
