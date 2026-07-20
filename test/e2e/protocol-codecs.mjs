// This factory is deliberately self-contained. Its source is injected into
// browser realms as well as used by the runner, so every E2E path applies the
// same wire-shape checks without depending on realm-local module imports.
export const createProtocolCodecs = () => {
  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  /** @param {unknown} value */
  const isStringArray = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  /** @param {unknown} value @param {(item: unknown) => boolean} matches */
  const isArrayOf = (value, matches) => Array.isArray(value) && value.every(matches);
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalString = (value, key) =>
    value[key] === undefined || typeof value[key] === "string";
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalNumber = (value, key) =>
    value[key] === undefined || typeof value[key] === "number";
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalPositiveInteger = (value, key) =>
    value[key] === undefined ||
    (typeof value[key] === "number" &&
      Number.isSafeInteger(value[key]) &&
      value[key] > 0 &&
      value[key] <= 300_000);
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalBoolean = (value, key) =>
    value[key] === undefined || typeof value[key] === "boolean";

  /** @param {unknown} value */
  const isMenuInfo = (value) =>
    isRecord(value) &&
    (typeof value.menuItemId === "string" || typeof value.menuItemId === "number") &&
    ["selectionText", "pageUrl", "linkUrl", "srcUrl", "frameUrl", "mediaType", "linkText"].every(
      (key) => hasOptionalString(value, key),
    ) &&
    (value.modifiers === undefined || isStringArray(value.modifiers));
  /** @param {unknown} value @param {boolean} requireTab */
  const isMenuBody = (value, requireTab) => {
    if (!isRecord(value) || !isMenuInfo(value.info)) return false;
    if (!requireTab) {
      return (
        value.tab === undefined ||
        (isRecord(value.tab) &&
          hasOptionalNumber(value.tab, "id") &&
          hasOptionalString(value.tab, "title") &&
          hasOptionalString(value.tab, "url") &&
          hasOptionalBoolean(value.tab, "incognito"))
      );
    }
    return (
      isRecord(value.tab) &&
      typeof value.tab.id === "number" &&
      typeof value.tab.index === "number" &&
      typeof value.tab.windowId === "number"
    );
  };
  /** @param {unknown} value */
  const isRuntimeMessage = (value) => {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    switch (value.type) {
      case "WAKE_WARM":
      case "OPTIONS_LOADED":
      case "OPTIONS":
      case "HISTORY_GET":
      case "EXTERNAL_DOWNLOAD_REJECTIONS_GET":
        return value.body === undefined;
      case "EXTERNAL_DOWNLOAD_REJECTION_CLEAR":
        return isRecord(value.body) && typeof value.body.senderId === "string";
      case "HISTORY_CANCEL":
      case "HISTORY_UNDO":
        return isRecord(value.body) && typeof value.body.historyId === "string";
      case "HISTORY_REROUTE":
        return (
          isRecord(value.body) &&
          typeof value.body.historyId === "string" &&
          typeof value.body.destination === "string" &&
          value.body.destination.length > 0
        );
      case "DOWNLOAD":
        return (
          isRecord(value.body) &&
          hasOptionalString(value.body, "url") &&
          (value.body.info === undefined || isRecord(value.body.info)) &&
          hasOptionalString(value.body, "comment")
        );
      case "SAVE_IN_E2E_START_DOWNLOAD": {
        const body = value.body;
        return (
          isRecord(body) &&
          typeof body.suggestedFilename === "string" &&
          ["content", "url", "shortcutUrl", "pageUrl", "path"].every((key) =>
            hasOptionalString(body, key),
          ) &&
          (body.modifiers === undefined || isStringArray(body.modifiers)) &&
          (body.config === undefined || isRecord(body.config)) &&
          (body.expectedGeneration === undefined ||
            (isRecord(body.expectedGeneration) &&
              typeof body.expectedGeneration.instanceId === "string" &&
              typeof body.expectedGeneration.generation === "number" &&
              Number.isSafeInteger(body.expectedGeneration.generation) &&
              body.expectedGeneration.generation > 0))
        );
      }
      case "SAVE_IN_E2E_CONTEXT_MENU_CLICK":
        return isMenuBody(value.body, false);
      case "SAVE_IN_E2E_TAB_MENU_CLICK":
        return isMenuBody(value.body, true);
      case "SAVE_IN_E2E_HISTORY_WRITE":
        return (
          isRecord(value.body) &&
          (value.body.action === "clear" ||
            (value.body.action === "add-and-patch" &&
              typeof value.body.index === "number" &&
              Number.isSafeInteger(value.body.index) &&
              value.body.index >= 0 &&
              value.body.index <= 10_000 &&
              typeof value.body.payload === "string" &&
              value.body.payload.length <= 4096))
        );
      case "SAVE_IN_E2E_RESET_STATE":
        return value.body === undefined;
      case "SAVE_IN_E2E_NOTIFICATION_CALLS":
        return (
          isRecord(value.body) &&
          (value.body.action === "get" ||
            value.body.action === "reset" ||
            (value.body.action === "wait" &&
              typeof value.body.id === "string" &&
              value.body.id.length > 0 &&
              hasOptionalPositiveInteger(value.body, "timeoutMs")))
        );
      case "APPLY_CONFIG":
        return isRecord(value.body) && isRecord(value.body.config);
      default:
        return false;
    }
  };

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
    hasOptionalNumber(value, "id") &&
    hasOptionalNumber(value, "index") &&
    hasOptionalNumber(value, "windowId") &&
    hasOptionalString(value, "url") &&
    hasOptionalString(value, "title") &&
    hasOptionalBoolean(value, "active") &&
    hasOptionalString(value, "status") &&
    hasOptionalBoolean(value, "incognito");
  /** @param {unknown} value */
  const isWindow = (value) =>
    isRecord(value) &&
    typeof value.id === "number" &&
    hasOptionalBoolean(value, "incognito") &&
    (value.tabs === undefined || isArrayOf(value.tabs, isTab));
  /** @param {unknown} value */
  const isHistoryEntry = (value) =>
    isRecord(value) &&
    hasOptionalString(value, "id") &&
    hasOptionalString(value, "url") &&
    hasOptionalString(value, "status") &&
    hasOptionalString(value, "finalFullPath") &&
    hasOptionalBoolean(value, "private") &&
    (value.info === undefined || isRecord(value.info));
  /** @param {unknown} value */
  const isExternalDownloadRejection = (value) =>
    isRecord(value) && typeof value.senderId === "string" && typeof value.attempts === "number";
  /** @param {unknown} value */
  const isNotificationCall = (value) =>
    isRecord(value) &&
    typeof value.id === "string" &&
    hasOptionalString(value, "title") &&
    hasOptionalString(value, "message");
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
  // Mirrors WebExtensionCapabilities in src/platform/chrome-detector.ts. UNKNOWN
  // stays decodable so a detector that misfires on a host reaches the test as a
  // failed assertion naming the browser, not as an opaque decode error.
  const isInspectResult = (value) =>
    isRecord(value) &&
    typeof value.instanceId === "string" &&
    typeof value.generation === "number" &&
    typeof value.readyGeneration === "number" &&
    (value.browser === "CHROME" || value.browser === "FIREFOX" || value.browser === "UNKNOWN") &&
    (value.browserVersion === undefined || typeof value.browserVersion === "number") &&
    isRecord(value.capabilities) &&
    typeof value.capabilities.tabContextMenus === "boolean" &&
    typeof value.capabilities.downloadFilenameSuggestion === "boolean" &&
    typeof value.capabilities.downloadDeltaFilename === "boolean" &&
    typeof value.capabilities.conflictActionPrompt === "boolean" &&
    typeof value.capabilities.downloadRequestHeaders === "boolean" &&
    typeof value.capabilities.notificationButtons === "boolean" &&
    typeof value.capabilities.shortcutFileExtensions === "boolean" &&
    (value.promptConflictAction === "prompt" || value.promptConflictAction === "uniquify") &&
    typeof value.hasObjectUrl === "boolean";
  /** @param {unknown} value */
  const isDownloadLaunchResult = (value) =>
    isRecord(value) &&
    (value.status === "skipped" ||
      value.status === "failed" ||
      (value.status === "started" && typeof value.downloadId === "number"));
  /** @param {unknown} value */
  const isCommandStatus = (value) =>
    isRecord(value) &&
    (value.status === "OK" || (value.status === "ERROR" && typeof value.message === "string"));
  /** @param {unknown} value */
  const isApplyConfigBody = (value) =>
    isRecord(value) &&
    typeof value.version === "number" &&
    typeof value.instanceId === "string" &&
    typeof value.generation === "number" &&
    isRecord(value.applied) &&
    isArrayOf(
      value.rejected,
      (item) => isRecord(item) && typeof item.name === "string" && typeof item.reason === "string",
    );
  /** @param {unknown} message @param {unknown} value */
  const isRuntimeResponseFor = (message, value) => {
    if (!isRecord(message) || typeof message.type !== "string" || !isRecord(value)) return false;
    switch (message.type) {
      case "WAKE_WARM":
        return value.type === "OK" && value.body === undefined;
      case "OPTIONS_LOADED":
        return (
          value.type === "OK" &&
          isRecord(value.body) &&
          typeof value.body.instanceId === "string" &&
          typeof value.body.generation === "number"
        );
      case "OPTIONS":
        return value.type === "OPTIONS" && isRecord(value.body);
      case "HISTORY_GET":
        return (
          value.type === "HISTORY_GET" &&
          isRecord(value.body) &&
          isArrayOf(value.body.entries, isHistoryEntry)
        );
      case "HISTORY_CANCEL":
        return (
          value.type === "HISTORY_CANCEL" &&
          isRecord(value.body) &&
          typeof value.body.canceled === "boolean"
        );
      case "HISTORY_UNDO":
        return (
          value.type === "HISTORY_UNDO" &&
          isRecord(value.body) &&
          typeof value.body.undone === "boolean" &&
          typeof value.body.fileMissing === "boolean"
        );
      case "HISTORY_REROUTE":
        return (
          value.type === "HISTORY_REROUTE" &&
          isRecord(value.body) &&
          typeof value.body.rerouted === "boolean" &&
          typeof value.body.oldRemoved === "boolean" &&
          (value.body.newHistoryId === undefined || typeof value.body.newHistoryId === "string")
        );
      case "EXTERNAL_DOWNLOAD_REJECTIONS_GET":
        return (
          value.type === "EXTERNAL_DOWNLOAD_REJECTIONS_GET" &&
          isRecord(value.body) &&
          isArrayOf(value.body.rejections, isExternalDownloadRejection)
        );
      case "EXTERNAL_DOWNLOAD_REJECTION_CLEAR":
        return value.type === "OK" && value.body === undefined;
      case "DOWNLOAD":
        return (
          value.type === "DOWNLOAD" &&
          isRecord(value.body) &&
          typeof value.body.version === "number" &&
          (value.body.status === "OK"
            ? typeof value.body.url === "string"
            : value.body.status === "ERROR" &&
              typeof value.body.error === "string" &&
              hasOptionalString(value.body, "message"))
        );
      case "SAVE_IN_E2E_START_DOWNLOAD":
        return (
          value.type === message.type &&
          isRecord(value.body) &&
          isCommandStatus(value.body) &&
          (value.body.status !== "OK" || isDownloadLaunchResult(value.body.result)) &&
          (value.body.code === undefined ||
            (value.body.code === "STALE_GENERATION" &&
              typeof value.body.instanceId === "string" &&
              typeof value.body.generation === "number"))
        );
      case "SAVE_IN_E2E_CONTEXT_MENU_CLICK":
      case "SAVE_IN_E2E_TAB_MENU_CLICK":
      case "SAVE_IN_E2E_HISTORY_WRITE":
      case "SAVE_IN_E2E_RESET_STATE":
        return value.type === message.type && isCommandStatus(value.body);
      case "SAVE_IN_E2E_NOTIFICATION_CALLS":
        return (
          value.type === message.type &&
          isRecord(value.body) &&
          isCommandStatus(value.body) &&
          (value.body.status !== "OK" || isArrayOf(value.body.calls, isNotificationCall))
        );
      case "APPLY_CONFIG":
        return value.type === "APPLY_CONFIG_RESULT" && isApplyConfigBody(value.body);
      default:
        return false;
    }
  };
  /** @param {string} name @param {unknown} value */
  const isOptionValue = (name, value) =>
    name === "contentClickToSaveCombo"
      ? typeof value === "string" || typeof value === "number"
      : name === "contentClickToSaveBindings"
        ? typeof value === "string"
        : name === "notifyDuration" || name === "autoDownloadMaxPerPage"
          ? typeof value === "number"
          : name === "paths" || name === "setRefererHeaderFilter" || name === "quickSaveDirectory"
            ? typeof value === "string"
            : name === "shortcutType"
              ? typeof value === "string" &&
                ["HTML_REDIRECT", "MAC", "MAC_WEBLOC", "FREEDESKTOP", "WINDOWS"].includes(value)
              : typeof value === "boolean";

  return {
    isArrayOf,
    isDownload,
    isHistoryEntry,
    isInspectResult,
    isLog,
    isMenuBody,
    isNotificationCall,
    isOptionValue,
    isRecord,
    isRule,
    isRuntimeMessage,
    isRuntimeResponse,
    isRuntimeResponseFor,
    isStringArray,
    isTab,
    isWindow,
  };
};
