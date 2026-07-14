import { webExtensionApi } from "../platform/web-extension-api.ts";
import { LOG_STORAGE_KEY } from "../shared/storage-keys.ts";

type LogEntry = { at?: unknown; message?: unknown; data?: unknown };

const isLogEntry = (value: unknown): value is LogEntry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatPart = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    const serialized: unknown = JSON.stringify(value);
    if (typeof serialized === "string") return serialized;
  } catch {
    // Legacy or externally modified session data can contain values that JSON
    // cannot encode; keep one bad field from hiding the rest of the log.
  }
  try {
    return String(value);
  } catch {
    return "[unprintable]";
  }
};

export const updateDebugLog = async () => {
  const el = document.querySelector<HTMLTextAreaElement>("#debug-log");
  if (!el) return;

  try {
    const res = await webExtensionApi.storage.session.get(LOG_STORAGE_KEY);
    const stored = res?.[LOG_STORAGE_KEY];
    const entries = Array.isArray(stored) ? stored.filter(isLogEntry) : [];
    el.value = entries
      .map((entry) =>
        [entry.at, entry.message, entry.data].map(formatPart).filter(Boolean).join("  "),
      )
      .join("\n");
  } catch {
    el.value = "(debug log unavailable in this browser)";
  }
};

export const setupDebugLogPanel = () => {
  void updateDebugLog();
  document.querySelector("#debug-log-refresh")?.addEventListener("click", () => {
    void updateDebugLog();
  });
  document.querySelector("#debug-log-clear")?.addEventListener("click", () => {
    void webExtensionApi.storage.session
      .remove(LOG_STORAGE_KEY)
      .then(updateDebugLog)
      .catch(() => {});
  });
};
