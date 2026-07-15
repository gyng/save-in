import { Download } from "../downloads/download.ts";
import { resolveContent } from "../downloads/content-fetch.ts";
import { configureDownloadPorts } from "../downloads/ports.ts";
import { RefererRules } from "../downloads/referer-rules.ts";
import { launchSourceSidecar } from "../downloads/source-sidecar.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { currentTab } from "../platform/current-tab.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { nextCounter, nextPrivateCounter, peekCounter } from "./counter.ts";
import { SaveHistory } from "./history.ts";
import { Log } from "./log.ts";
import { backgroundRuntime } from "./runtime.ts";
import { counterWriteState } from "./state.ts";

export const configureBackgroundPorts = () => {
  configureDownloadPorts({
    runtime: backgroundRuntime,
    history: SaveHistory,
    log: Log,
    retry: Download.retryViaFetch,
    sourceSidecar: launchSourceSidecar,
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
