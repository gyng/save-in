export type StorageAreaName = "local" | "session";
export type StorageKeys = string | string[] | Record<string, unknown> | null;
export type StorageRecord = Record<string, unknown>;

export interface E2EStoredOptionValues {
  appendMimeExtension: boolean;
  autoDownloadBackgrounds: boolean;
  autoDownloadDataUrls: boolean;
  autoDownloadDocuments: boolean;
  autoDownloadEnabled: boolean;
  autoDownloadLive: boolean;
  autoDownloadMaxPerPage: string | number;
  autoDownloadPrivate: boolean;
  browserDownloadFilter: string;
  contentClickToSave: boolean;
  contentClickToSaveCombo: string | number;
  externalDownloadAllowlist: string;
  fallbackFetch: boolean;
  fetchViaFetch: boolean;
  filenamePatterns: string;
  includeFetchCredentials: boolean;
  notifyDuration: string | number;
  notifyOnFailure: boolean;
  notifyOnLinkPreferred: boolean;
  notifyOnRuleMatch: boolean;
  notifyOnSuccess: boolean;
  paths: string;
  promptOnShift: boolean;
  quickSaveDirectory: string;
  quickSaveEnabled: boolean;
  quickSaveOnly: boolean;
  quickSaveUseDirectory: boolean;
  routeBrowserDownloads: boolean;
  routeBrowserDownloadsFirefox: boolean;
  selection: boolean;
  setRefererHeader: boolean;
  setRefererHeaderFilter: string;
  shortcutTab: boolean;
  shortcutType: "HTML_REDIRECT" | "MAC" | "MAC_WEBLOC" | "FREEDESKTOP" | "WINDOWS";
  sourcePanelEnabled: boolean;
  sourcePanelLive: boolean;
  sourcePanelLinks: boolean;
  trackBrowserDownloads: boolean;
  webhookEnabled: boolean;
  webhookIncludePageTitle: boolean;
  webhookIncludePageUrl: boolean;
  webhookIncludeSelectionText: boolean;
  webhookUrl: string;
}

export interface E2ERuntimeOptionValues extends Omit<
  E2EStoredOptionValues,
  "autoDownloadMaxPerPage" | "filenamePatterns" | "notifyDuration"
> {
  autoDownloadMaxPerPage: number;
  notifyDuration: number;
}

export type E2ERuntimeOptionName = keyof E2ERuntimeOptionValues;
export type StoredOptionsPatch = Partial<E2EStoredOptionValues>;

export interface StartDownloadBody {
  content?: string;
  url?: string;
  shortcutUrl?: string;
  suggestedFilename: string;
  pageUrl?: string;
  path?: string;
  modifiers?: string[];
}

export type DownloadLaunchResult =
  | { status: "started"; downloadId: number }
  | { status: "skipped" }
  | { status: "failed" };

export interface MenuClickInfo {
  menuItemId: string | number;
  selectionText?: string | undefined;
  pageUrl?: string | undefined;
  linkUrl?: string | undefined;
  srcUrl?: string | undefined;
  frameUrl?: string | undefined;
  mediaType?: string | undefined;
  linkText?: string | undefined;
  modifiers?: string[] | undefined;
}

export interface ContextMenuTab {
  id?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
}

export interface ContextMenuClickBody {
  info: MenuClickInfo;
  tab?: ContextMenuTab | undefined;
}

export interface TabMenuTab extends TabEntry {
  id: number;
  index: number;
  windowId: number;
}

export interface TabMenuClickBody {
  info: MenuClickInfo;
  tab: TabMenuTab;
}

export type RuntimeMessage =
  | { type: "WAKE_WARM" }
  | { type: "OPTIONS_LOADED" }
  | { type: "OPTIONS" }
  | { type: "HISTORY_GET" }
  | { type: "HISTORY_CANCEL"; body: { historyId: string } }
  | { type: "HISTORY_UNDO"; body: { historyId: string } }
  | { type: "HISTORY_REROUTE"; body: { historyId: string; destination: string } }
  | { type: "EXTERNAL_DOWNLOAD_REJECTIONS_GET" }
  | { type: "EXTERNAL_DOWNLOAD_REJECTION_CLEAR"; body: { senderId: string } }
  | {
      type: "DOWNLOAD";
      body: { url?: string; info?: Record<string, unknown>; comment?: string };
    }
  | { type: "SAVE_IN_E2E_START_DOWNLOAD"; body: StartDownloadBody }
  | { type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK"; body: ContextMenuClickBody }
  | { type: "SAVE_IN_E2E_TAB_MENU_CLICK"; body: TabMenuClickBody }
  | { type: "SAVE_IN_E2E_RESET_STATE" }
  | { type: "SAVE_IN_E2E_INSPECT" }
  | {
      type: "SAVE_IN_E2E_NOTIFICATION_CALLS";
      body:
        | { action: "get" }
        | { action: "reset" }
        | { action: "wait"; id: string; timeoutMs?: number };
    }
  | { type: "APPLY_CONFIG"; body: { config: Record<string, unknown> } };

export type StartDownloadRequest = Extract<RuntimeMessage, { type: "SAVE_IN_E2E_START_DOWNLOAD" }>;
export type ContextMenuClickRequest = Extract<
  RuntimeMessage,
  { type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK" }
>;
export type TabMenuClickRequest = Extract<RuntimeMessage, { type: "SAVE_IN_E2E_TAB_MENU_CLICK" }>;
export type NotificationRequest = Extract<
  RuntimeMessage,
  { type: "SAVE_IN_E2E_NOTIFICATION_CALLS" }
>;

export type StartDownloadResponse = {
  type: "SAVE_IN_E2E_START_DOWNLOAD";
  body: { status: "OK"; result: DownloadLaunchResult } | { status: "ERROR"; message: string };
};
export type ContextMenuClickResponse = {
  type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK";
  body: { status: "OK" } | { status: "ERROR"; message: string };
};
export type TabMenuClickResponse = {
  type: "SAVE_IN_E2E_TAB_MENU_CLICK";
  body: { status: "OK" } | { status: "ERROR"; message: string };
};
export type NotificationResponse = {
  type: "SAVE_IN_E2E_NOTIFICATION_CALLS";
  body: { status: "OK"; calls: NotificationCall[] } | { status: "ERROR"; message: string };
};
export type ResetStateResponse = {
  type: "SAVE_IN_E2E_RESET_STATE";
  body: { status: "OK" } | { status: "ERROR"; message: string };
};
export type InspectStateResponse = {
  type: "SAVE_IN_E2E_INSPECT";
  body: { status: "OK"; state: InspectResult } | { status: "ERROR"; message: string };
};

export type ApplyConfigResponse = {
  type: "APPLY_CONFIG_RESULT";
  body: {
    version: number;
    applied: Record<string, unknown>;
    rejected: Array<{ name: string; reason: string }>;
  };
};

export type DownloadMessageResponse = {
  type: "DOWNLOAD";
  body:
    | { status: "OK"; version: number; url: string }
    | { status: "ERROR"; error: string; message?: string | undefined; version: number };
};

export interface RuntimeResponseMap {
  WAKE_WARM: { type: "OK" };
  OPTIONS_LOADED: { type: "OK" };
  OPTIONS: { type: "OPTIONS"; body: Record<string, unknown> };
  HISTORY_GET: { type: "HISTORY_GET"; body: { entries: HistoryEntry[] } };
  HISTORY_CANCEL: { type: "HISTORY_CANCEL"; body: { canceled: boolean } };
  HISTORY_UNDO: { type: "HISTORY_UNDO"; body: { undone: boolean; fileMissing: boolean } };
  HISTORY_REROUTE: {
    type: "HISTORY_REROUTE";
    body: { rerouted: boolean; oldRemoved: boolean; pending?: boolean; newHistoryId?: string };
  };
  EXTERNAL_DOWNLOAD_REJECTIONS_GET: {
    type: "EXTERNAL_DOWNLOAD_REJECTIONS_GET";
    body: { rejections: ExternalDownloadRejection[] };
  };
  EXTERNAL_DOWNLOAD_REJECTION_CLEAR: { type: "OK" };
  DOWNLOAD: DownloadMessageResponse;
  SAVE_IN_E2E_START_DOWNLOAD: StartDownloadResponse;
  SAVE_IN_E2E_CONTEXT_MENU_CLICK: ContextMenuClickResponse;
  SAVE_IN_E2E_TAB_MENU_CLICK: TabMenuClickResponse;
  SAVE_IN_E2E_RESET_STATE: ResetStateResponse;
  SAVE_IN_E2E_INSPECT: InspectStateResponse;
  SAVE_IN_E2E_NOTIFICATION_CALLS: NotificationResponse;
  APPLY_CONFIG: ApplyConfigResponse;
}

export type RuntimeResponseFor<Message extends RuntimeMessage> =
  RuntimeResponseMap[Message["type"]];
export type RuntimeResponse = RuntimeResponseMap[keyof RuntimeResponseMap];
export interface BackgroundRuntimeResponse {
  type?: string;
  body?: Record<string, unknown>;
}

export type BackgroundRuntimeMessage = RuntimeMessage;

export interface DownloadSummary {
  state: string;
  filename: string;
}

export interface DownloadEntry extends DownloadSummary {
  id: number;
  url: string;
}

export interface LogEntry {
  message: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface HistoryEntry {
  id?: string;
  url?: string;
  status?: string;
  finalFullPath?: string;
  private?: boolean;
  info?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExternalDownloadRejection {
  senderId: string;
  attempts: number;
  [key: string]: unknown;
}

export interface TabEntry {
  id?: number;
  index?: number;
  windowId?: number;
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
  incognito?: boolean;
  [key: string]: unknown;
}

export interface WindowEntry {
  id: number;
  incognito?: boolean;
  tabs?: TabEntry[];
  [key: string]: unknown;
}

export interface NotificationCall {
  id: string;
  title?: string;
  message?: string;
}

export interface DnrRule {
  id: number;
  [key: string]: unknown;
}

/** Reported by the bundle itself; mirrors src/platform/chrome-detector.ts. */
export interface InspectResult {
  browser: "CHROME" | "FIREFOX" | "UNKNOWN";
  browserVersion?: number;
  capabilities: {
    tabContextMenus: boolean;
    downloadFilenameSuggestion: boolean;
    downloadDeltaFilename: boolean;
    conflictActionPrompt: boolean;
    downloadRequestHeaders: boolean;
    notificationButtons: boolean;
    shortcutFileExtensions: boolean;
  };
  promptConflictAction: "prompt" | "uniquify";
  hasObjectUrl: boolean;
}

export type ControlRequest =
  | { operation: "runtime.send"; message: RuntimeMessage }
  | {
      operation: "runtime.download";
      content: string;
      info?: Record<string, unknown>;
      comment?: string;
    }
  | { operation: "options.waitReady"; timeoutMs?: number }
  | { operation: "storage.get"; area: StorageAreaName; keys?: StorageKeys }
  | { operation: "storage.set"; area: StorageAreaName; values: StorageRecord }
  | {
      operation: "storage.wait";
      area: StorageAreaName;
      key: string;
      expected: unknown;
      timeoutMs?: number;
    }
  | { operation: "storage.remove"; area: StorageAreaName; keys: string | string[] }
  | { operation: "storage.clear"; area: StorageAreaName }
  | { operation: "downloads.search"; query?: chrome.downloads.DownloadQuery }
  | {
      operation: "downloads.wait";
      filenameRegex?: string;
      filenameIncludes?: string;
      url?: string;
      minimumComplete?: number;
      timeoutMs?: number;
    }
  | { operation: "downloads.cancel"; id: number }
  | { operation: "downloads.erase"; query?: chrome.downloads.DownloadQuery }
  | { operation: "tabs.query"; query?: chrome.tabs.QueryInfo }
  | { operation: "tabs.create"; properties: chrome.tabs.CreateProperties }
  | { operation: "tabs.update"; id: number; properties: chrome.tabs.UpdateProperties }
  | {
      operation: "tabs.wait";
      id?: number;
      urlIncludes?: string;
      status?: string;
      timeoutMs?: number;
    }
  | { operation: "tabs.reload"; id: number }
  | { operation: "tabs.remove"; ids: number | number[] }
  | { operation: "tabs.sendMessage"; id: number; message: Record<string, unknown> }
  | { operation: "windows.create"; properties: chrome.windows.CreateData }
  | { operation: "windows.remove"; id: number }
  | { operation: "notifications.getAll" }
  | { operation: "notifications.clear"; id: string }
  | { operation: "dnr.getSessionRules" }
  | { operation: "dnr.updateSessionRules"; update: chrome.declarativeNetRequest.UpdateRuleOptions }
  | { operation: "offscreen.hasDocument" }
  | { operation: "logs.get" }
  | {
      operation: "logs.wait";
      baseline?: number;
      messages: string[];
      timeoutMs?: number;
    }
  | {
      operation: "history.wait";
      id?: string;
      url?: string;
      status?: string;
      finalFullPath?: string;
      context?: string;
      minimum?: number;
      timeoutMs?: number;
    }
  | { operation: "harness.resetCase"; snapshot?: StorageRecord }
  | { operation: "inspect" };

export type ControlOperation = ControlRequest["operation"];

export interface ControlResultMap {
  "runtime.download": DownloadMessageResponse;
  "options.waitReady": true;
  "storage.get": StorageRecord;
  "storage.set": true;
  "storage.wait": unknown;
  "storage.remove": true;
  "storage.clear": true;
  "downloads.search": DownloadEntry[];
  "downloads.wait": DownloadEntry[];
  "downloads.cancel": null;
  "downloads.erase": number[];
  "tabs.query": TabEntry[];
  "tabs.create": TabEntry;
  "tabs.update": TabEntry;
  "tabs.wait": TabEntry;
  "tabs.reload": null;
  "tabs.remove": null;
  "tabs.sendMessage": unknown;
  "windows.create": WindowEntry;
  "windows.remove": null;
  "notifications.getAll": Record<string, unknown>;
  "notifications.clear": boolean;
  "dnr.getSessionRules": DnrRule[];
  "dnr.updateSessionRules": null;
  "offscreen.hasDocument": boolean;
  "logs.get": LogEntry[];
  "logs.wait": LogEntry[];
  "history.wait": HistoryEntry[];
  "harness.resetCase": true;
  inspect: InspectResult;
}

export type ControlResult<Request extends ControlRequest> = Request extends {
  operation: "runtime.send";
  message: infer Message extends RuntimeMessage;
}
  ? RuntimeResponseFor<Message>
  : Request extends { operation: "runtime.download" }
    ? DownloadMessageResponse
    : Request["operation"] extends keyof ControlResultMap
      ? ControlResultMap[Request["operation"]]
      : never;
