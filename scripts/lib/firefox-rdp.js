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
      socket.on("error", reject);
      // The root actor greets us on connect
      client.waitForEvent((p) => p.from === "root").then(() => resolve(client));
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
      const { resolve, reject } = queue.shift();
      if (packet.error) {
        reject(new Error(`${packet.error}: ${packet.message || ""}`));
      } else {
        resolve(packet);
      }
    }
  }

  waitForEvent(predicate, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      this.eventWaiters.push({ predicate, resolve });
      setTimeout(
        () => reject(new Error("RDP event timeout")),
        timeoutMs
      ).unref();
    });
  }

  request(packet, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(packet.to)) this.queues.set(packet.to, []);
      this.queues.get(packet.to).push({ resolve, reject });
      const json = JSON.stringify(packet);
      this.socket.write(`${Buffer.byteLength(json)}:${json}`);
      setTimeout(
        () => reject(new Error(`RDP timeout: ${packet.type}`)),
        timeoutMs
      ).unref();
    });
  }

  async getRoot() {
    return this.request({ to: "root", type: "getRoot" });
  }

  async installTemporaryAddon(addonsActor, addonPath) {
    return this.request(
      { to: addonsActor, type: "installTemporaryAddon", addonPath },
      60000
    );
  }

  async findAddonActor(addonId) {
    const { addons } = await this.request({ to: "root", type: "listAddons" });
    const addon = addons.find((a) => a.id === addonId);
    if (!addon) throw new Error(`Addon ${addonId} not in listAddons`);
    return addon.actor;
  }

  async getConsoleActor(addonActor) {
    // Firefox < 129: the descriptor answers getTarget directly
    try {
      const { form } = await this.request({
        to: addonActor,
        type: "getTarget",
      });
      if (form && form.consoleActor) return form.consoleActor;
    } catch (e) {
      if (!String(e.message).includes("unrecognizedPacketType")) throw e;
    }

    // Firefox >= 129: descriptor -> watcher -> target-available-form events.
    // Several frame targets can arrive (background page, options page, ...):
    // collect briefly and prefer the generated background page.
    const { actor: watcher } = await this.request({
      to: addonActor,
      type: "getWatcher",
      isServerTargetSwitchingEnabled: true,
    });

    const targets = [];
    const collector = (p) => {
      if (p.type === "target-available-form" && p.from === watcher) {
        targets.push(p.target);
        this.eventWaiters.push({ predicate: collector, resolve: () => {} });
        return true;
      }
      return false;
    };
    this.eventWaiters.push({ predicate: collector, resolve: () => {} });

    await this.request({
      to: watcher,
      type: "watchTargets",
      targetType: "frame",
    });
    await new Promise((res) => setTimeout(res, 2000));

    const background = targets.find(
      (t) => t && t.url && t.url.includes("_generated_background_page")
    );
    const target = background || targets.find((t) => t && t.consoleActor);
    if (!target || !target.consoleActor) {
      throw new Error(
        `No background target found (saw: ${targets
          .map((t) => t && t.url)
          .join(", ")})`
      );
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
      timeoutMs
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
    this.socket.destroy();
  }
}

module.exports = { FirefoxRdp };
