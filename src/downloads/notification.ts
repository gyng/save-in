import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { options } from "../config/options-data.ts";
import { downloadPorts } from "./ports.ts";
import { getDownloadFailure } from "./notification-model.ts";
import { runEventTask } from "../shared/event-task.ts";
import {
  cancelExpectedDownload,
  expectDownload,
  resetExpectedDownloads,
} from "./expected-downloads.ts";
import {
  createNotification,
  ERROR_ICON_URL,
  EXTENSION_NOTIFICATION_STREAMS,
  queueExtensionNotification,
  resetNotificationTimers,
} from "./notification-runtime.ts";
import type { ExtensionNotificationStream } from "./notification-runtime.ts";
import {
  onDownloadChanged,
  onDownloadCreated,
  onNotificationButtonClicked,
  onNotificationClicked,
} from "./notification-events.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

type NotificationButtonEvent = {
  addListener(listener: (notificationId: string, buttonIndex: number) => void): void;
};

const isNotificationButtonEvent = (value: unknown): value is NotificationButtonEvent =>
  isStringKeyedRecord(value) && typeof value.addListener === "function";
export {
  recoverNotificationState,
  resetNotificationRecoveryState,
} from "./notification-recovery.ts";
// expectDownload/cancelExpectedDownload are called before/around
// downloads.download() by download.ts and download-execution.ts so
// onDownloadCreated (notification-events.ts) knows the next created download
// is ours; re-exported here so notification.ts stays their single import path.
export { cancelExpectedDownload, expectDownload };
// EXTENSION_NOTIFICATION_STREAMS is consumed by callers that build their own
// stream-scoped notification IDs (menu-click.ts, filename-listener.ts,
// download-execution.ts); re-exported here so notification.ts stays their
// single import path.
export { EXTENSION_NOTIFICATION_STREAMS };

const logPort = downloadPorts.log;

// Chrome's notifications API can reject SVG iconUrl values with "Unable to
// download all specified images". Use the shipped raster app icon for the
// native notification surface; status remains explicit in the title and the
// SVG variants remain available to HTML UI where vector images are reliable.
const INFO_ICON_URL = "icons/ic_archive_black_128px.png";

export const resetNotifierTransientState = (): void => {
  resetNotificationTimers();
  resetExpectedDownloads();
};

export const createExtensionNotification = (
  title: string | null,
  message?: string | null,
  error?: unknown,
  stream: ExtensionNotificationStream = "general",
) => {
  // WebExtension notifications use their caller-supplied ID as the stable
  // replacement key (the equivalent of a Service Worker notification tag).
  // Keep streams distinct while coalescing bursts before they reach the OS.
  const id = `save-in-not-${stream}`;
  queueExtensionNotification(id, {
    type: "basic",
    title: title || getMessage("extensionName"),
    iconUrl: error ? ERROR_ICON_URL : INFO_ICON_URL,
    message: message || getMessage("genericUnknownError"),
  });
};

export const reportExternalDownloadRejection = (senderId: string): Promise<void> =>
  createNotification(`save-in-not-${EXTENSION_NOTIFICATION_STREAMS.EXTERNAL_DOWNLOAD_REJECTION}`, {
    type: "basic",
    title: getMessage("notificationExternalDownloadBlockedTitle"),
    iconUrl: ERROR_ICON_URL,
    message: getMessage("notificationExternalDownloadBlockedMessage", [senderId]),
  });

// Single user-facing path for a TERMINAL download failure that happens before
// a download is even created (the pipeline throwing, or downloads.download
// rejecting after the fetch fallback is exhausted) — cases onDownloadChanged
// never sees. Gated on notifyOnFailure so it stays consistent with the
// post-creation failure notification.
export const reportDownloadFailure = (name: string, message?: string, privateContext = false) => {
  if (!(options && options.notifyOnFailure)) {
    return;
  }
  createExtensionNotification(
    privateContext
      ? getMessage("notificationPrivateFailureTitle")
      : getMessage("notificationFailureTitle", [name || ""]),
    privateContext
      ? getMessage("notificationPrivateDetailsHidden")
      : message || getMessage("genericUnknownError"),
    true,
    EXTENSION_NOTIFICATION_STREAMS.DOWNLOAD_FAILURE,
  );
};

// Returns Firefox/Chrome error deltas ({ current }) or a boolean.
export const isDownloadFailure = getDownloadFailure;

// MV3: entry.background calls this synchronously at startup so a worker woken BY
// a download event still has the handler attached (guards exist only for the
// partial test mocks). The event handlers themselves live in
// notification-events.ts; this stays the sole registrar so the listener-owner
// allowlist in check-import-cycles.js only has to list one file per browser
// event surface.
export const registerNotifier = () => {
  if (
    webExtensionApi.downloads &&
    webExtensionApi.downloads.onCreated &&
    webExtensionApi.downloads.onChanged
  ) {
    webExtensionApi.downloads.onCreated.addListener((item) =>
      runEventTask(
        () => onDownloadCreated(item),
        (error) => logPort.add("download created event failed", String(error)),
      ),
    );
    webExtensionApi.downloads.onChanged.addListener((delta) =>
      runEventTask(
        () => onDownloadChanged(delta),
        (error) => logPort.add("download changed event failed", String(error)),
      ),
    );
  }
  if (webExtensionApi.notifications && webExtensionApi.notifications.onClicked) {
    webExtensionApi.notifications.onClicked.addListener((notificationId) =>
      runEventTask(
        () => onNotificationClicked(notificationId),
        (error) => logPort.add("notification click event failed", String(error)),
      ),
    );
  }
  // Chrome-only Undo button: Firefox has no notifications.onButtonClicked, and
  // its host type declarations omit the event, so this is a runtime probe
  // rather than a typed property access. Still registered synchronously here —
  // a worker woken by the button press must already have the handler.
  const onButtonClicked: unknown = Reflect.get(
    webExtensionApi.notifications ?? {},
    "onButtonClicked",
  );
  if (isNotificationButtonEvent(onButtonClicked)) {
    onButtonClicked.addListener((notificationId, buttonIndex) =>
      runEventTask(
        () => onNotificationButtonClicked(notificationId, buttonIndex),
        (error) => logPort.add("notification button event failed", String(error)),
      ),
    );
  }
};
