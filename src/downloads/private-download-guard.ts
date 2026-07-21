// Chrome cannot attach an extension-started download to its Incognito context,
// and downloads.onCreated omits byExtensionId for our own downloads. If the
// service worker restarts between those calls, only this anonymous counter can
// stop the item being mistaken for an ordinary browser download. It contains
// no URL, filename, tab, or destination and exists only for the recovery lease.

import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { PRIVATE_PENDING_DOWNLOADS_SESSION_KEY } from "../shared/storage-keys.ts";
import { sessionWriteState } from "./download-state-instances.ts";

export type AnonymousPrivateDownloadGuardRelease = () => Promise<void>;

export const beginAnonymousPrivateDownloadGuard = async (
  privateContext: boolean,
  persistActivity: boolean,
): Promise<AnonymousPrivateDownloadGuardRelease | null> => {
  if (CURRENT_BROWSER !== BROWSERS.CHROME || !privateContext || persistActivity) {
    return null;
  }

  await updateSession<number>(
    sessionWriteState,
    extensionSessionStorage,
    PRIVATE_PENDING_DOWNLOADS_SESSION_KEY,
    (value) => normalizeSessionCounter(value) + 1,
  );
  return () =>
    updateSession<number>(
      sessionWriteState,
      extensionSessionStorage,
      PRIVATE_PENDING_DOWNLOADS_SESSION_KEY,
      (value) => Math.max(0, normalizeSessionCounter(value) - 1),
    );
};
