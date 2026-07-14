/** @typedef {import("./control-protocol.mjs").HistoryEntry} HistoryEntry */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */
/** @typedef {import("./control-protocol.mjs").NotificationCall} NotificationCall */
/** @typedef {import("./control-protocol.mjs").RuntimeResponse} RuntimeResponse */

const installBackgroundHelpers = () => {
  const chromeApi = /** @type {typeof chrome} */ (Reflect.get(globalThis, "chrome"));
  const browserApi = /** @type {typeof chrome} */ (
    /** @type {unknown} */ (Reflect.get(globalThis, "browser") || chromeApi)
  );
  /** @param {Record<string, unknown>} message */
  const send = (message) =>
    /** @type {Promise<RuntimeResponse>} */ (browserApi.runtime.sendMessage(message));
  /** @param {Record<string, unknown>} message @param {string} fallback */
  const command = async (message, fallback) => {
    const response = await send(message);
    if (response.body.status !== "OK") {
      throw new Error(typeof response.body.message === "string" ? response.body.message : fallback);
    }
    return response.body;
  };
  const api = {
    ready: () => send({ type: "WAKE_WARM" }),
    reset: () => send({ type: "OPTIONS_LOADED" }),
    logs: async () => {
      const stored = await browserApi.storage.session.get("si-log");
      return Array.isArray(stored["si-log"]) ? /** @type {LogEntry[]} */ (stored["si-log"]) : [];
    },
    history: async () => {
      const response = await send({ type: "HISTORY_GET" });
      if (!Array.isArray(response.body.entries)) throw new Error("E2E history response is invalid");
      return /** @type {HistoryEntry[]} */ (response.body.entries);
    },
    getOption: async (/** @type {string} */ name) => (await send({ type: "OPTIONS" })).body[name],
    setOptions: (/** @type {Record<string, unknown>} */ values) =>
      browserApi.storage.local.set(values).then(() => api.reset()),
    startDownload: async (/** @type {Record<string, unknown>} */ body) =>
      (await command({ type: "SAVE_IN_E2E_START_DOWNLOAD", body }, "E2E download command failed"))
        .result,
    clickContextMenu: (/** @type {Record<string, unknown>} */ body) =>
      command({ type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK", body }, "E2E context-menu command failed"),
    clickTabMenu: (/** @type {Record<string, unknown>} */ body) =>
      command({ type: "SAVE_IN_E2E_TAB_MENU_CLICK", body }, "E2E tab-menu command failed"),
    notificationCalls: async (/** @type {"get" | "reset"} */ action) => {
      const response = await command(
        { type: "SAVE_IN_E2E_NOTIFICATION_CALLS", body: { action } },
        "E2E notification command failed",
      );
      if (!Array.isArray(response.calls)) throw new Error("E2E notification response is invalid");
      return /** @type {NotificationCall[]} */ (response.calls);
    },
    resetCounter: () => browserApi.storage.local.set({ "save-in-counter": 0 }),
    peekCounter: () =>
      browserApi.storage.local.get("save-in-counter").then((stored) => {
        const value = Number(stored["save-in-counter"]);
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
      }),
    applyConfig: async (/** @type {Record<string, unknown>} */ config) =>
      (await send({ type: "APPLY_CONFIG", body: { config } })).body,
    downloadMessage: (
      /** @type {{content?: BlobPart, url?: string, info?: Record<string, unknown>, comment?: string}} */ {
        content,
        url,
        info,
        comment,
      },
    ) => {
      const downloadUrl = content === undefined ? url : URL.createObjectURL(new Blob([content]));
      return send({
        type: "DOWNLOAD",
        body: {
          url: downloadUrl,
          info,
          comment,
        },
      }).then((response) => response.body);
    },
    inspect: async () => {
      const firefox = typeof Reflect.get(browserApi.runtime, "getBrowserInfo") === "function";
      const contextTypes = chromeApi?.contextMenus?.ContextType;
      return {
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
    },
  };
  return api;
};

/** @param {string} expression */
export const inBackgroundContext = (expression) => `(() => {
  const browser = Reflect.get(globalThis, "browser") || Reflect.get(globalThis, "chrome");
  const api = (${installBackgroundHelpers.toString()})();
  return (${expression});
})()`;
