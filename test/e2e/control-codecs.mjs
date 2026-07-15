/** @typedef {import("./control-protocol.mjs").ControlOperation} ControlOperation */
/** @typedef {import("./control-protocol.mjs").ControlResultMap} ControlResultMap */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value @param {(item: unknown) => boolean} matches */
const isArrayOf = (value, matches) => Array.isArray(value) && value.every(matches);

/** @param {unknown} value */
const isDownload = (value) =>
  isRecord(value) &&
  typeof value.id === "number" &&
  typeof value.state === "string" &&
  typeof value.filename === "string" &&
  typeof value.url === "string";

/** @param {unknown} value */
const isTab = (value) =>
  isRecord(value) &&
  (value.id === undefined || typeof value.id === "number") &&
  (value.index === undefined || typeof value.index === "number") &&
  (value.windowId === undefined || typeof value.windowId === "number") &&
  (value.url === undefined || typeof value.url === "string") &&
  (value.title === undefined || typeof value.title === "string") &&
  (value.active === undefined || typeof value.active === "boolean") &&
  (value.status === undefined || typeof value.status === "string") &&
  (value.incognito === undefined || typeof value.incognito === "boolean");

/** @param {unknown} value */
const isHistoryEntry = (value) =>
  isRecord(value) &&
  (value.id === undefined || typeof value.id === "string") &&
  (value.url === undefined || typeof value.url === "string") &&
  (value.status === undefined || typeof value.status === "string") &&
  (value.finalFullPath === undefined || typeof value.finalFullPath === "string") &&
  (value.private === undefined || typeof value.private === "boolean") &&
  (value.info === undefined || isRecord(value.info));

/** @param {unknown} value */
const isNotificationCall = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  (value.title === undefined || typeof value.title === "string") &&
  (value.message === undefined || typeof value.message === "string");

/** @param {unknown} value */
const isLog = (value) => isRecord(value) && typeof value.message === "string";

/** @param {unknown} value */
const isRule = (value) => isRecord(value) && typeof value.id === "number";

/** @param {unknown} value */
const isRuntimeResponse = (value) =>
  isRecord(value) &&
  (value.type === undefined || typeof value.type === "string") &&
  (value.body === undefined || isRecord(value.body));

/** @param {unknown} value */
const isInspectResult = (value) =>
  isRecord(value) &&
  (value.browser === "CHROME" || value.browser === "FIREFOX") &&
  isRecord(value.capabilities) &&
  typeof value.capabilities.tabContextMenus === "boolean" &&
  typeof value.capabilities.accessKeys === "boolean" &&
  typeof value.capabilities.downloadFilenameSuggestion === "boolean" &&
  typeof value.capabilities.downloadDeltaFilename === "boolean" &&
  typeof value.capabilities.conflictActionPrompt === "boolean" &&
  typeof value.capabilities.downloadRequestHeaders === "boolean" &&
  (value.promptConflictAction === "prompt" || value.promptConflictAction === "uniquify") &&
  typeof value.hasObjectUrl === "boolean";

/** @param {unknown} value @param {string} [label] */
export const decodeDownloadEntries = (value, label = "download entries") => {
  if (!isArrayOf(value, isDownload)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").DownloadEntry[]} */ (value);
};

/** @param {unknown} value @param {string} [label] */
export const decodeHistoryEntries = (value, label = "history entries") => {
  if (!isArrayOf(value, isHistoryEntry)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").HistoryEntry[]} */ (value);
};

/** @param {unknown} value @param {string} [label] */
export const decodeLogEntries = (value, label = "log entries") => {
  if (!isArrayOf(value, isLog)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").LogEntry[]} */ (value);
};

/** @param {unknown} value @param {string} [label] */
export const decodeNotificationCalls = (value, label = "notification calls") => {
  if (!isArrayOf(value, isNotificationCall)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").NotificationCall[]} */ (value);
};

/** @param {unknown} value @param {string} [label] */
export const decodeTabEntry = (value, label = "tab") => {
  if (!isTab(value)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").TabEntry} */ (value);
};

/** @param {unknown} value */
export const decodeWindowReference = (value) => {
  if (!isRecord(value) || typeof value.windowId !== "number") {
    throw new Error("Invalid E2E window reference");
  }
  return /** @type {{windowId: number}} */ (value);
};

/**
 * @template {import("./control-protocol.mjs").E2ERuntimeOptionName} Name
 * @param {Name} name
 * @param {unknown} value
 * @returns {import("./control-protocol.mjs").E2ERuntimeOptionValues[Name]}
 */
export const decodeOptionValue = (name, value) => {
  const valid =
    name === "contentClickToSaveCombo"
      ? typeof value === "string" || typeof value === "number"
      : name === "notifyDuration"
        ? typeof value === "number"
        : name === "paths" || name === "setRefererHeaderFilter"
          ? typeof value === "string"
          : name === "shortcutType"
            ? typeof value === "string" &&
              ["HTML_REDIRECT", "MAC", "MAC_WEBLOC", "FREEDESKTOP", "WINDOWS"].includes(value)
            : typeof value === "boolean";
  if (!valid) throw new Error(`Invalid E2E option value for ${name}`);
  return /** @type {import("./control-protocol.mjs").E2ERuntimeOptionValues[Name]} */ (value);
};

/**
 * @template {ControlOperation} Operation
 * @param {Operation} operation
 * @param {unknown} value
 * @returns {ControlResultMap[Operation]}
 */
export const decodeControlResult = (operation, value) => {
  let valid = false;
  switch (operation) {
    case "runtime.send":
      valid = isRuntimeResponse(value);
      break;
    case "storage.get":
    case "notifications.getAll":
      valid = isRecord(value);
      break;
    case "storage.set":
    case "storage.remove":
    case "storage.clear":
    case "harness.resetCase":
      valid = value === true;
      break;
    case "downloads.search":
    case "downloads.wait":
      return /** @type {ControlResultMap[Operation]} */ (
        decodeDownloadEntries(value, `${operation} result`)
      );
    case "downloads.cancel":
    case "tabs.reload":
    case "tabs.remove":
    case "dnr.updateSessionRules":
      valid = value === null;
      break;
    case "downloads.erase":
      valid = isArrayOf(value, (item) => typeof item === "number");
      break;
    case "tabs.query":
      valid = isArrayOf(value, isTab);
      break;
    case "tabs.create":
    case "tabs.update":
      valid = isTab(value);
      break;
    case "tabs.sendMessage":
      valid = true;
      break;
    case "notifications.clear":
    case "offscreen.hasDocument":
      valid = typeof value === "boolean";
      break;
    case "dnr.getSessionRules":
      valid = isArrayOf(value, isRule);
      break;
    case "logs.get":
    case "logs.wait":
      valid = isArrayOf(value, isLog);
      break;
    case "inspect":
      valid = isInspectResult(value);
      break;
  }
  if (!valid) {
    throw new Error(`E2E control returned an invalid ${operation} result`);
  }
  return /** @type {ControlResultMap[Operation]} */ (value);
};
