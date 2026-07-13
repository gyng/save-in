// Minimal Firefox Remote Debugging Protocol client (the protocol behind
// about:debugging and web-ext). Packets are `<byteLength>:<json>` over TCP.
// Responses carry no request IDs: requests to one actor are answered in
// order, so replies are matched with a per-actor FIFO. Async console
// evaluation results arrive as separate typed packets.

const net = require("net");

/** @typedef {Record<string, any>} RdpPacket */
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
      this.dispatch(JSON.parse(json));
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
    if (EVENT_TYPES.has(packet.type)) return;

    const queue = this.queues.get(packet.from);
    if (queue && queue.length > 0) {
      // Skip entries already settled by a timeout: leaving them in the queue
      // would desync every later reply for this actor
      let pending = queue.shift();
      while (pending && pending.settled) {
        pending = queue.shift();
      }
      if (!pending) return;
      pending.settled = true;
      if (packet.error) {
        pending.reject(new Error(`${packet.error}: ${packet.message || ""}`));
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
   * @returns {Promise<any>}
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
    return this.request({ to: "root", type: "getRoot" });
  }

  /** @param {string} addonsActor @param {string} addonPath */
  async installTemporaryAddon(addonsActor, addonPath) {
    return this.request({ to: addonsActor, type: "installTemporaryAddon", addonPath }, 60000);
  }

  /** @param {string} addonId */
  async findAddonActor(addonId) {
    const { addons } = await this.request({ to: "root", type: "listAddons" });
    const addon = addons.find(/** @param {RdpPacket} a */ (a) => a.id === addonId);
    if (!addon) throw new Error(`Addon ${addonId} not in listAddons`);
    return addon.actor;
  }

  // Collects the frame targets a descriptor actor (addon or tab) exposes.
  // Firefox < 129 answers getTarget directly; >= 129 needs a watcher and
  // emits target-available-form events.
  /** @param {string} descriptorActor */
  async watchFrameTargets(descriptorActor) {
    try {
      const { form } = await this.request({ to: descriptorActor, type: "getTarget" });
      if (form && form.consoleActor) return [form];
    } catch (e) {
      if (!String(e instanceof Error ? e.message : e).includes("unrecognizedPacketType")) throw e;
    }

    const { actor: watcher } = await this.request({
      to: descriptorActor,
      type: "getWatcher",
      isServerTargetSwitchingEnabled: true,
    });

    /** @type {RdpPacket[]} */
    const targets = [];
    // A short-lived collector: matches target-available-form events for this
    // watcher, then deregisters after the collection window so it can't keep
    // intercepting events from tabs opened by later tests
    let collecting = true;
    /** @param {RdpPacket} p */
    const collector = (p) => {
      if (!collecting) return false;
      if (p.type === "target-available-form" && p.from === watcher) {
        targets.push(p.target);
        this.eventWaiters.push({ predicate: collector, resolve: () => {} });
        return true;
      }
      return false;
    };
    this.eventWaiters.push({ predicate: collector, resolve: () => {} });

    await this.request({ to: watcher, type: "watchTargets", targetType: "frame" });
    await new Promise((res) => setTimeout(res, 2000));
    collecting = false;
    this.eventWaiters = this.eventWaiters.filter((w) => w.predicate !== collector);

    return targets;
  }

  /** @param {string} addonActor */
  async getConsoleActor(addonActor) {
    const targets = await this.watchFrameTargets(addonActor);
    // Several frame targets can arrive (background page, options page, ...):
    // prefer the generated background page
    const background = targets.find(
      (t) => t && t.url && t.url.includes("_generated_background_page"),
    );
    const target = background || targets.find((t) => t && t.consoleActor);
    if (!target || !target.consoleActor) {
      throw new Error(
        `No background target found (saw: ${targets.map((t) => t && t.url).join(", ")})`,
      );
    }
    return target.consoleActor;
  }

  // Console actor for an open browser tab whose URL contains urlSubstr.
  // Evaluations run in the page's content window (not the extension sandbox),
  // so they see the real DOM but not content-script variables.
  /** @param {string} urlSubstr */
  async getTabConsoleActor(urlSubstr) {
    const { tabs } = await this.request({ to: "root", type: "listTabs" });
    const tab = (tabs || []).find(/** @param {RdpPacket} t */ (t) => t.url?.includes(urlSubstr));
    if (!tab) {
      throw new Error(
        `No tab matching "${urlSubstr}" (saw: ${(tabs || []).map(/** @param {RdpPacket} t */ (t) => t.url).join(", ")})`,
      );
    }

    const cached = this.tabConsoleActors.get(tab.actor);
    if (cached) return cached;

    const targets = await this.watchFrameTargets(tab.actor);
    const target = targets.find((t) => t && t.url && t.url.includes(urlSubstr) && t.consoleActor);
    if (!target) {
      throw new Error(`No console actor for tab "${urlSubstr}"`);
    }
    this.tabConsoleActors.set(tab.actor, target.consoleActor);
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
   */
  async evaluate(consoleActor, text, timeoutMs = 30000) {
    const { resultID } = await this.request({
      to: consoleActor,
      type: "evaluateJSAsync",
      text: `(async () => (${text}))()`,
      mapped: { await: true },
    });
    const result = await this.waitForEvent(
      (p) => p.type === "evaluationResult" && p.resultID === resultID,
      timeoutMs,
    );
    if (!result) throw new Error("Evaluation cancelled");
    if (result.exceptionMessage) {
      throw new Error(`Evaluation failed: ${result.exceptionMessage}`);
    }
    let value = result.result;
    if (value && typeof value === "object" && value.type === "longString") {
      value = value.initial;
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
