import { retryViaFetch } from "../downloads/download.ts";
import { resolveContent } from "../downloads/content-fetch.ts";
import { configureDownloadPorts } from "../downloads/ports.ts";
import { withRequestReferer } from "../downloads/referer-rules.ts";
import { launchSourceSidecar } from "../downloads/source-sidecar.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { currentTab } from "../platform/current-tab.ts";
import { options } from "../config/options-data.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { nextCounter, nextPrivateCounter, peekCounter } from "./counter.ts";
import {
  addHistoryEntry,
  anchorHistoryDownloadStartTime,
  getHistoryEntries,
  patchHistoryEntry,
  setHistoryDownloadId,
  setHistoryStatus,
} from "./history.ts";
import { addLogEntry } from "./log.ts";
import { backgroundRuntime } from "./runtime.ts";
import { counterWriteState } from "./application-state.ts";
import { setLastUsed, updateLastUsedMenu } from "./menu-build.ts";
import { Path } from "../routing/path.ts";

export const configureBackgroundPorts = () => {
  configureDownloadPorts({
    runtime: backgroundRuntime,
    history: {
      add: addHistoryEntry,
      patch: patchHistoryEntry,
      setDownloadId: setHistoryDownloadId,
      setStatus: setHistoryStatus,
      entries: getHistoryEntries,
      anchorStartTime: anchorHistoryDownloadStartTime,
    },
    log: { add: addLogEntry },
    retry: retryViaFetch,
    sourceSidecar: launchSourceSidecar,
    updateBrowserLastUsed: async (path) => {
      if (!new Path(path).validate().valid) return false;
      const meta = { title: path };
      await setLastUsed(path, meta);
      if (options.enableLastLocation) await updateLastUsedMenu();
      return true;
    },
  });
  configureRoutingPorts({
    getMessage,
    getCurrentTab: () => currentTab,
    isDebug: () => backgroundRuntime.debug,
    recordRuleErrors: (errors) => backgroundRuntime.optionErrors.filenamePatterns.push(...errors),
    logDebug: (...values) => console.log(...values), // eslint-disable-line no-console
    nextCounter: () => nextCounter(counterWriteState, webExtensionApi.storage.local),
    nextPrivateCounter: () =>
      options.persistPrivateActivity
        ? nextCounter(counterWriteState, webExtensionApi.storage.local)
        : nextPrivateCounter(counterWriteState, webExtensionApi.storage.local),
    peekCounter: () => peekCounter(webExtensionApi.storage.local),
    resolveContent,
    withRequestReferer,
  });
};
