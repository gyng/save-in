import { isSourceSort, type SourceSort } from "./source-panel-model.ts";
import {
  SOURCE_PANEL_LAYOUT_STORAGE_KEY,
  SOURCE_PANEL_SORT_STORAGE_KEY,
} from "../shared/storage-keys.ts";

export const PANEL_DOCKS = ["right", "bottom", "left", "top"] as const;
export type PanelDock = (typeof PANEL_DOCKS)[number];
export type PanelPlacement = PanelDock | "floating";
export type SourcePanelLayout = {
  placement: PanelPlacement;
  sideWidth: number;
  dockHeight: number;
  floatingLeft: number;
  floatingTop: number;
  floatingWidth: number;
  floatingHeight: number;
};
export const DEFAULT_SOURCE_PANEL_LAYOUT: SourcePanelLayout = {
  placement: "right",
  sideWidth: 400,
  dockHeight: 420,
  floatingLeft: 80,
  floatingTop: 80,
  floatingWidth: 520,
  floatingHeight: 620,
};
const finiteLayoutNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const normalizeSourcePanelLayout = (value: unknown): SourcePanelLayout => {
  const stored =
    value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const placement = [...PANEL_DOCKS, "floating"].includes(stored.placement as PanelPlacement)
    ? (stored.placement as PanelPlacement)
    : DEFAULT_SOURCE_PANEL_LAYOUT.placement;
  return {
    placement,
    sideWidth: finiteLayoutNumber(stored.sideWidth, DEFAULT_SOURCE_PANEL_LAYOUT.sideWidth),
    dockHeight: finiteLayoutNumber(stored.dockHeight, DEFAULT_SOURCE_PANEL_LAYOUT.dockHeight),
    floatingLeft: finiteLayoutNumber(stored.floatingLeft, DEFAULT_SOURCE_PANEL_LAYOUT.floatingLeft),
    floatingTop: finiteLayoutNumber(stored.floatingTop, DEFAULT_SOURCE_PANEL_LAYOUT.floatingTop),
    floatingWidth: finiteLayoutNumber(
      stored.floatingWidth,
      DEFAULT_SOURCE_PANEL_LAYOUT.floatingWidth,
    ),
    floatingHeight: finiteLayoutNumber(
      stored.floatingHeight,
      DEFAULT_SOURCE_PANEL_LAYOUT.floatingHeight,
    ),
  };
};
export let sourcePanelLayout = { ...DEFAULT_SOURCE_PANEL_LAYOUT };
try {
  chrome.storage.local.get(SOURCE_PANEL_LAYOUT_STORAGE_KEY, (stored) => {
    void chrome.runtime.lastError;
    sourcePanelLayout = normalizeSourcePanelLayout(stored[SOURCE_PANEL_LAYOUT_STORAGE_KEY]);
  });
} catch {
  // The extension may be reloaded while this content script remains alive.
}

export const saveSourcePanelLayout = (layout: SourcePanelLayout) => {
  sourcePanelLayout = { ...layout };
  try {
    chrome.storage.local.set({ [SOURCE_PANEL_LAYOUT_STORAGE_KEY]: sourcePanelLayout }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};

export const resetSourcePanelLayoutForTesting = () => {
  sourcePanelLayout = { ...DEFAULT_SOURCE_PANEL_LAYOUT };
};

export const loadSourceSort = (apply: (sort: SourceSort) => void) => {
  try {
    chrome.storage.local.get(SOURCE_PANEL_SORT_STORAGE_KEY, (stored) => {
      void chrome.runtime.lastError;
      const sort = stored[SOURCE_PANEL_SORT_STORAGE_KEY];
      if (isSourceSort(sort)) apply(sort);
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};

export const saveSourceSort = (sort: SourceSort) => {
  try {
    chrome.storage.local.set({ [SOURCE_PANEL_SORT_STORAGE_KEY]: sort }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};
