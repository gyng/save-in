const installBackgroundHelpers = () => {
  const browserApi = /** @type {any} */ (Reflect.get(globalThis, "browser"));
  const chromeApi = /** @type {any} */ (Reflect.get(globalThis, "chrome"));
  /** @param {any} message */
  const send = (message) => browserApi.runtime.sendMessage(message);
  const api = {
    ready: () => send({ type: "WAKE_WARM" }),
    reset: () => send({ type: "OPTIONS_LOADED" }),
    logs: () =>
      browserApi.storage.session
        .get("si-log")
        .then((/** @type {any} */ stored) =>
          Array.isArray(stored["si-log"]) ? stored["si-log"] : [],
        ),
    history: () =>
      send({ type: "HISTORY_GET" }).then((/** @type {any} */ response) => response.body.entries),
    getOption: (/** @type {string} */ name) =>
      send({ type: "OPTIONS" }).then((/** @type {any} */ response) => response.body[name]),
    setOptions: (/** @type {Record<string, any>} */ values) =>
      browserApi.storage.local.set(values).then(() => api.reset()),
    startDownload: (/** @type {any} */ body) =>
      send({ type: "SAVE_IN_E2E_START_DOWNLOAD", body }).then((/** @type {any} */ response) => {
        if (response?.body?.status === "OK") return response.body.result;
        throw new Error(response?.body?.message || "E2E download command failed");
      }),
    resetCounter: () => browserApi.storage.local.set({ "save-in-counter": 0 }),
    peekCounter: () =>
      browserApi.storage.local.get("save-in-counter").then((/** @type {any} */ stored) => {
        const value = Number(stored["save-in-counter"]);
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
      }),
    applyConfig: (/** @type {Record<string, any>} */ config) =>
      send({ type: "APPLY_CONFIG", body: { config } }).then(
        (/** @type {any} */ response) => response.body,
      ),
    downloadMessage: (
      /** @type {{content?: BlobPart, url?: string, info?: any, comment?: string}} */ {
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
      }).then((/** @type {any} */ response) => response.body);
    },
    inspect: async () => {
      const firefox = typeof browserApi.runtime.getBrowserInfo === "function";
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
  const api = (${installBackgroundHelpers.toString()})();
  return (${expression});
})()`;
