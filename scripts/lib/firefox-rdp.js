// Minimal Firefox Remote Debugging Protocol client (the protocol behind
// about:debugging and web-ext). Packets are `<byteLength>:<json>` over TCP.
// Responses carry no request IDs: requests to one actor are answered in
// order, so replies are matched with a per-actor FIFO. Async console
// evaluation results arrive as separate typed packets.

const net = require("net");

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
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.queues = new Map(); // actor -> [{resolve, reject}]
    this.eventWaiters = []; // {predicate, resolve}
    socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.drain();
    });
  }

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
      const fail = (e) => {
        if (done) return;
        done = true;
        client.close();
        reject(e);
      };
      socket.on("error", fail);
      // The root actor greets us on connect
      client.waitForEvent((p) => p.from === "root").then((greeting) => {
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

  dispatch(packet) {
    const waiterIdx = this.eventWaiters.findIndex((w) => w.predicate(packet));
    if (waiterIdx !== -1) {
      const [waiter] = this.eventWaiters.splice(waiterIdx, 1);
      waiter.resolve(packet);
      return;
    }

    if (EVENT_TYPES.has(packet.type)) return; // unclaimed event

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

  waitForEvent(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = { predicate };
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

  request(packet, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(packet.to)) this.queues.set(packet.to, []);
      // The entry stays in the queue on timeout but is flagged settled, so
      // dispatch() skips it instead of matching a later reply to it
      const entry = { settled: false };
      entry.resolve = (p) => {
        clearTimeout(entry.timer);
        resolve(p);
      };
      entry.reject = (e) => {
        clearTimeout(entry.timer);
        reject(e);
      };
      // close() settles a still-pending request without rejecting
      entry.cancel = () => {
        clearTimeout(entry.timer);
        resolve(undefined);
      };
      this.queues.get(packet.to).push(entry);
      const json = JSON.stringify(packet);
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

  async installTemporaryAddon(addonsActor, addonPath) {
    return this.request({ to: addonsActor, type: "installTemporaryAddon", addonPath }, 60000);
  }

  async findAddonActor(addonId) {
    const { addons } = await this.request({ to: "root", type: "listAddons" });
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon ${addonId} not in listAddons`);
    return addon.actor;
  }

  // Collects the frame targets a descriptor actor (addon or tab) exposes.
  // Firefox < 129 answers getTarget directly; >= 129 needs a watcher and
  // emits target-available-form events.
  async watchFrameTargets(descriptorActor) {
    try {
      const { form } = await this.request({ to: descriptorActor, type: "getTarget" });
      if (form && form.consoleActor) return [form];
    } catch (e) {
      if (!String(e.message).includes("unrecognizedPacketType")) throw e;
    }

    const { actor: watcher } = await this.request({
      to: descriptorActor,
      type: "getWatcher",
      isServerTargetSwitchingEnabled: true,
    });

    const targets = [];
    // A short-lived collector: matches target-available-form events for this
    // watcher, then deregisters after the collection window so it can't keep
    // intercepting events from tabs opened by later tests
    let collecting = true;
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
  async getTabConsoleActor(urlSubstr) {
    const { tabs } = await this.request({ to: "root", type: "listTabs" });
    const tab = (tabs || []).find((t) => t.url && t.url.includes(urlSubstr));
    if (!tab) {
      throw new Error(
        `No tab matching "${urlSubstr}" (saw: ${(tabs || []).map((t) => t.url).join(", ")})`,
      );
    }

    const targets = await this.watchFrameTargets(tab.actor);
    const target = targets.find((t) => t && t.url && t.url.includes(urlSubstr) && t.consoleActor);
    if (!target) {
      throw new Error(`No console actor for tab "${urlSubstr}"`);
    }
    return target.consoleActor;
  }

  // Evaluates in the extension background context; returns the string value.
  // Wrap complex results with JSON.stringify inside the expression. The
  // expression is wrapped in a top-level await so promises resolve to values
  // (the console actor maps await inputs to async evaluation).
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
