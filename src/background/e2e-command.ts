import { CONFLICT_ACTION, SHORTCUT_TYPES, type ConflictAction } from "../shared/constants.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import {
  CURRENT_BROWSER,
  CURRENT_BROWSER_VERSION,
  WEB_EXTENSION_CAPABILITIES,
  type WebExtensionCapabilities,
} from "../platform/chrome-detector.ts";
import { launchDownload, makeObjectUrl } from "../downloads/download.ts";
import type { DownloadInfo, DownloadLaunchResult } from "../downloads/download-types.ts";
import { resetActiveTransfers } from "../downloads/active-transfers.ts";
import {
  resetNotificationRecoveryState,
  resetNotifierTransientState,
} from "../downloads/notification.ts";
import { downloadsState, sessionWriteState } from "../downloads/download-state-instances.ts";
import { makeShortcut } from "../downloads/shortcut.ts";
import { Path } from "../routing/path.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import { backgroundRuntime } from "./runtime.ts";
import { handleContextMenuClick, type ContextMenuClickInfo } from "./menu-click.ts";
import { handleTabMenuClick, type HostTab, type TabMenuClickInfo } from "./menu-tabs.ts";
import { configWriteState, counterWriteState } from "./application-state.ts";
import { resetMessagingTransientState } from "./messaging/index.ts";
import { resetSourcePanelState } from "./source-panel-state.ts";
import { resetRefererRules } from "../downloads/referer-rules.ts";
import { addHistoryEntry, clearHistory, patchHistoryEntry } from "./history.ts";
import { applyConfigSerialized } from "./config-apply.ts";

export const BACKGROUND_E2E_COMMAND = "SAVE_IN_E2E_START_DOWNLOAD";
export const BACKGROUND_E2E_CONTEXT_MENU_COMMAND = "SAVE_IN_E2E_CONTEXT_MENU_CLICK";
export const BACKGROUND_E2E_NOTIFICATION_COMMAND = "SAVE_IN_E2E_NOTIFICATION_CALLS";
export const BACKGROUND_E2E_HISTORY_COMMAND = "SAVE_IN_E2E_HISTORY_WRITE";
const BACKGROUND_E2E_TAB_MENU_COMMAND = "SAVE_IN_E2E_TAB_MENU_CLICK";
export const BACKGROUND_E2E_RESET_COMMAND = "SAVE_IN_E2E_RESET_STATE";
const BACKGROUND_E2E_INSPECT_COMMAND = "SAVE_IN_E2E_INSPECT";

export type BackgroundE2EDownload = {
  path?: string;
  content?: string;
  url?: string;
  shortcutUrl?: string;
  suggestedFilename: string;
  pageUrl?: string;
  modifiers?: string[];
  config?: Record<string, unknown>;
  expectedGeneration?: { instanceId: string; generation: number };
};

export type BackgroundE2ECommandRequest = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body: BackgroundE2EDownload;
};

export type BackgroundE2EContextMenuRequest = {
  type: typeof BACKGROUND_E2E_CONTEXT_MENU_COMMAND;
  body: {
    info: ContextMenuClickInfo;
    tab?: Pick<CurrentTab, "id" | "windowId" | "title" | "url" | "incognito"> | undefined;
  };
};

export type BackgroundE2ENotificationRequest = {
  type: typeof BACKGROUND_E2E_NOTIFICATION_COMMAND;
  body:
    | { action: "get" }
    | { action: "reset" }
    | { action: "wait"; id: string; timeoutMs?: number };
};

export type BackgroundE2EHistoryRequest = {
  type: typeof BACKGROUND_E2E_HISTORY_COMMAND;
  body: { action: "clear" } | { action: "add-and-patch"; index: number; payload: string };
};

export type BackgroundE2ETabMenuRequest = {
  type: typeof BACKGROUND_E2E_TAB_MENU_COMMAND;
  body: { info: TabMenuClickInfo; tab: HostTab };
};

export type BackgroundE2EResetRequest = {
  type: typeof BACKGROUND_E2E_RESET_COMMAND;
};

export type BackgroundE2EInspectRequest = {
  type: typeof BACKGROUND_E2E_INSPECT_COMMAND;
};

export type BackgroundE2EInspectState = {
  instanceId: string;
  generation: number;
  readyGeneration: number;
  browser: string;
  browserVersion?: number;
  capabilities: WebExtensionCapabilities;
  promptConflictAction: ConflictAction;
  hasObjectUrl: boolean;
};

export type BackgroundE2EInspectResponse = {
  type: typeof BACKGROUND_E2E_INSPECT_COMMAND;
  body: { status: "OK"; state: BackgroundE2EInspectState } | { status: "ERROR"; message: string };
};

export type BackgroundE2ENotificationCall = {
  id: string;
  title?: string;
  message?: string;
};

export type BackgroundE2ECommandResponse = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body:
    | { status: "OK"; result: DownloadLaunchResult }
    | { status: "ERROR"; message: string; code?: undefined }
    | {
        status: "ERROR";
        code: "STALE_GENERATION";
        message: string;
        instanceId: string;
        generation: number;
      };
};

export type BackgroundE2EContextMenuResponse = {
  type: typeof BACKGROUND_E2E_CONTEXT_MENU_COMMAND;
  body: { status: "OK" } | { status: "ERROR"; message: string };
};

export type BackgroundE2ENotificationResponse = {
  type: typeof BACKGROUND_E2E_NOTIFICATION_COMMAND;
  body:
    | { status: "OK"; calls: BackgroundE2ENotificationCall[] }
    | { status: "ERROR"; message: string };
};

export type BackgroundE2EHistoryResponse = {
  type: typeof BACKGROUND_E2E_HISTORY_COMMAND;
  body: { status: "OK" } | { status: "ERROR"; message: string };
};

export type BackgroundE2ETabMenuResponse = {
  type: typeof BACKGROUND_E2E_TAB_MENU_COMMAND;
  body: { status: "OK" } | { status: "ERROR"; message: string };
};

export type BackgroundE2EResetResponse = {
  type: typeof BACKGROUND_E2E_RESET_COMMAND;
  body: { status: "OK" } | { status: "ERROR"; message: string };
};

const notificationCalls: BackgroundE2ENotificationCall[] = [];
const notificationWaiters = new Set<{
  id: string;
  resolve: (response: BackgroundE2ENotificationResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
let notificationObserverInstalled = false;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const hasOptionalString = (value: Record<string, unknown>, key: string): boolean =>
  !(key in value) || typeof value[key] === "string";

const hasOptionalNumber = (value: Record<string, unknown>, key: string): boolean =>
  !(key in value) || typeof value[key] === "number";

const hasOptionalPositiveInteger = (value: Record<string, unknown>, key: string): boolean =>
  !(key in value) ||
  (typeof value[key] === "number" &&
    Number.isSafeInteger(value[key]) &&
    value[key] > 0 &&
    value[key] <= 300_000);

const hasOptionalBoolean = (value: Record<string, unknown>, key: string): boolean =>
  !(key in value) || typeof value[key] === "boolean";

const hasOptionalStringArray = (value: Record<string, unknown>, key: string): boolean =>
  !(key in value) ||
  (Array.isArray(value[key]) && value[key].every((item) => typeof item === "string"));

const isBackgroundE2ECommand = (value: unknown): value is BackgroundE2ECommandRequest => {
  if (!isRecord(value) || value.type !== BACKGROUND_E2E_COMMAND || !isRecord(value.body)) {
    return false;
  }
  const body = value.body;
  return (
    typeof body.suggestedFilename === "string" &&
    ["path", "content", "url", "shortcutUrl", "pageUrl"].every((key) =>
      hasOptionalString(body, key),
    ) &&
    hasOptionalStringArray(body, "modifiers") &&
    (body.config === undefined || isRecord(body.config)) &&
    (body.expectedGeneration === undefined ||
      (isRecord(body.expectedGeneration) &&
        typeof body.expectedGeneration.instanceId === "string" &&
        typeof body.expectedGeneration.generation === "number" &&
        Number.isSafeInteger(body.expectedGeneration.generation) &&
        body.expectedGeneration.generation > 0))
  );
};

const isBackgroundE2EContextMenuInfo = (value: unknown): value is ContextMenuClickInfo =>
  isRecord(value) &&
  (typeof value.menuItemId === "string" || typeof value.menuItemId === "number") &&
  ["frameUrl", "mediaType", "srcUrl", "linkUrl", "pageUrl", "selectionText", "linkText"].every(
    (key) => hasOptionalString(value, key),
  ) &&
  hasOptionalStringArray(value, "modifiers");

const isBackgroundE2EContextMenuTab = (
  value: unknown,
): value is Pick<CurrentTab, "id" | "windowId" | "title" | "url" | "incognito"> =>
  isRecord(value) &&
  hasOptionalNumber(value, "id") &&
  hasOptionalNumber(value, "windowId") &&
  ["title", "url"].every((key) => hasOptionalString(value, key)) &&
  hasOptionalBoolean(value, "incognito");

const isBackgroundE2EContextMenuCommand = (
  value: unknown,
): value is BackgroundE2EContextMenuRequest =>
  isRecord(value) &&
  value.type === BACKGROUND_E2E_CONTEXT_MENU_COMMAND &&
  isRecord(value.body) &&
  isBackgroundE2EContextMenuInfo(value.body.info) &&
  (value.body.tab === undefined || isBackgroundE2EContextMenuTab(value.body.tab));

const isBackgroundE2ENotificationCommand = (
  value: unknown,
): value is BackgroundE2ENotificationRequest =>
  isRecord(value) &&
  value.type === BACKGROUND_E2E_NOTIFICATION_COMMAND &&
  isRecord(value.body) &&
  (value.body.action === "get" ||
    value.body.action === "reset" ||
    (value.body.action === "wait" &&
      typeof value.body.id === "string" &&
      value.body.id.length > 0 &&
      hasOptionalPositiveInteger(value.body, "timeoutMs")));

const isBackgroundE2EHistoryCommand = (value: unknown): value is BackgroundE2EHistoryRequest =>
  isRecord(value) &&
  value.type === BACKGROUND_E2E_HISTORY_COMMAND &&
  isRecord(value.body) &&
  (value.body.action === "clear" ||
    (value.body.action === "add-and-patch" &&
      typeof value.body.index === "number" &&
      Number.isSafeInteger(value.body.index) &&
      value.body.index >= 0 &&
      value.body.index <= 10_000 &&
      typeof value.body.payload === "string" &&
      value.body.payload.length <= 4096));

const isBackgroundE2ETabMenuCommand = (value: unknown): value is BackgroundE2ETabMenuRequest =>
  isRecord(value) &&
  value.type === BACKGROUND_E2E_TAB_MENU_COMMAND &&
  isRecord(value.body) &&
  isRecord(value.body.info) &&
  (typeof value.body.info.menuItemId === "string" ||
    typeof value.body.info.menuItemId === "number") &&
  isRecord(value.body.tab) &&
  typeof value.body.tab.id === "number" &&
  typeof value.body.tab.index === "number" &&
  typeof value.body.tab.windowId === "number";

const isBackgroundE2EResetCommand = (value: unknown): value is BackgroundE2EResetRequest =>
  isRecord(value) && value.type === BACKGROUND_E2E_RESET_COMMAND && value.body === undefined;

const isBackgroundE2EInspectCommand = (value: unknown): value is BackgroundE2EInspectRequest =>
  isRecord(value) && value.type === BACKGROUND_E2E_INSPECT_COMMAND && value.body === undefined;

// The capability answers must come from inside the bundle. A harness that
// restates chrome-detector.ts checks itself and proves nothing about the
// extension: that drift is how `accessKeys` — a capability this extension has
// never had — came to be asserted true in both browsers. These read the real
// live bindings, so a detector that misfires on a host fails the suite.
// `hasObjectUrl` is likewise resolved in the real background global, which is
// the only place the Chrome service worker's missing DOM is observable.
export const handleBackgroundE2EInspectCommand = async (
  rawRequest: unknown,
): Promise<BackgroundE2EInspectResponse | null> => {
  if (!isBackgroundE2EInspectCommand(rawRequest)) return null;
  try {
    await (backgroundRuntime.ready ?? Promise.resolve()).catch(() => {});
    return {
      type: BACKGROUND_E2E_INSPECT_COMMAND,
      body: {
        status: "OK",
        state: {
          instanceId: backgroundRuntime.instanceId,
          generation: backgroundRuntime.generation,
          readyGeneration: backgroundRuntime.readyGeneration,
          browser: CURRENT_BROWSER,
          ...(CURRENT_BROWSER_VERSION === undefined
            ? {}
            : { browserVersion: CURRENT_BROWSER_VERSION }),
          capabilities: { ...WEB_EXTENSION_CAPABILITIES },
          // option-schema.ts downgrades a stored `prompt` through this same
          // binding (#89, #217); reading it here keeps the two in step.
          promptConflictAction: WEB_EXTENSION_CAPABILITIES.conflictActionPrompt
            ? CONFLICT_ACTION.PROMPT
            : CONFLICT_ACTION.UNIQUIFY,
          hasObjectUrl: typeof URL.createObjectURL === "function",
        },
      },
    };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_INSPECT_COMMAND,
      body: { status: "ERROR", message: String(error) },
    };
  }
};

const resolveDownloadUrl = (request: BackgroundE2EDownload): string => {
  if (request.shortcutUrl) {
    return makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, request.shortcutUrl);
  }
  if (request.content !== undefined) return makeObjectUrl(request.content);
  if (request.url) return request.url;
  throw new Error("E2E download requires content, url, or shortcutUrl");
};

export const handleBackgroundE2ECommand = async (
  rawRequest: unknown,
): Promise<BackgroundE2ECommandResponse | null> => {
  if (!isBackgroundE2ECommand(rawRequest)) return null;
  try {
    await (backgroundRuntime.ready ?? Promise.resolve());
    const request = rawRequest.body;
    if (
      request.expectedGeneration &&
      (request.expectedGeneration.instanceId !== backgroundRuntime.instanceId ||
        request.expectedGeneration.generation !== backgroundRuntime.readyGeneration)
    ) {
      return {
        type: BACKGROUND_E2E_COMMAND,
        body: {
          status: "ERROR",
          code: "STALE_GENERATION",
          message: "Background generation changed before the download command",
          instanceId: backgroundRuntime.instanceId,
          generation: backgroundRuntime.readyGeneration,
        },
      };
    }
    if (request.config) {
      const { rejected } = await applyConfigSerialized(
        configWriteState,
        webExtensionApi.storage.local,
        request.config,
        undefined,
        (appliedConfig) => backgroundRuntime.reset(appliedConfig),
      );
      if (rejected.length > 0) {
        return {
          type: BACKGROUND_E2E_COMMAND,
          body: {
            status: "ERROR",
            message: rejected.map((item) => `${item.name}: ${item.reason}`).join(", "),
          },
        };
      }
    }
    const info: DownloadInfo = {
      url: resolveDownloadUrl(request),
      selectedUrl: request.shortcutUrl || request.url,
      webhookEligible: true,
      suggestedFilename: request.suggestedFilename,
      pageUrl: request.pageUrl,
      modifiers: request.modifiers ?? [],
    };
    const result = await launchDownload({
      path: new Path(request.path ?? "e2e"),
      scratch: {},
      info,
    });
    return { type: BACKGROUND_E2E_COMMAND, body: { status: "OK", result } };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

export const handleBackgroundE2EContextMenuCommand = async (
  rawRequest: unknown,
  dispatch: typeof handleContextMenuClick = handleContextMenuClick,
): Promise<BackgroundE2EContextMenuResponse | null> => {
  if (!isBackgroundE2EContextMenuCommand(rawRequest)) return null;
  try {
    await dispatch(rawRequest.body.info, rawRequest.body.tab);
    return {
      type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
      body: { status: "OK" },
    };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_CONTEXT_MENU_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

export const handleBackgroundE2ENotificationCommand = (
  rawRequest: unknown,
): BackgroundE2ENotificationResponse | Promise<BackgroundE2ENotificationResponse> | null => {
  if (!isBackgroundE2ENotificationCommand(rawRequest)) return null;
  const body = rawRequest.body;
  if (body.action === "reset") {
    notificationCalls.length = 0;
    for (const waiter of notificationWaiters) {
      clearTimeout(waiter.timeout);
      notificationWaiters.delete(waiter);
      waiter.resolve({
        type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
        body: { status: "ERROR", message: "Notification wait was reset" },
      });
    }
  }
  if (body.action === "wait") {
    const { id, timeoutMs = 8000 } = body;
    const existing = notificationCalls.find((call) => call.id === id);
    if (existing) {
      return {
        type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
        body: { status: "OK", calls: [structuredClone(existing)] },
      };
    }
    return new Promise((resolve) => {
      const waiter = {
        id,
        resolve,
        timeout: setTimeout(() => {
          notificationWaiters.delete(waiter);
          resolve({
            type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
            body: { status: "ERROR", message: `Timed out waiting for notification ${id}` },
          });
        }, timeoutMs),
      };
      notificationWaiters.add(waiter);
    });
  }
  return {
    type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
    body: { status: "OK", calls: structuredClone(notificationCalls) },
  };
};

type BackgroundE2EHistoryOperations = {
  add: typeof addHistoryEntry;
  clear: typeof clearHistory;
  patch: typeof patchHistoryEntry;
};

const historyOperations: BackgroundE2EHistoryOperations = {
  add: addHistoryEntry,
  clear: clearHistory,
  patch: patchHistoryEntry,
};

export const handleBackgroundE2EHistoryCommand = async (
  rawRequest: unknown,
  operations: BackgroundE2EHistoryOperations = historyOperations,
): Promise<BackgroundE2EHistoryResponse | null> => {
  if (!isBackgroundE2EHistoryCommand(rawRequest)) return null;
  try {
    await (backgroundRuntime.ready ?? Promise.resolve());
    if (rawRequest.body.action === "clear") {
      await operations.clear();
    } else {
      const { index, payload } = rawRequest.body;
      const id = operations.add({
        url: `https://history-memory.invalid/${index}?payload=${payload}`,
        finalFullPath: `rss-history/rss-history-${index}.bin`,
        variables: { payload },
      });
      if (!id) throw new Error("E2E history write did not create an entry");
      await operations.patch(id, { status: "complete" });
    }
    return { type: BACKGROUND_E2E_HISTORY_COMMAND, body: { status: "OK" } };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_HISTORY_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

const handleBackgroundE2ETabMenuCommand = async (
  rawRequest: unknown,
  dispatch: typeof handleTabMenuClick = handleTabMenuClick,
): Promise<BackgroundE2ETabMenuResponse | null> => {
  if (!isBackgroundE2ETabMenuCommand(rawRequest)) return null;
  try {
    await dispatch(rawRequest.body.info, rawRequest.body.tab);
    return { type: BACKGROUND_E2E_TAB_MENU_COMMAND, body: { status: "OK" } };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_TAB_MENU_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

const drainBackgroundWrites = async (): Promise<void> => {
  for (;;) {
    const counterQueue = counterWriteState.queue;
    const configQueue = configWriteState.queue;
    const sessionQueues = [...sessionWriteState.queues.values()];
    await Promise.allSettled([counterQueue, configQueue, ...sessionQueues]);
    if (
      counterWriteState.queue === counterQueue &&
      configWriteState.queue === configQueue &&
      sessionWriteState.queues.size === 0
    ) {
      return;
    }
  }
};

export const handleBackgroundE2EResetCommand = async (
  rawRequest: unknown,
): Promise<BackgroundE2EResetResponse | null> => {
  if (!isBackgroundE2EResetCommand(rawRequest)) return null;
  try {
    await (backgroundRuntime.ready ?? Promise.resolve()).catch(() => {});
    await resetActiveTransfers();
    await resetRefererRules();
    await resetNotificationRecoveryState();
    await resetSourcePanelState();
    resetMessagingTransientState();
    resetNotifierTransientState();
    handleBackgroundE2ENotificationCommand({
      type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
      body: { action: "reset" },
    });
    await drainBackgroundWrites();
    downloadsState.records.clear();
    downloadsState.hydration = null;
    delete backgroundRuntime.lastDownloadState;
    counterWriteState.privateValue = undefined;
    counterWriteState.queue = Promise.resolve();
    configWriteState.queue = Promise.resolve();
    return { type: BACKGROUND_E2E_RESET_COMMAND, body: { status: "OK" } };
  } catch (error) {
    return {
      type: BACKGROUND_E2E_RESET_COMMAND,
      body: { status: "ERROR", message: error instanceof Error ? error.message : String(error) },
    };
  }
};

export const installBackgroundE2ENotificationObserver = (): void => {
  if (notificationObserverInstalled) return;
  notificationObserverInstalled = true;
  const notifications = webExtensionApi.notifications;
  const originalCreate = notifications.create;
  Reflect.set(notifications, "create", (...args: unknown[]) => {
    const id = typeof args[0] === "string" ? args[0] : "";
    const details = isRecord(args[1]) ? args[1] : isRecord(args[0]) ? args[0] : {};
    const call = {
      id,
      ...(typeof details.title === "string" ? { title: details.title } : {}),
      ...(typeof details.message === "string" ? { message: details.message } : {}),
    };
    const recordSuccessfulCall = () => {
      notificationCalls.push(call);
      for (const waiter of notificationWaiters) {
        if (waiter.id !== id) continue;
        clearTimeout(waiter.timeout);
        notificationWaiters.delete(waiter);
        waiter.resolve({
          type: BACKGROUND_E2E_NOTIFICATION_COMMAND,
          body: { status: "OK", calls: [structuredClone(call)] },
        });
      }
    };
    const result = Reflect.apply(originalCreate, notifications, args);
    if (result !== null && typeof result === "object" && "then" in result) {
      return Promise.resolve(result).then((value) => {
        recordSuccessfulCall();
        return value;
      });
    }
    recordSuccessfulCall();
    return result;
  });
};

export const registerBackgroundE2ECommand = (): void => {
  installBackgroundE2ENotificationObserver();
  webExtensionApi.runtime.onMessage.addListener((rawRequest, _sender, sendResponse) => {
    if (isBackgroundE2EResetCommand(rawRequest)) {
      void handleBackgroundE2EResetCommand(rawRequest).then(sendResponse);
      return true;
    }
    if (isBackgroundE2ENotificationCommand(rawRequest)) {
      void Promise.resolve(handleBackgroundE2ENotificationCommand(rawRequest)).then(sendResponse);
      return true;
    }
    if (isBackgroundE2EHistoryCommand(rawRequest)) {
      void handleBackgroundE2EHistoryCommand(rawRequest).then(sendResponse);
      return true;
    }
    if (isBackgroundE2EContextMenuCommand(rawRequest)) {
      void handleBackgroundE2EContextMenuCommand(rawRequest).then(sendResponse);
      return true;
    }
    if (isBackgroundE2ETabMenuCommand(rawRequest)) {
      void handleBackgroundE2ETabMenuCommand(rawRequest).then(sendResponse);
      return true;
    }
    if (isBackgroundE2EInspectCommand(rawRequest)) {
      void handleBackgroundE2EInspectCommand(rawRequest).then(sendResponse);
      return true;
    }
    if (!isBackgroundE2ECommand(rawRequest)) return;
    void handleBackgroundE2ECommand(rawRequest).then(sendResponse);
    return true;
  });
};
