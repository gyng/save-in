// Background composition root; listener registration remains synchronous.
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage, initializeLocalization } from "../platform/localization.ts";

import { OptionsManagement } from "../config/option.ts";
import { downloadsState } from "./state.ts";
import { hydrateDownloads } from "../downloads/download-state.ts";
import { configureDownloadPorts } from "../downloads/ports.ts";
import { SaveHistory } from "./history.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { restoreLastUsed } from "./menu-build.ts";
import { addDownloadListener } from "./menu-click.ts";
import { addTabHighlightListener, addTabMenuListener } from "./menu-tabs.ts";
import { LAST_USED_META_STORAGE_KEY, LAST_USED_PATH_STORAGE_KEY } from "../shared/storage-keys.ts";
import { Log } from "./log.ts";
import { currentTab, setCurrentTab, type CurrentTab } from "../platform/current-tab.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { nextCounter, nextPrivateCounter, peekCounter } from "./counter.ts";
import { counterWriteState } from "./state.ts";
import { resolveContent } from "../downloads/content-fetch.ts";
import { syncSourcePanelToTab, toggleSourcePanelForTab } from "./source-panel-state.ts";
import { backgroundRuntime, resetRuntimeDiagnostics } from "./runtime.ts";
import { recoverNotificationState } from "../downloads/notification-recovery.ts";
import { runBackgroundTask } from "./event-task.ts";
import { Download } from "../downloads/download.ts";
import { ActiveTransfers } from "../downloads/active-transfers.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { rebuildMenus } from "./menu-rebuild.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { RefererRules } from "../downloads/referer-rules.ts";

export const configureBackgroundPorts = () => {
  configureDownloadPorts({
    runtime: backgroundRuntime,
    history: SaveHistory,
    log: Log,
    retry: Download.retryViaFetch,
  });
  configureRoutingPorts({
    getMessage,
    getCurrentTab: () => currentTab,
    isDebug: () => backgroundRuntime.debug,
    recordRuleErrors: (errors) => backgroundRuntime.optionErrors.filenamePatterns.push(...errors),
    logDebug: (...values) => console.log(...values), // eslint-disable-line no-console
    nextCounter: () => nextCounter(counterWriteState, webExtensionApi.storage.local),
    nextPrivateCounter: () => nextPrivateCounter(counterWriteState, webExtensionApi.storage.local),
    peekCounter: () => peekCounter(webExtensionApi.storage.local),
    resolveContent,
    withRequestReferer: RefererRules.withReferer,
  });
};

const reloadConfigurationAndMenus = async (): Promise<void> => {
  resetRuntimeDiagnostics();

  const [loaded, storedLastUsed] = await Promise.all([
    OptionsManagement.loadOptions().then(async (loadedOptions) => {
      await initializeLocalization(loadedOptions.uiLocale);
      return loadedOptions;
    }),
    webExtensionApi.storage.local.get([LAST_USED_PATH_STORAGE_KEY, LAST_USED_META_STORAGE_KEY]),
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
    RefererRules.cleanupStaleRule().catch((error) =>
      Log.add("Referer session rule cleanup failed", String(error)),
    ),
    recoverNotificationState(),
    ActiveTransfers.recover().then(async (records) => {
      await Promise.all(
        Object.entries(records).map(async ([historyId, record]) => {
          if (record.requestId && OffscreenClient.canUse()) {
            await OffscreenClient.cancel(record.requestId).catch(() => {});
          }
          if (record.downloadId != null) {
            await webExtensionApi.downloads.cancel(record.downloadId).catch(() => {});
          }
          await SaveHistory.setStatus(
            historyId,
            "DOWNLOAD_PREPARATION_INTERRUPTED",
            record.downloadId,
          );
        }),
      );
    }),
  ]);
};

const reportInitFailure = (error: unknown): never => {
  Log.add("init failed", String(error));
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
    .catch(reportInitFailure);
  return backgroundRuntime.ready;
};

// MV3: entry.background calls this synchronously at startup. Event listeners
// must be registered synchronously, or MV3 service workers/event pages will not
// wake up for the events they missed.
export const start = () => {
  addDownloadListener();
  addTabMenuListener();
  addTabHighlightListener();
  const toggleSources = (tab: CurrentTab): Promise<void> | undefined => {
    const tabId = tab.id;
    if (tabId != null)
      return runBackgroundTask("source panel toggle failed", () => toggleSourcePanelForTab(tabId));
    return undefined;
  };
  webExtensionApi.action?.onClicked.addListener(toggleSources);
  webExtensionApi.commands?.onCommand.addListener((command): Promise<void> | undefined => {
    if (command !== MENU_IDS.TOGGLE_SOURCE_PANEL) return undefined;
    return runBackgroundTask("source panel command failed", async () => {
      const [tab] = await webExtensionApi.tabs.query({ active: true, currentWindow: true });
      if (tab) await toggleSources(tab);
    });
  });

  const initialTab = webExtensionApi.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      const [tab] = tabs;
      if (!currentTab && tab) setCurrentTab(tab);
    })
    .catch(() => {});
  backgroundRuntime.ready = Promise.all([backgroundRuntime.init(), initialTab]).then(
    ([ready]) => ready,
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
        if (candidate.active !== false) setCurrentTab(candidate);
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
