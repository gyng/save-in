/** @typedef {import("./control-protocol.mjs").ControlOperation} ControlOperation */
/** @typedef {import("./control-protocol.mjs").ControlRequest} ControlRequest */
/** @typedef {import("./control-protocol.mjs").ControlResultMap} ControlResultMap */
/** @typedef {import("./control-protocol.mjs").DownloadEntry} DownloadEntry */
/** @typedef {import("./control-protocol.mjs").HistoryEntry} HistoryEntry */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */
/** @typedef {import("./control-protocol.mjs").NotificationCall} NotificationCall */

/**
 * Runs in the extension Options page. Keep this function self-contained: CDP
 * and BiDi serialize it into the target realm and pass only JSON arguments.
 *
 * @param {string} serializedRequest
 */
const dispatchControlRequest = async (serializedRequest) => {
  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const parsedRequest = /** @type {unknown} */ (JSON.parse(serializedRequest));
  if (!isRecord(parsedRequest) || typeof parsedRequest.operation !== "string") {
    throw new Error("Invalid E2E control request");
  }
  const request = /** @type {ControlRequest} */ (parsedRequest);
  const chromeApi = /** @type {typeof chrome} */ (Reflect.get(globalThis, "chrome"));
  const browserApi = /** @type {typeof chrome} */ (
    /** @type {unknown} */ (Reflect.get(globalThis, "browser") || chromeApi)
  );
  /** @param {Record<string, unknown>} message */
  const send = (message) => browserApi.runtime.sendMessage(message);
  /** @param {unknown} value */
  const succeed = (value) => JSON.stringify({ ok: true, value: value ?? null });
  /** @param {unknown} error */
  const fail = (error) =>
    JSON.stringify({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

  /** @param {import("./control-protocol.mjs").StorageAreaName} area */
  const storageArea = (area) => {
    const selected = area === "local" ? browserApi.storage?.local : browserApi.storage?.session;
    if (!selected) throw new Error(`Storage area is unavailable: ${area}`);
    return selected;
  };

  /** @param {{filenameRegex?: string, filenameIncludes?: string, url?: string, timeoutMs?: number}} match */
  const waitForDownload = ({ filenameRegex, filenameIncludes, url, timeoutMs = 8000 }) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      let settled = false;
      /** @type {DownloadEntry[]} */
      let lastRows = [];
      /** @param {chrome.downloads.DownloadItem} entry */
      const matches = (entry) =>
        filenameRegex
          ? new RegExp(filenameRegex).test(entry.filename)
          : filenameIncludes
            ? entry.filename.includes(filenameIncludes)
            : entry.url === url;
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        browserApi.downloads.onChanged.removeListener(onChanged);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = async () => {
        const rows = (await browserApi.downloads.search({})).filter(matches);
        lastRows = rows.map(({ id, state, filename, url: rowUrl }) => ({
          id,
          state,
          filename,
          url: rowUrl,
        }));
        if (lastRows.some((entry) => entry.state === "complete")) {
          finish(() => resolve(lastRows));
        }
      };
      const onChanged = () => void check().catch((error) => finish(() => reject(error)));
      const onTimeout = () =>
        finish(() =>
          reject(
            new Error(`Timed out waiting for download: ${JSON.stringify({ request, lastRows })}`),
          ),
        );
      browserApi.downloads.onChanged.addListener(onChanged);
      timeout.addEventListener("abort", onTimeout, { once: true });
      void check().catch((error) => finish(() => reject(error)));
    });

  const readLogs = async () => {
    const stored = await browserApi.storage.session.get("si-log");
    return Array.isArray(stored["si-log"]) ? /** @type {LogEntry[]} */ (stored["si-log"]) : [];
  };

  /** @param {{baseline?: number, messages: string[], timeoutMs?: number}} match */
  const waitForLog = ({ baseline = 0, messages, timeoutMs = 8000 }) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      let settled = false;
      /** @type {LogEntry[]} */
      let lastEntries = [];
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        browserApi.storage.onChanged.removeListener(onChanged);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = async () => {
        const entries = await readLogs();
        lastEntries = entries.slice(baseline);
        if (lastEntries.some((entry) => messages.includes(entry.message))) {
          finish(() => resolve(entries));
        }
      };
      /** @param {Record<string, chrome.storage.StorageChange>} changes @param {string} area */
      const onChanged = (changes, area) => {
        if (area === "session" && changes["si-log"]) {
          void check().catch((error) => finish(() => reject(error)));
        }
      };
      const onTimeout = () =>
        finish(() =>
          reject(new Error(`Timed out waiting for log entry: ${JSON.stringify(lastEntries)}`)),
        );
      browserApi.storage.onChanged.addListener(onChanged);
      timeout.addEventListener("abort", onTimeout, { once: true });
      void check().catch((error) => finish(() => reject(error)));
    });

  /** @param {Record<string, unknown> | undefined} snapshot */
  const resetCase = async (snapshot) => {
    /** @type {string[]} */
    const failures = [];
    /** @param {string} label @param {() => Promise<unknown>} operation */
    const attempt = async (label, operation) => {
      try {
        await operation();
      } catch (error) {
        failures.push(
          `${label}: ${error instanceof Error ? error.stack || error.message : String(error)}`,
        );
      }
    };
    const optionsUrl = browserApi.runtime.getURL("src/options/options.html");
    await Promise.all([
      attempt("tabs", async () => {
        const [current, tabs] = await Promise.all([
          browserApi.tabs.getCurrent(),
          browserApi.tabs.query({}),
        ]);
        const keep = current?.id ?? tabs.find((tab) => tab.url?.startsWith(optionsUrl))?.id;
        const remove = tabs.flatMap((tab) =>
          tab.id !== undefined && tab.id !== keep ? [tab.id] : [],
        );
        if (remove.length) await browserApi.tabs.remove(remove);
      }),
      attempt("downloads", async () => {
        const downloads = await browserApi.downloads.search({});
        await Promise.all(
          downloads
            .filter((download) => download.state === "in_progress")
            .map((download) => browserApi.downloads.cancel(download.id).catch(() => {})),
        );
        await browserApi.downloads.erase({});
      }),
      attempt("notifications", async () => {
        if (!browserApi.notifications?.getAll) return;
        const notifications = await browserApi.notifications.getAll();
        await Promise.all(
          Object.keys(notifications).map((id) => browserApi.notifications.clear(id)),
        );
      }),
      attempt("session rules", async () => {
        if (!browserApi.declarativeNetRequest?.getSessionRules) return;
        const rules = await browserApi.declarativeNetRequest.getSessionRules();
        if (rules.length) {
          await browserApi.declarativeNetRequest.updateSessionRules({
            removeRuleIds: rules.map((rule) => rule.id),
          });
        }
      }),
    ]);
    await attempt("session storage", () => browserApi.storage.session?.clear?.());
    if (snapshot) {
      await attempt("local storage", async () => {
        await browserApi.storage.local.clear();
        await browserApi.storage.local.set(snapshot);
      });
    }
    await attempt("runtime reset", () => send({ type: "OPTIONS_LOADED" }));
    if (failures.length) throw new Error(failures.join("\n---\n"));
    return true;
  };

  try {
    let result;
    switch (request.operation) {
      case "runtime.send":
        result = await send(request.message);
        break;
      case "storage.get":
        result = await storageArea(request.area).get(request.keys ?? null);
        break;
      case "storage.set":
        await storageArea(request.area).set(request.values);
        result = true;
        break;
      case "storage.remove":
        await storageArea(request.area).remove(request.keys);
        result = true;
        break;
      case "storage.clear":
        await storageArea(request.area).clear();
        result = true;
        break;
      case "downloads.search":
        result = await browserApi.downloads.search(request.query ?? {});
        break;
      case "downloads.wait":
        result = await waitForDownload(request);
        break;
      case "downloads.cancel":
        result = await browserApi.downloads.cancel(request.id);
        break;
      case "downloads.erase":
        result = await browserApi.downloads.erase(request.query ?? {});
        break;
      case "tabs.query":
        result = await browserApi.tabs.query(request.query ?? {});
        break;
      case "tabs.create":
        result = await browserApi.tabs.create(request.properties);
        break;
      case "tabs.update":
        result = await browserApi.tabs.update(request.id, request.properties);
        break;
      case "tabs.reload":
        result = await browserApi.tabs.reload(request.id);
        break;
      case "tabs.remove":
        result = await browserApi.tabs.remove(
          Array.isArray(request.ids) ? request.ids : [request.ids],
        );
        break;
      case "tabs.sendMessage":
        result = await browserApi.tabs.sendMessage(request.id, request.message);
        break;
      case "notifications.getAll":
        result = await browserApi.notifications.getAll();
        break;
      case "notifications.clear":
        result = await browserApi.notifications.clear(request.id);
        break;
      case "dnr.getSessionRules":
        result = await browserApi.declarativeNetRequest.getSessionRules();
        break;
      case "dnr.updateSessionRules":
        result = await browserApi.declarativeNetRequest.updateSessionRules(request.update);
        break;
      case "offscreen.hasDocument":
        result = await chromeApi.offscreen.hasDocument();
        break;
      case "logs.get":
        result = await readLogs();
        break;
      case "logs.wait":
        result = await waitForLog(request);
        break;
      case "harness.resetCase":
        result = await resetCase(request.snapshot);
        break;
      case "inspect": {
        const firefox = typeof Reflect.get(browserApi.runtime, "getBrowserInfo") === "function";
        const contextTypes = chromeApi?.contextMenus?.ContextType;
        result = {
          browser: firefox ? "FIREFOX" : "CHROME",
          capabilities: {
            tabContextMenus: firefox || contextTypes?.TAB === "tab",
            accessKeys: true,
            downloadFilenameSuggestion: Boolean(chromeApi?.downloads?.onDeterminingFilename),
            downloadDeltaFilename: !firefox,
            conflictActionPrompt: firefox,
            downloadRequestHeaders: firefox,
          },
          promptConflictAction: firefox ? "prompt" : "uniquify",
          hasObjectUrl: typeof URL.createObjectURL === "function",
        };
        break;
      }
      default:
        throw new Error(`Unsupported E2E control operation: ${parsedRequest.operation}`);
    }
    return succeed(result);
  } catch (error) {
    return fail(error);
  }
};

const CONTROL_FUNCTION = dispatchControlRequest.toString();

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} error */
const isMissingControlPage = (error) =>
  error instanceof Error &&
  /** @type {Error & {code?: string}} */ (error).code === "E2E_CONTROL_TARGET_MISSING";

/**
 * Restores the extension control page only when target discovery proved that
 * dispatch never started. Other transport errors are ambiguous and must not be
 * retried because the browser may already have completed a side effect.
 *
 * @param {{
 *   callFunction: (
 *     functionDeclaration: string,
 *     args?: unknown[],
 *     timeoutMs?: number,
 *   ) => Promise<unknown>,
 *   recover: () => Promise<void>,
 *   isMissing?: (error: unknown) => boolean,
 * }} adapter
 */
export const createRecoveringControlTransport = ({
  callFunction,
  recover,
  isMissing = isMissingControlPage,
}) => {
  /**
   * @param {string} functionDeclaration
   * @param {unknown[]} [args]
   * @param {number} [timeoutMs]
   */
  return async (functionDeclaration, args, timeoutMs) => {
    try {
      return await callFunction(functionDeclaration, args, timeoutMs);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await recover();
      return callFunction(functionDeclaration, args, timeoutMs);
    }
  };
};

/**
 * @param {{
 *   callFunction: (
 *     functionDeclaration: string,
 *     args?: unknown[],
 *     timeoutMs?: number,
 *   ) => Promise<unknown>,
 * }} adapter
 */
export const createE2EControlClient = ({ callFunction }) => {
  let calls = 0;
  /**
   * @template {ControlOperation} Operation
   * @param {Extract<ControlRequest, {operation: Operation}>} request
   * @param {number} [timeoutMs]
   * @returns {Promise<ControlResultMap[Operation]>}
   */
  const call = async (request, timeoutMs) => {
    calls += 1;
    const serialized = await callFunction(CONTROL_FUNCTION, [request], timeoutMs);
    if (typeof serialized !== "string") {
      throw new Error(`E2E control returned a non-string response: ${typeof serialized}`);
    }
    const response = /** @type {unknown} */ (JSON.parse(serialized));
    if (!isRecord(response)) throw new Error("E2E control returned an invalid response");
    if (response.ok !== true) {
      const details = isRecord(response.error) ? response.error : {};
      const message =
        typeof details.message === "string" ? details.message : "E2E control operation failed";
      const error = new Error(message);
      if (typeof details.stack === "string") error.stack = details.stack;
      throw error;
    }
    return /** @type {ControlResultMap[Operation]} */ (response.value);
  };

  /** @param {"local" | "session"} name */
  const area = (name) => ({
    /** @param {string | string[] | Record<string, unknown> | null} [keys] */
    get: (keys = null) => call({ operation: "storage.get", area: name, keys }),
    /** @param {Record<string, unknown>} values */
    set: (values) => call({ operation: "storage.set", area: name, values }),
    /** @param {string | string[]} keys */
    remove: (keys) => call({ operation: "storage.remove", area: name, keys }),
    clear: () => call({ operation: "storage.clear", area: name }),
  });

  /** @param {Record<string, unknown>} message @param {string} fallback */
  const command = async (message, fallback) => {
    const response = await call({ operation: "runtime.send", message });
    if (response?.body?.status !== "OK") {
      throw new Error(
        typeof response?.body?.message === "string" ? response.body.message : fallback,
      );
    }
    return response.body;
  };

  return {
    call,
    metrics: () => ({ structuredCalls: calls }),
    runtime: {
      /** @param {Record<string, unknown>} message @param {number} [timeoutMs] */
      send: (message, timeoutMs) => call({ operation: "runtime.send", message }, timeoutMs),
      ready: () => call({ operation: "runtime.send", message: { type: "WAKE_WARM" } }),
      reset: () => call({ operation: "runtime.send", message: { type: "OPTIONS_LOADED" } }),
    },
    storage: { local: area("local"), session: area("session") },
    downloads: {
      /** @param {Record<string, unknown>} [query] */
      search: (query = {}) => call({ operation: "downloads.search", query }),
      /** @param {{filenameRegex?: string, filenameIncludes?: string, url?: string, timeoutMs?: number}} match */
      wait: (match) =>
        call({ operation: "downloads.wait", ...match }, (match.timeoutMs ?? 8000) + 2000),
      /** @param {number} id */
      cancel: (id) => call({ operation: "downloads.cancel", id }),
      /** @param {Record<string, unknown>} [query] */
      erase: (query = {}) => call({ operation: "downloads.erase", query }),
    },
    tabs: {
      /** @param {Record<string, unknown>} [query] */
      query: (query = {}) => call({ operation: "tabs.query", query }),
      /** @param {Record<string, unknown>} properties */
      create: (properties) => call({ operation: "tabs.create", properties }),
      /** @param {number} id @param {Record<string, unknown>} properties */
      update: (id, properties) => call({ operation: "tabs.update", id, properties }),
      /** @param {number} id */
      reload: (id) => call({ operation: "tabs.reload", id }),
      /** @param {number | number[]} ids */
      remove: (ids) => call({ operation: "tabs.remove", ids }),
      /** @param {number} id @param {Record<string, unknown>} message */
      sendMessage: (id, message) => call({ operation: "tabs.sendMessage", id, message }),
    },
    notifications: {
      getAll: () => call({ operation: "notifications.getAll" }),
      /** @param {string} id */
      clear: (id) => call({ operation: "notifications.clear", id }),
    },
    dnr: {
      getSessionRules: () => call({ operation: "dnr.getSessionRules" }),
      /** @param {Record<string, unknown>} update */
      updateSessionRules: (update) => call({ operation: "dnr.updateSessionRules", update }),
    },
    offscreen: { hasDocument: () => call({ operation: "offscreen.hasDocument" }) },
    logs: {
      get: () => call({ operation: "logs.get" }),
      /** @param {{baseline?: number, messages: string[], timeoutMs?: number}} match */
      wait: (match) => call({ operation: "logs.wait", ...match }, (match.timeoutMs ?? 8000) + 2000),
    },
    inspect: () => call({ operation: "inspect" }),
    harness: {
      /** @param {Record<string, unknown> | undefined} snapshot */
      resetCase: (snapshot) =>
        call(
          snapshot
            ? { operation: "harness.resetCase", snapshot }
            : { operation: "harness.resetCase" },
          15000,
        ),
    },
    options: {
      all: async () => {
        const response = await call({ operation: "runtime.send", message: { type: "OPTIONS" } });
        return response.body;
      },
      /** @param {string} name */
      get: async (name) =>
        (await call({ operation: "runtime.send", message: { type: "OPTIONS" } })).body[name],
      /** @param {Record<string, unknown>} values */
      set: async (values) => {
        await call({ operation: "storage.set", area: "local", values });
        await call({ operation: "runtime.send", message: { type: "OPTIONS_LOADED" } });
      },
    },
    history: {
      get: async () => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "HISTORY_GET" },
        });
        if (!Array.isArray(response.body.entries)) {
          throw new Error("E2E history response is invalid");
        }
        return /** @type {HistoryEntry[]} */ (response.body.entries);
      },
    },
    background: {
      /** @param {Record<string, unknown>} body */
      startDownload: async (body) => {
        const response = await command(
          { type: "SAVE_IN_E2E_START_DOWNLOAD", body },
          "E2E download command failed",
        );
        return response.result;
      },
      /** @param {Record<string, unknown>} body */
      clickContextMenu: (body) =>
        command(
          { type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK", body },
          "E2E context-menu command failed",
        ),
      /** @param {Record<string, unknown>} body */
      clickTabMenu: (body) =>
        command({ type: "SAVE_IN_E2E_TAB_MENU_CLICK", body }, "E2E tab-menu command failed"),
      /** @param {"get" | "reset"} action */
      notificationCalls: async (action) => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "SAVE_IN_E2E_NOTIFICATION_CALLS", body: { action } },
        });
        if (!Array.isArray(response.body.calls)) {
          throw new Error("E2E notification calls response is invalid");
        }
        return /** @type {NotificationCall[]} */ (response.body.calls);
      },
      /** @param {Record<string, unknown>} config */
      applyConfig: async (config) =>
        (
          await call({
            operation: "runtime.send",
            message: { type: "APPLY_CONFIG", body: { config } },
          })
        ).body,
    },
  };
};
