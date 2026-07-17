// Background composition root; listener registration remains synchronous.
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { initializeLocalization } from "../platform/localization.ts";

import { OptionsManagement } from "../config/option.ts";
import { downloadsState } from "./application-state.ts";
import { hydrateDownloads } from "../downloads/download-state.ts";
import { setHistoryStatus } from "./history.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { restoreLastUsed } from "./menu-build.ts";
import { addDownloadListener, quickSaveActiveTab } from "./menu-click.ts";
import { addTabMenuListener } from "./menu-tabs.ts";
import {
  LAST_USED_META_STORAGE_KEY,
  LAST_USED_PATH_STORAGE_KEY,
  RECENT_DESTINATIONS_STORAGE_KEY,
  WELCOME_PENDING_STORAGE_KEY,
  WELCOME_VERSION,
} from "../shared/storage-keys.ts";
import { addLogEntry } from "./log.ts";
import { currentTab, setCurrentTab, type CurrentTab } from "../platform/current-tab.ts";
import { syncSourcePanelToTab, toggleSourcePanelForTab } from "./source-panel-state.ts";
import { backgroundRuntime, resetRuntimeDiagnostics } from "./runtime.ts";
import { recoverNotificationState } from "../downloads/notification-recovery.ts";
import { runBackgroundTask } from "./background-event-task.ts";
import { recoverActiveTransfers } from "../downloads/active-transfers.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { rebuildMenus } from "./menu-rebuild.ts";
import { MENU_IDS, QUICK_SAVE_COMMAND } from "../menus/menu-ids.ts";
import { cleanupStaleRefererRule } from "../downloads/referer-rules.ts";
import {
  markBackgroundFailed,
  markBackgroundReady,
  recordDiagnosticLifecycle,
} from "./diagnostics.ts";

const seedCurrentTab = (candidate: CurrentTab): void => {
  if (candidate.active === false) return;
  setCurrentTab(candidate);
};

const reloadConfigurationAndMenus = async (): Promise<void> => {
  resetRuntimeDiagnostics();

  const [loaded, storedLastUsed] = await Promise.all([
    OptionsManagement.loadOptions().then(async (loadedOptions) => {
      await initializeLocalization(loadedOptions.uiLocale);
      return loadedOptions;
    }),
    webExtensionApi.storage.local.get([
      LAST_USED_PATH_STORAGE_KEY,
      LAST_USED_META_STORAGE_KEY,
      RECENT_DESTINATIONS_STORAGE_KEY,
    ]),
  ]);

  backgroundRuntime.debug = loaded.debug;
  restoreLastUsed(storedLastUsed);
  await rebuildMenus();
};

const recoverColdStartState = async (): Promise<void> => {
  await Promise.all([
    // Rebuild the in-memory download records from storage.session before any
    // download event handler (which awaits backgroundRuntime.ready) touches them.
    hydrateDownloads(downloadsState, extensionSessionStorage),
    cleanupStaleRefererRule().catch((error) =>
      addLogEntry("Referer session rule cleanup failed", String(error)),
    ),
    recoverNotificationState(),
    recoverActiveTransfers().then(async (records) => {
      await Promise.all(
        Object.entries(records).map(async ([historyId, record]) => {
          if (record.requestId && OffscreenClient.canUse()) {
            await OffscreenClient.cancel(record.requestId).catch(() => {});
          }
          if (record.downloadId != null) {
            await webExtensionApi.downloads.cancel(record.downloadId).catch(() => {});
          }
          await setHistoryStatus(historyId, "DOWNLOAD_PREPARATION_INTERRUPTED", record.downloadId);
        }),
      );
    }),
  ]);
};

const reportInitFailure = (error: unknown): never => {
  addLogEntry("init failed", String(error));
  throw error;
};

backgroundRuntime.init = () =>
  Promise.all([recoverColdStartState(), reloadConfigurationAndMenus()])
    .then(() => undefined)
    .catch(reportInitFailure);

backgroundRuntime.reset = () => {
  // Serialize: overlapping inits interleave removeAll() with another
  // generation's create() calls, producing duplicate-id errors and
  // missing/duplicated menu items
  backgroundRuntime.ready = (backgroundRuntime.ready ?? Promise.resolve())
    .catch(() => {})
    .then(() => reloadConfigurationAndMenus())
    .then(() => {
      void recordDiagnosticLifecycle("configuration_reloaded");
    })
    .catch(reportInitFailure);
  return backgroundRuntime.ready;
};

// MV3: entry.background calls this synchronously at startup. Event listeners
// must be registered synchronously, or MV3 service workers/event pages will not
// wake up for the events they missed.
export const start = () => {
  addDownloadListener();
  addTabMenuListener();
  webExtensionApi.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      void recordDiagnosticLifecycle("extension_installed");
    } else if (details.reason === "update") {
      void recordDiagnosticLifecycle(
        "extension_updated",
        details.previousVersion ? { previousVersion: details.previousVersion } : {},
      );
    }
    if (details.reason !== "install") return undefined;
    return runBackgroundTask("first-install options failed", async () => {
      await webExtensionApi.storage.local
        .set({ [WELCOME_PENDING_STORAGE_KEY]: WELCOME_VERSION })
        .catch(() => {});
      await webExtensionApi.runtime.openOptionsPage();
    });
  });
  const toggleSources = (tab: CurrentTab): Promise<void> | undefined => {
    const tabId = tab.id;
    if (tabId != null)
      return runBackgroundTask("source panel toggle failed", () => toggleSourcePanelForTab(tabId));
    return undefined;
  };
  webExtensionApi.action?.onClicked.addListener(toggleSources);
  webExtensionApi.commands?.onCommand.addListener((command): Promise<void> | undefined => {
    if (command === MENU_IDS.TOGGLE_SOURCE_PANEL) {
      return runBackgroundTask("source panel command failed", async () => {
        const [tab] = await webExtensionApi.tabs.query({ active: true, currentWindow: true });
        if (tab) await toggleSources(tab);
      });
    }
    if (command === QUICK_SAVE_COMMAND) {
      return runBackgroundTask("quick save command failed", quickSaveActiveTab);
    }
    return undefined;
  });

  const initialTab = webExtensionApi.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const [tab] = tabs;
      if (!currentTab && tab) setCurrentTab(tab);
    })
    .catch(() => {});
  backgroundRuntime.ready = Promise.all([backgroundRuntime.init(), initialTab]).then(
    ([ready]) => {
      markBackgroundReady();
      return ready;
    },
    (error: unknown) => {
      markBackgroundFailed();
      throw error;
    },
  );

  webExtensionApi.tabs.onActivated.addListener((info) =>
    runBackgroundTask("tab activation failed", async () => {
      setCurrentTab(await webExtensionApi.tabs.get(info.tabId));
      await syncSourcePanelToTab(info.tabId);
    }),
  );

  webExtensionApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
    runBackgroundTask("tab update failed", async () => {
      if (!currentTab) {
        const candidate = tab || (await webExtensionApi.tabs.get(tabId));
        // A background tab can update before the startup active-tab query
        // resolves. It must not become the global fallback for unrelated saves.
        seedCurrentTab(candidate);
      } else if (currentTab.id === tabId && changeInfo.title) {
        // Mutating a property of the shared tab object (not reassigning the binding)
        currentTab.title = changeInfo.title;
      }
      // A new tab can finish loading its content script after an activation-time
      // restore message. Apply the shared state whenever any tab becomes ready.
      if (changeInfo.status === "complete") {
        await syncSourcePanelToTab(tabId);
      }
    }),
  );
};
