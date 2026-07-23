// Low-level notification primitives shared by notification.ts (the
// createExtensionNotification/reportExternalDownloadRejection/reportDownloadFailure
// public API) and notification-events.ts (the onDownloadChanged handler, which
// raises per-download success/failure notifications directly, and
// onNotificationClicked, which recognizes the external-download-rejection
// stream). Kept dependency-free of those two files so neither has to import
// the other to reach this file (the import graph must stay acyclic) — the
// same shape as downloads/download-pipeline-state.ts.
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { options } from "../config/options-data.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";
import { downloadPorts } from "./ports.ts";

const logPort = downloadPorts.log;

// Chrome's notifications API can reject SVG iconUrl values with "Unable to
// download all specified images". Use the shipped raster app icon for the
// native notification surface; status remains explicit in the title and the
// SVG variants remain available to HTML UI where vector images are reliable.
export const ERROR_ICON_URL = "icons/ic_archive_black_128px.png";

const EXTENSION_NOTIFICATION_DEBOUNCE_MS = 250;

export const EXTENSION_NOTIFICATION_STREAMS = Object.freeze({
  DOWNLOAD_FAILURE: "download-failure",
  EXTERNAL_DOWNLOAD_REJECTION: "external-download-rejection",
  LINK_PREFERRED: "link-preferred",
  PREFER_LINKS_PATTERN_ERROR: "prefer-links-pattern-error",
  ROUTE_MATCH: "route-match",
  ROUTE_MISS: "route-miss",
});

export type ExtensionNotificationStream =
  | (typeof EXTENSION_NOTIFICATION_STREAMS)[keyof typeof EXTENSION_NOTIFICATION_STREAMS]
  | "general";

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

const notificationClearTimers = new Map<string, TimerHandle>();
const extensionNotificationDebounceTimers = new Map<string, TimerHandle>();

const addNotificationLog = (
  message: string,
  error: unknown,
  writeOptions: PrivateWriteOptions,
): unknown =>
  writeOptions.privateContext === true
    ? logPort.add(message, String(error), { privateContext: true })
    : logPort.add(message, String(error));

export const createNotification = (
  id: string,
  details: SaveInNotificationOptions,
  duration = options.notifyDuration,
  writeOptions: PrivateWriteOptions = {},
) => {
  const previousClearTimer = notificationClearTimers.get(id);
  if (previousClearTimer !== undefined) {
    globalThis.clearTimeout(previousClearTimer);
    notificationClearTimers.delete(id);
  }

  const created = Promise.resolve(webExtensionApi.notifications.create(id, details)).then(
    () => undefined,
    (error) => {
      addNotificationLog("notification create failed", error, writeOptions);
    },
  );
  if (duration > 0) {
    const clearTimer = globalThis.setTimeout(() => {
      notificationClearTimers.delete(id);
      void Promise.resolve(webExtensionApi.notifications.clear(id)).catch((error) =>
        addNotificationLog("notification clear failed", error, writeOptions),
      );
    }, duration);
    notificationClearTimers.set(id, clearTimer);
  }
  return created;
};

export const queueExtensionNotification = (
  id: string,
  details: SaveInNotificationOptions,
  duration = options.notifyDuration,
  writeOptions: PrivateWriteOptions = {},
) => {
  const previousClearTimer = notificationClearTimers.get(id);
  if (previousClearTimer !== undefined) {
    globalThis.clearTimeout(previousClearTimer);
    notificationClearTimers.delete(id);
  }

  const previousDebounceTimer = extensionNotificationDebounceTimers.get(id);
  if (previousDebounceTimer !== undefined) globalThis.clearTimeout(previousDebounceTimer);

  const debounceTimer = globalThis.setTimeout(() => {
    extensionNotificationDebounceTimers.delete(id);
    createNotification(id, details, duration, writeOptions);
  }, EXTENSION_NOTIFICATION_DEBOUNCE_MS);
  extensionNotificationDebounceTimers.set(id, debounceTimer);
};

export const resetNotificationTimers = (): void => {
  for (const timer of notificationClearTimers.values()) globalThis.clearTimeout(timer);
  for (const timer of extensionNotificationDebounceTimers.values()) globalThis.clearTimeout(timer);
  notificationClearTimers.clear();
  extensionNotificationDebounceTimers.clear();
};
