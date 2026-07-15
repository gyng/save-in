/** @typedef {import("./control-protocol.mjs").BackgroundRuntimeMessage} BackgroundRuntimeMessage */
/** @typedef {import("./control-protocol.mjs").ContextMenuClickBody} ContextMenuClickBody */
/** @typedef {import("./control-protocol.mjs").E2ERuntimeOptionName} E2ERuntimeOptionName */
/** @typedef {import("./control-protocol.mjs").E2ERuntimeOptionValues} E2ERuntimeOptionValues */
/** @typedef {import("./control-protocol.mjs").HistoryEntry} HistoryEntry */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */
/** @typedef {import("./control-protocol.mjs").NotificationCall} NotificationCall */
/** @typedef {import("./control-protocol.mjs").StoredOptionsPatch} StoredOptionsPatch */
/** @typedef {import("./control-protocol.mjs").RuntimeResponse} RuntimeResponse */
/** @typedef {import("./control-protocol.mjs").StartDownloadBody} StartDownloadBody */
/** @typedef {import("./control-protocol.mjs").TabMenuClickBody} TabMenuClickBody */

const installBackgroundHelpers = () => {
  const chromeApi = /** @type {typeof chrome} */ (Reflect.get(globalThis, "chrome"));
  const browserApi = /** @type {typeof chrome} */ (
    /** @type {unknown} */ (Reflect.get(globalThis, "browser") || chromeApi)
  );
  /** @param {BackgroundRuntimeMessage} message */
  const send = (message) =>
    /** @type {Promise<RuntimeResponse>} */ (browserApi.runtime.sendMessage(message));
  /** @param {BackgroundRuntimeMessage} message @param {string} fallback */
  const command = async (message, fallback) => {
    const response = await send(message);
    if (!response.body || response.body.status !== "OK") {
      throw new Error(
        response.body && typeof response.body.message === "string"
          ? response.body.message
          : fallback,
      );
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
      if (!response.body || !Array.isArray(response.body.entries)) {
        throw new Error("E2E history response is invalid");
      }
      return /** @type {HistoryEntry[]} */ (response.body.entries);
    },
    /** @template {E2ERuntimeOptionName} Name @param {Name} name @returns {Promise<E2ERuntimeOptionValues[Name]>} */
    getOption: async (name) => {
      const response = await send({ type: "OPTIONS" });
      if (!response.body) throw new Error("E2E options response is invalid");
      return /** @type {E2ERuntimeOptionValues[Name]} */ (response.body[name]);
    },
    setOptions: (/** @type {StoredOptionsPatch} */ values) =>
      browserApi.storage.local.set(values).then(() => api.reset()),
    startDownload: async (/** @type {StartDownloadBody} */ body) =>
      (await command({ type: "SAVE_IN_E2E_START_DOWNLOAD", body }, "E2E download command failed"))
        .result,
    clickContextMenu: (/** @type {ContextMenuClickBody} */ body) =>
      command({ type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK", body }, "E2E context-menu command failed"),
    clickTabMenu: (/** @type {TabMenuClickBody} */ body) =>
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
    applyConfig: async (/** @type {Record<string, unknown>} */ config) => {
      const response = await send({ type: "APPLY_CONFIG", body: { config } });
      if (!response.body) throw new Error("E2E apply-config response is invalid");
      return response.body;
    },
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
          ...(downloadUrl === undefined ? {} : { url: downloadUrl }),
          ...(info === undefined ? {} : { info }),
          ...(comment === undefined ? {} : { comment }),
        },
      }).then((response) => {
        if (!response.body) throw new Error("E2E download response is invalid");
        return response.body;
      });
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
