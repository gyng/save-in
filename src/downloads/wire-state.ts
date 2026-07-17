// Marshalling between the live in-memory DownloadPipelineState and the
// clone-safe WireDownloadState the message protocol carries. Lives next to
// the pipeline state it serializes; the wire *shape* itself stays a shared
// contract in shared/message-protocol.ts.
import { isPageSourceKind } from "../shared/page-source.ts";
import {
  isBrowserTabId,
  isRoutingCounter,
  WIRE_INFO_STRING_FIELDS,
  type WireCurrentTab,
  type WireDownloadInfo,
  type WireDownloadState,
} from "../shared/message-protocol.ts";
import type { DownloadInfo, DownloadPipelineState } from "./download-types.ts";

export const toWireDownloadState = (state: DownloadPipelineState): WireDownloadState => {
  const info: WireDownloadInfo = {};
  for (const key of WIRE_INFO_STRING_FIELDS) {
    const value = state.info[key];
    if (typeof value === "string") info[key] = value;
  }
  if (isPageSourceKind(state.info.sourceKind)) info.sourceKind = state.info.sourceKind;
  for (const key of ["suggestedFilename", "menuIndex", "comment"] as const) {
    const value = state.info[key];
    if (typeof value === "string" || value === null) info[key] = value;
  }
  if (Array.isArray(state.info.modifiers)) info.modifiers = [...state.info.modifiers];
  if (typeof state.info.preview === "boolean") info.preview = state.info.preview;
  if (typeof state.info.contentFetchDisabled === "boolean") {
    info.contentFetchDisabled = state.info.contentFetchDisabled;
  }
  if (isRoutingCounter(state.info.counter)) {
    info.counter = state.info.counter;
  }
  if (state.info.now instanceof Date && Number.isFinite(state.info.now.getTime())) {
    info.now = state.info.now.toISOString();
  }
  const tab = state.info.currentTab;
  if (tab === null) {
    info.currentTab = null;
  } else if (tab) {
    const currentTab: WireCurrentTab = {};
    if (isBrowserTabId(tab.id)) currentTab.id = tab.id;
    if (typeof tab.title === "string") currentTab.title = tab.title;
    if (typeof tab.url === "string") currentTab.url = tab.url;
    if (typeof tab.incognito === "boolean") currentTab.incognito = tab.incognito;
    info.currentTab = currentTab;
  }

  const wire: WireDownloadState = { info };
  if (state.path && typeof state.path.finalize === "function") wire.path = state.path.finalize();
  if (state.route && typeof state.route.finalize === "function")
    wire.route = state.route.finalize({ finalComponentIsFilename: !state.routeIsFolder });
  if (typeof state.routeIsFolder === "boolean") wire.routeIsFolder = state.routeIsFolder;
  return wire;
};

export const fromWireDownloadState = (state: WireDownloadState): { info: DownloadInfo } => {
  const { now, currentTab: wireCurrentTab, ...info } = state.info;
  const parsedNow = typeof now === "string" ? new Date(now) : undefined;
  let currentTab: DownloadInfo["currentTab"];
  if (wireCurrentTab === null) {
    currentTab = null;
  } else if (wireCurrentTab) {
    const tab: NonNullable<DownloadInfo["currentTab"]> = {};
    if (isBrowserTabId(wireCurrentTab.id)) tab.id = wireCurrentTab.id;
    if (typeof wireCurrentTab.title === "string") tab.title = wireCurrentTab.title;
    if (typeof wireCurrentTab.url === "string") tab.url = wireCurrentTab.url;
    if (typeof wireCurrentTab.incognito === "boolean") tab.incognito = wireCurrentTab.incognito;
    currentTab = tab;
  }
  return {
    info: {
      ...info,
      ...(typeof currentTab !== "undefined" ? { currentTab } : {}),
      ...(parsedNow && Number.isFinite(parsedNow.getTime()) ? { now: parsedNow } : {}),
    },
  };
};
