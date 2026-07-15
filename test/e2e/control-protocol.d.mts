export type StorageAreaName = "local" | "session";
export type StorageKeys = string | string[] | Record<string, unknown> | null;
export type StorageRecord = Record<string, unknown>;

export interface E2EStoredOptionValues {
  contentClickToSaveCombo: string | number;
  fallbackFetch: boolean;
  filenamePatterns: string;
  notifyDuration: string | number;
  notifyOnFailure: boolean;
  notifyOnLinkPreferred: boolean;
  notifyOnRuleMatch: boolean;
  notifyOnSuccess: boolean;
  paths: string;
  promptOnShift: boolean;
  selection: boolean;
}

export interface E2ERuntimeOptionValues extends Omit<
  E2EStoredOptionValues,
  "filenamePatterns" | "notifyDuration"
> {
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

export interface MenuClickInfo {
  menuItemId: string | number;
  selectionText?: string;
  pageUrl?: string;
  linkUrl?: string;
  srcUrl?: string;
  frameUrl?: string;
  mediaType?: string;
  linkText?: string;
  modifiers?: string[];
}

export interface ContextMenuTab {
  id?: number;
  title?: string;
  url?: string;
  incognito?: boolean;
}

export interface ContextMenuClickBody {
  info: MenuClickInfo;
  tab?: ContextMenuTab;
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
  | { type: "SAVE_IN_E2E_START_DOWNLOAD"; body: StartDownloadBody }
  | { type: "SAVE_IN_E2E_CONTEXT_MENU_CLICK"; body: ContextMenuClickBody }
  | { type: "SAVE_IN_E2E_TAB_MENU_CLICK"; body: TabMenuClickBody }
  | { type: "SAVE_IN_E2E_NOTIFICATION_CALLS"; body: { action: "get" | "reset" } }
  | { type: "APPLY_CONFIG"; body: { config: Record<string, unknown> } };

export type BackgroundRuntimeMessage =
  | RuntimeMessage
  | {
      type: "DOWNLOAD";
      body: { url?: string; info?: Record<string, unknown>; comment?: string };
    };

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

export interface NotificationCall {
  id: string;
  title?: string;
  message?: string;
  [key: string]: unknown;
}

export interface DnrRule {
  id: number;
  [key: string]: unknown;
}

export interface RuntimeResponse {
  type?: string;
  body?: Record<string, unknown>;
}

export interface InspectResult {
  browser: "CHROME" | "FIREFOX";
  capabilities: {
    tabContextMenus: boolean;
    accessKeys: boolean;
    downloadFilenameSuggestion: boolean;
    downloadDeltaFilename: boolean;
    conflictActionPrompt: boolean;
    downloadRequestHeaders: boolean;
  };
  promptConflictAction: "prompt" | "uniquify";
  hasObjectUrl: boolean;
}

export type ControlRequest =
  | { operation: "runtime.send"; message: RuntimeMessage }
  | { operation: "storage.get"; area: StorageAreaName; keys?: StorageKeys }
  | { operation: "storage.set"; area: StorageAreaName; values: StorageRecord }
  | { operation: "storage.remove"; area: StorageAreaName; keys: string | string[] }
  | { operation: "storage.clear"; area: StorageAreaName }
  | { operation: "downloads.search"; query?: chrome.downloads.DownloadQuery }
  | {
      operation: "downloads.wait";
      filenameRegex?: string;
      filenameIncludes?: string;
      url?: string;
      timeoutMs?: number;
    }
  | { operation: "downloads.cancel"; id: number }
  | { operation: "downloads.erase"; query?: chrome.downloads.DownloadQuery }
  | { operation: "tabs.query"; query?: chrome.tabs.QueryInfo }
  | { operation: "tabs.create"; properties: chrome.tabs.CreateProperties }
  | { operation: "tabs.update"; id: number; properties: chrome.tabs.UpdateProperties }
  | { operation: "tabs.reload"; id: number }
  | { operation: "tabs.remove"; ids: number | number[] }
  | { operation: "tabs.sendMessage"; id: number; message: Record<string, unknown> }
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
  | { operation: "harness.resetCase"; snapshot?: StorageRecord }
  | { operation: "inspect" };

export type ControlOperation = ControlRequest["operation"];

export interface ControlResultMap {
  "runtime.send": RuntimeResponse;
  "storage.get": StorageRecord;
  "storage.set": true;
  "storage.remove": true;
  "storage.clear": true;
  "downloads.search": DownloadEntry[];
  "downloads.wait": DownloadEntry[];
  "downloads.cancel": null;
  "downloads.erase": number[];
  "tabs.query": TabEntry[];
  "tabs.create": TabEntry;
  "tabs.update": TabEntry;
  "tabs.reload": null;
  "tabs.remove": null;
  "tabs.sendMessage": unknown;
  "notifications.getAll": Record<string, unknown>;
  "notifications.clear": boolean;
  "dnr.getSessionRules": DnrRule[];
  "dnr.updateSessionRules": null;
  "offscreen.hasDocument": boolean;
  "logs.get": LogEntry[];
  "logs.wait": LogEntry[];
  "harness.resetCase": true;
  inspect: InspectResult;
}
