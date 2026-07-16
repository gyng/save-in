import { decodeControlResult, decodeOptionValue } from "./control-codecs.mjs";
import { createProtocolCodecs } from "./protocol-codecs.mjs";

/** @typedef {import("./control-protocol.mjs").ControlOperation} ControlOperation */
/** @typedef {import("./control-protocol.mjs").ControlRequest} ControlRequest */
/** @typedef {import("./control-protocol.mjs").ContextMenuClickBody} ContextMenuClickBody */
/** @typedef {import("./control-protocol.mjs").DownloadEntry} DownloadEntry */
/** @typedef {import("./control-protocol.mjs").E2ERuntimeOptionName} E2ERuntimeOptionName */
/** @typedef {import("./control-protocol.mjs").E2ERuntimeOptionValues} E2ERuntimeOptionValues */
/** @typedef {import("./control-protocol.mjs").LogEntry} LogEntry */
/** @typedef {import("./control-protocol.mjs").StoredOptionsPatch} StoredOptionsPatch */
/** @typedef {import("./control-protocol.mjs").RuntimeMessage} RuntimeMessage */
/** @typedef {import("./control-protocol.mjs").StartDownloadBody} StartDownloadBody */
/** @typedef {import("./control-protocol.mjs").TabMenuClickBody} TabMenuClickBody */

/**
 * Runs in the extension Options page. Keep this function self-contained: CDP
 * and BiDi serialize it into the target realm and pass only JSON arguments.
 *
 * @param {string} serializedRequest
 * @param {ReturnType<typeof createProtocolCodecs>} [codecs]
 */
export const dispatchControlRequest = async (
  serializedRequest,
  codecs = createProtocolCodecs(),
) => {
  const { isRecord, isRuntimeMessage, isStringArray } = codecs;
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalString = (value, key) =>
    value[key] === undefined || typeof value[key] === "string";
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalPositiveInteger = (value, key) =>
    value[key] === undefined ||
    (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] > 0);
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalTimeout = (value, key) =>
    value[key] === undefined ||
    (typeof value[key] === "number" &&
      Number.isSafeInteger(value[key]) &&
      value[key] > 0 &&
      value[key] <= 300_000);
  /** @param {Record<string, unknown>} value @param {string} key */
  const hasOptionalNonnegativeInteger = (value, key) =>
    value[key] === undefined ||
    (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0);
  /** @param {unknown} value @returns {value is ControlRequest} */
  const isControlRequest = (value) => {
    if (!isRecord(value) || typeof value.operation !== "string") return false;
    const isArea = value.area === "local" || value.area === "session";
    switch (value.operation) {
      case "runtime.send":
        return isRuntimeMessage(value.message);
      case "runtime.download":
        return (
          typeof value.content === "string" &&
          (value.info === undefined || isRecord(value.info)) &&
          hasOptionalString(value, "comment")
        );
      case "options.waitReady":
        return hasOptionalTimeout(value, "timeoutMs");
      case "storage.get":
        return (
          isArea &&
          (value.keys === undefined ||
            value.keys === null ||
            typeof value.keys === "string" ||
            isStringArray(value.keys) ||
            isRecord(value.keys))
        );
      case "storage.set":
        return isArea && isRecord(value.values);
      case "storage.wait":
        return isArea && typeof value.key === "string" && hasOptionalTimeout(value, "timeoutMs");
      case "storage.remove":
        return isArea && (typeof value.keys === "string" || isStringArray(value.keys));
      case "storage.clear":
        return isArea;
      case "downloads.search":
      case "downloads.erase":
      case "tabs.query":
        return value.query === undefined || isRecord(value.query);
      case "downloads.wait":
        return (
          [value.filenameRegex, value.filenameIncludes, value.url].filter(
            (selector) => typeof selector === "string" && selector.length > 0,
          ).length === 1 &&
          hasOptionalString(value, "filenameRegex") &&
          hasOptionalString(value, "filenameIncludes") &&
          hasOptionalString(value, "url") &&
          hasOptionalPositiveInteger(value, "minimumComplete") &&
          hasOptionalTimeout(value, "timeoutMs")
        );
      case "downloads.cancel":
      case "tabs.reload":
        return typeof value.id === "number";
      case "tabs.create":
        return isRecord(value.properties);
      case "tabs.update":
        return typeof value.id === "number" && isRecord(value.properties);
      case "tabs.wait":
        return (
          (typeof value.id === "number" ||
            (typeof value.urlIncludes === "string" && value.urlIncludes.length > 0)) &&
          hasOptionalString(value, "status") &&
          hasOptionalTimeout(value, "timeoutMs")
        );
      case "tabs.remove":
        return (
          typeof value.ids === "number" ||
          (Array.isArray(value.ids) && value.ids.every((id) => typeof id === "number"))
        );
      case "tabs.sendMessage":
        return typeof value.id === "number" && isRecord(value.message);
      case "windows.create":
        return isRecord(value.properties);
      case "windows.remove":
        return typeof value.id === "number";
      case "notifications.clear":
        return typeof value.id === "string";
      case "dnr.updateSessionRules":
        return isRecord(value.update);
      case "logs.wait":
        return (
          isStringArray(value.messages) &&
          value.messages.length > 0 &&
          value.messages.every((message) => message.length > 0) &&
          hasOptionalNonnegativeInteger(value, "baseline") &&
          hasOptionalTimeout(value, "timeoutMs")
        );
      case "history.wait":
        return (
          [value.id, value.url, value.status, value.finalFullPath, value.context].some(
            (selector) => typeof selector === "string" && selector.length > 0,
          ) &&
          ["id", "url", "status", "finalFullPath", "context"].every((key) =>
            hasOptionalString(value, key),
          ) &&
          hasOptionalPositiveInteger(value, "minimum") &&
          hasOptionalTimeout(value, "timeoutMs")
        );
      case "harness.resetCase":
        return value.snapshot === undefined || isRecord(value.snapshot);
      case "notifications.getAll":
      case "dnr.getSessionRules":
      case "offscreen.hasDocument":
      case "logs.get":
      case "inspect":
        return true;
      default:
        return false;
    }
  };
  const parsedRequest = /** @type {unknown} */ (JSON.parse(serializedRequest));
  if (!isControlRequest(parsedRequest)) throw new Error("Invalid E2E control request");
  const request = parsedRequest;
  const chromeApi = /** @type {typeof chrome} */ (Reflect.get(globalThis, "chrome"));
  const browserApi = /** @type {typeof chrome} */ (
    /** @type {unknown} */ (Reflect.get(globalThis, "browser") || chromeApi)
  );
  /** @param {RuntimeMessage} message */
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

  /** @param {{filenameRegex?: string, filenameIncludes?: string, url?: string, minimumComplete?: number, timeoutMs?: number}} match */
  const waitForDownload = ({
    filenameRegex,
    filenameIncludes,
    url,
    minimumComplete = 1,
    timeoutMs = 8000,
  }) =>
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
        if (lastRows.filter((entry) => entry.state === "complete").length >= minimumComplete) {
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

  /** @param {"local" | "session"} area @param {string} key @param {unknown} expected @param {number} timeoutMs */
  const waitForStorage = (area, key, expected, timeoutMs) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      let settled = false;
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        browserApi.storage.onChanged.removeListener(onChanged);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = async () => {
        const stored = await storageArea(area).get(key);
        if (Object.is(stored[key], expected)) finish(() => resolve(stored[key]));
      };
      /** @param {Record<string, chrome.storage.StorageChange>} changes @param {string} changedArea */
      const onChanged = (changes, changedArea) => {
        if (changedArea === area && Object.is(changes[key]?.newValue, expected)) {
          finish(() => resolve(changes[key]?.newValue));
        }
      };
      const onTimeout = () =>
        finish(() => reject(new Error(`Timed out waiting for ${area} storage key: ${key}`)));
      browserApi.storage.onChanged.addListener(onChanged);
      timeout.addEventListener("abort", onTimeout, { once: true });
      void check().catch((error) => finish(() => reject(error)));
    });

  /** @param {{id?: number, urlIncludes?: string, status?: string, timeoutMs?: number}} match */
  const waitForTab = ({ id, urlIncludes, status = "complete", timeoutMs = 8000 }) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      let settled = false;
      /** @type {chrome.tabs.Tab | undefined} */
      let lastTab;
      /** @param {chrome.tabs.Tab} tab */
      const matches = (tab) =>
        (id === undefined || tab.id === id) &&
        (urlIncludes === undefined || tab.url?.includes(urlIncludes)) &&
        (status === undefined || tab.status === status);
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        browserApi.tabs.onUpdated.removeListener(onUpdated);
        browserApi.tabs.onCreated.removeListener(onCreated);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = async () => {
        const tabs =
          id === undefined ? await browserApi.tabs.query({}) : [await browserApi.tabs.get(id)];
        lastTab =
          tabs.find(matches) ??
          tabs.find((tab) =>
            id === undefined ? tab.url?.includes(urlIncludes ?? "") : tab.id === id,
          );
        if (lastTab && matches(lastTab)) finish(() => resolve(lastTab));
      };
      const onUpdated = () => void check().catch((error) => finish(() => reject(error)));
      const onCreated = () => void check().catch((error) => finish(() => reject(error)));
      const onTimeout = () =>
        finish(() =>
          reject(
            new Error(
              `Timed out waiting for tab: ${JSON.stringify({ id, urlIncludes, status, lastTab })}`,
            ),
          ),
        );
      browserApi.tabs.onUpdated.addListener(onUpdated);
      browserApi.tabs.onCreated.addListener(onCreated);
      timeout.addEventListener("abort", onTimeout, { once: true });
      void check().catch((error) => finish(() => reject(error)));
    });

  /** @param {number} timeoutMs */
  const waitForOptionsReady = (timeoutMs) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const root = document.documentElement;
      let settled = false;
      /** @type {MutationObserver | undefined} */
      let observer;
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        document.removeEventListener("readystatechange", check);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = () => {
        if (
          document.readyState === "complete" &&
          Boolean(browserApi.runtime?.id) &&
          Boolean(document.querySelector("#autocomplete-paths")) &&
          document.querySelector("#paths")?.getAttribute("aria-busy") === "false" &&
          document.querySelector("#filenamePatterns")?.getAttribute("aria-busy") === "false"
        ) {
          finish(() => resolve(true));
        }
      };
      const onTimeout = () => finish(() => reject(new Error("Timed out waiting for Options UI")));
      document.addEventListener("readystatechange", check);
      timeout.addEventListener("abort", onTimeout, { once: true });
      if (root) {
        observer = new MutationObserver(check);
        observer.observe(root, { attributes: true, childList: true, subtree: true });
      }
      check();
    });

  const readLogs = async () => {
    const stored = await browserApi.storage.session.get("si-log");
    return Array.isArray(stored["si-log"]) ? /** @type {LogEntry[]} */ (stored["si-log"]) : [];
  };

  const readHistory = async () => {
    const response = await send({ type: "HISTORY_GET" });
    return response.body.entries;
  };

  /** @param {{id?: string, url?: string, status?: string, finalFullPath?: string, context?: string, minimum?: number, timeoutMs?: number}} match */
  const waitForHistory = ({
    id,
    url,
    status,
    finalFullPath,
    context,
    minimum = 1,
    timeoutMs = 8000,
  }) =>
    new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      let settled = false;
      /** @type {import("./control-protocol.mjs").HistoryEntry[]} */
      let lastEntries = [];
      /** @param {import("./control-protocol.mjs").HistoryEntry} entry */
      const matches = (entry) =>
        (id === undefined || entry.id === id) &&
        (url === undefined || entry.url === url) &&
        (status === undefined || entry.status === status) &&
        (finalFullPath === undefined || entry.finalFullPath === finalFullPath) &&
        (context === undefined || entry.info?.context === context);
      /** @param {() => void} callback */
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        browserApi.storage.onChanged.removeListener(onChanged);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = async () => {
        lastEntries = (await readHistory()).filter(matches);
        if (lastEntries.length >= minimum) finish(() => resolve(lastEntries));
      };
      /** @param {Record<string, chrome.storage.StorageChange>} changes @param {string} area */
      const onChanged = (changes, area) => {
        if (area === "local" && changes["save-in-history"]) {
          void check().catch((error) => finish(() => reject(error)));
        }
      };
      const onTimeout = () =>
        finish(() =>
          reject(new Error(`Timed out waiting for history entry: ${JSON.stringify(lastEntries)}`)),
        );
      browserApi.storage.onChanged.addListener(onChanged);
      timeout.addEventListener("abort", onTimeout, { once: true });
      void check().catch((error) => finish(() => reject(error)));
    });

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
    /** @type {number | undefined} */
    let retainedTabId;
    await Promise.all([
      attempt("tabs", async () => {
        const [current, tabs] = await Promise.all([
          browserApi.tabs.getCurrent(),
          browserApi.tabs.query({}),
        ]);
        const keep = current?.id ?? tabs.find((tab) => tab.url?.startsWith(optionsUrl))?.id;
        retainedTabId = keep;
        const remove = tabs.flatMap((tab) =>
          tab.id !== undefined && tab.id !== keep ? [tab.id] : [],
        );
        await Promise.all(remove.map((id) => browserApi.tabs.remove(id).catch(() => {})));
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
        if (browserApi.notifications?.getAll) {
          const notifications = await browserApi.notifications.getAll();
          await Promise.all(
            Object.keys(notifications).map((id) => browserApi.notifications.clear(id)),
          );
        }
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
    await attempt("background state", async () => {
      const response = await send({ type: "SAVE_IN_E2E_RESET_STATE" });
      if (response.body.status === "ERROR") throw new Error(response.body.message);
    });
    await attempt("offscreen document", async () => {
      if (!chromeApi.offscreen?.hasDocument || !chromeApi.offscreen.closeDocument) return;
      if (!(await chromeApi.offscreen.hasDocument())) return;
      try {
        await chromeApi.offscreen.closeDocument();
      } catch (error) {
        if (await chromeApi.offscreen.hasDocument()) throw error;
      }
    });
    await attempt("session storage", () => browserApi.storage.session?.clear?.());
    if (snapshot) {
      await attempt("local storage", async () => {
        await browserApi.storage.local.clear();
        await browserApi.storage.local.set(snapshot);
      });
    }
    await attempt("runtime reset", () => send({ type: "OPTIONS_LOADED" }));
    await attempt("post-reset verification", async () => {
      const [downloads, tabs, session, notifications, rules, hasOffscreenDocument] =
        await Promise.all([
          browserApi.downloads.search({}),
          browserApi.tabs.query({}),
          browserApi.storage.session?.get?.(null) ?? Promise.resolve({}),
          browserApi.notifications?.getAll?.() ?? Promise.resolve({}),
          browserApi.declarativeNetRequest?.getSessionRules?.() ?? Promise.resolve([]),
          chromeApi.offscreen?.hasDocument?.() ?? Promise.resolve(false),
        ]);
      const unexpectedTabs = tabs.filter((tab) => tab.id !== retainedTabId);
      const unexpectedSessionKeys = Object.keys(session).filter(
        (key) => key !== "siDiagnosticLifecycle",
      );
      const dirty = {
        ...(downloads.length ? { downloadIds: downloads.map(({ id }) => id) } : {}),
        ...(unexpectedTabs.length
          ? { tabs: unexpectedTabs.map(({ id, title, url }) => ({ id, title, url })) }
          : {}),
        ...(unexpectedSessionKeys.length ? { sessionKeys: unexpectedSessionKeys } : {}),
        ...(Object.keys(notifications).length
          ? { notificationIds: Object.keys(notifications) }
          : {}),
        ...(rules.length ? { sessionRuleIds: rules.map(({ id }) => id) } : {}),
        ...(hasOffscreenDocument ? { offscreenDocument: true } : {}),
      };
      if (Object.keys(dirty).length) {
        throw new Error(`Case state remained after reset: ${JSON.stringify(dirty)}`);
      }
    });
    if (failures.length) throw new Error(failures.join("\n---\n"));
    return true;
  };

  try {
    let result;
    switch (request.operation) {
      case "runtime.send":
        result = await send(request.message);
        break;
      case "runtime.download": {
        const url = URL.createObjectURL(new Blob([request.content]));
        result = await send({
          type: "DOWNLOAD",
          body: {
            url,
            ...(request.info === undefined ? {} : { info: request.info }),
            ...(request.comment === undefined ? {} : { comment: request.comment }),
          },
        });
        break;
      }
      case "options.waitReady":
        result = await waitForOptionsReady(request.timeoutMs ?? 8000);
        break;
      case "storage.get":
        result = await storageArea(request.area).get(request.keys ?? null);
        break;
      case "storage.set":
        await storageArea(request.area).set(request.values);
        result = true;
        break;
      case "storage.wait":
        result = await waitForStorage(
          request.area,
          request.key,
          request.expected,
          request.timeoutMs ?? 8000,
        );
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
      case "tabs.wait":
        result = await waitForTab(request);
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
      case "windows.create":
        result = await browserApi.windows.create(request.properties);
        break;
      case "windows.remove":
        result = await browserApi.windows.remove(request.id);
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
      case "history.wait":
        result = await waitForHistory(request);
        break;
      case "harness.resetCase":
        result = await resetCase(request.snapshot);
        break;
      case "inspect": {
        // The bundle answers this. Restating chrome-detector.ts here would
        // check the harness against itself, and would report the control
        // page's DOM rather than the background's — the Chrome service
        // worker's missing `URL.createObjectURL` is invisible from this side.
        const inspected = await send({ type: "SAVE_IN_E2E_INSPECT" });
        if (!inspected?.body || inspected.body.status !== "OK") {
          throw new Error(`E2E inspect failed: ${inspected?.body?.message ?? "no response"}`);
        }
        result = inspected.body.state;
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

const CONTROL_FUNCTION = `(async (serializedRequest) => {
  const createProtocolCodecs = ${createProtocolCodecs.toString()};
  return (${dispatchControlRequest.toString()})(serializedRequest, createProtocolCodecs());
})`;

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
   * @template {ControlRequest} Request
   * @param {Request} request
   * @param {number} [timeoutMs]
   * @returns {Promise<import("./control-protocol.mjs").ControlResult<Request>>}
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
    return decodeControlResult(request, response.value);
  };

  /** @param {"local" | "session"} name */
  const area = (name) => ({
    /** @param {string | string[] | Record<string, unknown> | null} [keys] */
    get: (keys = null) => call({ operation: "storage.get", area: name, keys }),
    /** @param {Record<string, unknown>} values */
    set: (values) => call({ operation: "storage.set", area: name, values }),
    /** @param {string} key @param {unknown} expected @param {number} [timeoutMs] */
    wait: (key, expected, timeoutMs) =>
      call(
        {
          operation: "storage.wait",
          area: name,
          key,
          expected,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        (timeoutMs ?? 8000) + 2000,
      ),
    /** @param {string | string[]} keys */
    remove: (keys) => call({ operation: "storage.remove", area: name, keys }),
    clear: () => call({ operation: "storage.clear", area: name }),
  });

  return {
    call,
    metrics: () => ({ structuredCalls: calls }),
    runtime: {
      /**
       * @template {RuntimeMessage} Message
       * @param {Message} message
       * @param {number} [timeoutMs]
       * @returns {Promise<import("./control-protocol.mjs").RuntimeResponseFor<Message>>}
       */
      send: (message, timeoutMs) => call({ operation: "runtime.send", message }, timeoutMs),
      ready: () => call({ operation: "runtime.send", message: { type: "WAKE_WARM" } }),
      reset: () => call({ operation: "runtime.send", message: { type: "OPTIONS_LOADED" } }),
    },
    storage: { local: area("local"), session: area("session") },
    downloads: {
      /** @param {chrome.downloads.DownloadQuery} [query] */
      search: (query = {}) => call({ operation: "downloads.search", query }),
      /** @param {{filenameRegex?: string, filenameIncludes?: string, url?: string, minimumComplete?: number, timeoutMs?: number}} match */
      wait: (match) =>
        call({ operation: "downloads.wait", ...match }, (match.timeoutMs ?? 8000) + 2000),
      /** @param {number} id */
      cancel: (id) => call({ operation: "downloads.cancel", id }),
      /** @param {chrome.downloads.DownloadQuery} [query] */
      erase: (query = {}) => call({ operation: "downloads.erase", query }),
    },
    tabs: {
      /** @param {chrome.tabs.QueryInfo} [query] */
      query: (query = {}) => call({ operation: "tabs.query", query }),
      /** @param {chrome.tabs.CreateProperties} properties */
      create: (properties) => call({ operation: "tabs.create", properties }),
      /** @param {number} id @param {chrome.tabs.UpdateProperties} properties */
      update: (id, properties) => call({ operation: "tabs.update", id, properties }),
      /** @param {{id?: number, urlIncludes?: string, status?: string, timeoutMs?: number}} match */
      wait: (match) => call({ operation: "tabs.wait", ...match }, (match.timeoutMs ?? 8000) + 2000),
      /** @param {number} id */
      reload: (id) => call({ operation: "tabs.reload", id }),
      /** @param {number | number[]} ids */
      remove: (ids) => call({ operation: "tabs.remove", ids }),
      /** @param {number} id @param {Record<string, unknown>} message */
      sendMessage: (id, message) => call({ operation: "tabs.sendMessage", id, message }),
    },
    windows: {
      /** @param {chrome.windows.CreateData} properties */
      create: (properties) => call({ operation: "windows.create", properties }),
      /** @param {number} id */
      remove: (id) => call({ operation: "windows.remove", id }),
    },
    notifications: {
      getAll: () => call({ operation: "notifications.getAll" }),
      /** @param {string} id */
      clear: (id) => call({ operation: "notifications.clear", id }),
    },
    dnr: {
      getSessionRules: () => call({ operation: "dnr.getSessionRules" }),
      /** @param {chrome.declarativeNetRequest.UpdateRuleOptions} update */
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
      /** @param {number} [timeoutMs] */
      waitReady: (timeoutMs) =>
        call(
          {
            operation: "options.waitReady",
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          },
          (timeoutMs ?? 8000) + 2000,
        ),
      all: async () => {
        const response = await call({ operation: "runtime.send", message: { type: "OPTIONS" } });
        return response.body;
      },
      /** @template {E2ERuntimeOptionName} Name @param {Name} name @returns {Promise<E2ERuntimeOptionValues[Name]>} */
      get: async (name) => {
        const response = await call({ operation: "runtime.send", message: { type: "OPTIONS" } });
        return decodeOptionValue(name, response.body[name]);
      },
      /** @param {StoredOptionsPatch} values */
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
        return response.body.entries;
      },
      /** @param {{id?: string, url?: string, status?: string, finalFullPath?: string, context?: string, minimum?: number, timeoutMs?: number}} match */
      wait: (match) =>
        call({ operation: "history.wait", ...match }, (match.timeoutMs ?? 8000) + 2000),
    },
    background: {
      /** @param {string} content @param {Record<string, unknown>} [info] @param {string} [comment] */
      downloadMessage: (content, info, comment) =>
        call({
          operation: "runtime.download",
          content,
          ...(info === undefined ? {} : { info }),
          ...(comment === undefined ? {} : { comment }),
        }),
      /** @param {StartDownloadBody} body */
      startDownload: async (body) => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "SAVE_IN_E2E_START_DOWNLOAD", body },
        });
        if (response.body.status === "ERROR") throw new Error(response.body.message);
        return response.body.result;
      },
      /** @param {ContextMenuClickBody} body */
      clickContextMenu: async (body) => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK", body },
        });
        if (response.body.status === "ERROR") throw new Error(response.body.message);
        return response.body;
      },
      /** @param {TabMenuClickBody} body */
      clickTabMenu: async (body) => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "SAVE_IN_E2E_TAB_MENU_CLICK", body },
        });
        if (response.body.status === "ERROR") throw new Error(response.body.message);
        return response.body;
      },
      /** @param {"get" | "reset"} action */
      notificationCalls: async (action) => {
        const response = await call({
          operation: "runtime.send",
          message: { type: "SAVE_IN_E2E_NOTIFICATION_CALLS", body: { action } },
        });
        if (response.body.status === "ERROR") throw new Error(response.body.message);
        return response.body.calls;
      },
      /** @param {string} id @param {number} [timeoutMs] */
      waitForNotification: async (id, timeoutMs) => {
        const response = await call(
          {
            operation: "runtime.send",
            message: {
              type: "SAVE_IN_E2E_NOTIFICATION_CALLS",
              body: {
                action: "wait",
                id,
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
              },
            },
          },
          (timeoutMs ?? 8000) + 2000,
        );
        if (response.body.status === "ERROR") throw new Error(response.body.message);
        const notification = response.body.calls.find((candidate) => candidate.id === id);
        if (!notification) throw new Error(`Notification wait completed without ${id}`);
        return notification;
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
