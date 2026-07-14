export type StorageAreaName = "local" | "session";
export type StorageKeys = string | string[] | Record<string, unknown> | null;
export type StorageRecord = Record<string, unknown>;

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
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface NotificationCall {
  id: string;
  message: string;
  [key: string]: unknown;
}

export interface DnrRule {
  id: number;
  [key: string]: unknown;
}

export interface RuntimeResponse {
  type?: string;
  body: Record<string, unknown>;
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
  | { operation: "runtime.send"; message: Record<string, unknown> }
  | { operation: "storage.get"; area: StorageAreaName; keys?: StorageKeys }
  | { operation: "storage.set"; area: StorageAreaName; values: StorageRecord }
  | { operation: "storage.remove"; area: StorageAreaName; keys: string | string[] }
  | { operation: "storage.clear"; area: StorageAreaName }
  | { operation: "downloads.search"; query?: Record<string, unknown> }
  | {
      operation: "downloads.wait";
      filenameRegex?: string;
      filenameIncludes?: string;
      url?: string;
      timeoutMs?: number;
    }
  | { operation: "downloads.cancel"; id: number }
  | { operation: "downloads.erase"; query?: Record<string, unknown> }
  | { operation: "tabs.query"; query?: Record<string, unknown> }
  | { operation: "tabs.create"; properties: Record<string, unknown> }
  | { operation: "tabs.update"; id: number; properties: Record<string, unknown> }
  | { operation: "tabs.reload"; id: number }
  | { operation: "tabs.remove"; ids: number | number[] }
  | { operation: "tabs.sendMessage"; id: number; message: Record<string, unknown> }
  | { operation: "notifications.getAll" }
  | { operation: "notifications.clear"; id: string }
  | { operation: "dnr.getSessionRules" }
  | { operation: "dnr.updateSessionRules"; update: Record<string, unknown> }
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
