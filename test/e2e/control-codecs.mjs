import { createProtocolCodecs } from "./protocol-codecs.mjs";

/** @typedef {import("./control-protocol.mjs").ControlRequest} ControlRequest */

const {
  isArrayOf,
  isDownload,
  isHistoryEntry,
  isInspectResult,
  isLog,
  isNotificationCall,
  isOptionValue,
  isRecord,
  isRule,
  isRuntimeResponseFor,
  isTab,
  isWindow,
} = createProtocolCodecs();

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

/** @param {unknown} value @param {string} [label] */
export const decodeWindowEntry = (value, label = "window") => {
  if (!isWindow(value)) throw new Error(`Invalid E2E ${label}`);
  return /** @type {import("./control-protocol.mjs").WindowEntry} */ (value);
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
  if (!isOptionValue(name, value)) throw new Error(`Invalid E2E option value for ${name}`);
  return /** @type {import("./control-protocol.mjs").E2ERuntimeOptionValues[Name]} */ (value);
};

/**
 * @template {ControlRequest} Request
 * @param {Request} request
 * @param {unknown} value
 * @returns {import("./control-protocol.mjs").ControlResult<Request>}
 */
export const decodeControlResult = (request, value) => {
  const operation = request.operation;
  let valid = false;
  switch (operation) {
    case "runtime.send":
      valid = isRuntimeResponseFor(request.message, value);
      break;
    case "runtime.download":
      valid = isRuntimeResponseFor({ type: "DOWNLOAD" }, value);
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
    case "storage.wait":
      valid = true;
      break;
    case "downloads.search":
    case "downloads.wait":
      return /** @type {import("./control-protocol.mjs").ControlResult<Request>} */ (
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
    case "tabs.wait":
      valid = isTab(value);
      break;
    case "windows.create":
      valid = isWindow(value);
      break;
    case "windows.remove":
      valid = value === null;
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
    case "history.wait":
      valid = isArrayOf(value, isHistoryEntry);
      break;
    case "inspect":
      valid = isInspectResult(value);
      break;
  }
  if (!valid) {
    throw new Error(`E2E control returned an invalid ${operation} result`);
  }
  return /** @type {import("./control-protocol.mjs").ControlResult<Request>} */ (value);
};
