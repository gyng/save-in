import { SHORTCUT_TYPES } from "../shared/constants.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo, DownloadLaunchResult } from "../downloads/download-types.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { Path } from "../routing/path.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import { backgroundRuntime } from "./runtime.ts";
import { handleContextMenuClick, type ContextMenuClickInfo } from "./menu-click.ts";
import { handleTabMenuClick, type HostTab, type TabMenuClickInfo } from "./menu-tabs.ts";

export const BACKGROUND_E2E_COMMAND = "SAVE_IN_E2E_START_DOWNLOAD";
export const BACKGROUND_E2E_CONTEXT_MENU_COMMAND = "SAVE_IN_E2E_CONTEXT_MENU_CLICK";
export const BACKGROUND_E2E_NOTIFICATION_COMMAND = "SAVE_IN_E2E_NOTIFICATION_CALLS";
export const BACKGROUND_E2E_TAB_MENU_COMMAND = "SAVE_IN_E2E_TAB_MENU_CLICK";

export type BackgroundE2EDownload = {
  path?: string;
  content?: string;
  url?: string;
  shortcutUrl?: string;
  suggestedFilename: string;
  pageUrl?: string;
  modifiers?: string[];
};

export type BackgroundE2ECommandRequest = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body: BackgroundE2EDownload;
};

export type BackgroundE2EContextMenuRequest = {
  type: typeof BACKGROUND_E2E_CONTEXT_MENU_COMMAND;
  body: {
    info: ContextMenuClickInfo;
    tab?: Pick<CurrentTab, "id" | "title" | "url" | "incognito"> | undefined;
  };
};

export type BackgroundE2ENotificationRequest = {
  type: typeof BACKGROUND_E2E_NOTIFICATION_COMMAND;
  body:
    | { action: "get" }
    | { action: "reset" }
    | { action: "wait"; id: string; timeoutMs?: number };
};

export type BackgroundE2ETabMenuRequest = {
  type: typeof BACKGROUND_E2E_TAB_MENU_COMMAND;
  body: { info: TabMenuClickInfo; tab: HostTab };
};

export type BackgroundE2ENotificationCall = {
  id: string;
  title?: string;
  message?: string;
};

export type BackgroundE2ECommandResponse = {
  type: typeof BACKGROUND_E2E_COMMAND;
  body: { status: "OK"; result: DownloadLaunchResult } | { status: "ERROR"; message: string };
};

export type BackgroundE2EContextMenuResponse = {
  type: typeof BACKGROUND_E2E_CONTEXT_MENU_COMMAND;
  body: { status: "OK" } | { status: "ERROR"; message: string };
};

export type BackgroundE2ENotificationResponse = {
  type: typeof BACKGROUND_E2E_NOTIFICATION_COMMAND;
  body: { status: "OK"; calls: BackgroundE2ENotificationCall[] };
};

export type BackgroundE2ETabMenuResponse = {
  type: typeof BACKGROUND_E2E_TAB_MENU_COMMAND;
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
    hasOptionalStringArray(body, "modifiers")
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
): value is Pick<CurrentTab, "id" | "title" | "url" | "incognito"> =>
  isRecord(value) &&
  hasOptionalNumber(value, "id") &&
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
      hasOptionalNumber(value.body, "timeoutMs")));

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

const resolveDownloadUrl = (request: BackgroundE2EDownload): string => {
  if (request.shortcutUrl) {
    return Shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, request.shortcutUrl);
  }
  if (request.content !== undefined) return Download.makeObjectUrl(request.content);
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
    const info: DownloadInfo = {
      url: resolveDownloadUrl(request),
      selectedUrl: request.shortcutUrl || request.url,
      webhookEligible: true,
      suggestedFilename: request.suggestedFilename,
      pageUrl: request.pageUrl,
      modifiers: request.modifiers ?? [],
    };
    const result = await Download.launch({
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
            body: { status: "OK", calls: [] },
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

export const handleBackgroundE2ETabMenuCommand = async (
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
    return Reflect.apply(originalCreate, notifications, args);
  });
};

export const registerBackgroundE2ECommand = (): void => {
  installBackgroundE2ENotificationObserver();
  webExtensionApi.runtime.onMessage.addListener((rawRequest, _sender, sendResponse) => {
    if (isBackgroundE2ENotificationCommand(rawRequest)) {
      void Promise.resolve(handleBackgroundE2ENotificationCommand(rawRequest)).then(sendResponse);
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
    if (!isBackgroundE2ECommand(rawRequest)) return;
    void handleBackgroundE2ECommand(rawRequest).then(sendResponse);
    return true;
  });
};
