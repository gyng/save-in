const installBackgroundHelpers = () => {
  const browserApi = /** @type {any} */ (Reflect.get(globalThis, "browser"));
  const send = (message) => browserApi.runtime.sendMessage(message);
  const api = {
    ready: () => send({ type: "WAKE_WARM" }),
    reset: () => send({ type: "OPTIONS_LOADED" }),
    logs: () =>
      browserApi.storage.session
        .get("si-log")
        .then((stored) => (Array.isArray(stored["si-log"]) ? stored["si-log"] : [])),
    history: () => send({ type: "HISTORY_GET" }).then((response) => response.body.entries),
    getOption: (name) => send({ type: "OPTIONS" }).then((response) => response.body[name]),
    setOptions: (values) => browserApi.storage.local.set(values).then(() => api.reset()),
    startDownload: (body) =>
      send({ type: "SAVE_IN_E2E_START_DOWNLOAD", body }).then((response) => {
        if (response?.body?.status === "OK") return response.body.result;
        throw new Error(response?.body?.message || "E2E download command failed");
      }),
    resetCounter: () => browserApi.storage.local.set({ "save-in-counter": 0 }),
    peekCounter: () =>
      browserApi.storage.local.get("save-in-counter").then((stored) => {
        const value = Number(stored["save-in-counter"]);
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
      }),
    applyConfig: (config) =>
      send({ type: "APPLY_CONFIG", body: { config } }).then((response) => response.body),
    downloadMessage: ({ content, url, info, comment }) => {
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
      const firefox = typeof browserApi.runtime.getBrowserInfo === "function";
      const contextTypes = globalThis.chrome?.contextMenus?.ContextType;
      return {
        browser: firefox ? "FIREFOX" : "CHROME",
        capabilities: {
          tabContextMenus: firefox || contextTypes?.TAB === "tab",
          accessKeys: true,
          downloadFilenameSuggestion: Boolean(globalThis.chrome?.downloads?.onDeterminingFilename),
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

export const inBackgroundContext = (expression) => `(() => {
  const api = (${installBackgroundHelpers.toString()})();
  return (${expression});
})()`;
