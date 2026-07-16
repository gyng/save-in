// toggleSourcePanel wires ~10 cohesive DOM/behavior clusters (layout, menus,
// header, filter/sort, preview, selection, refresh, row rendering, the
// options-diffing update path) that all read and mutate a shared set of
// panel-lifetime locals. Threading each of those locals through builder
// function parameters and return values would multiply the surface area of
// every builder; instead every cluster reads and writes fields on one
// SourcePanelContext object created once per panel instance. This mirrors
// the "owner-controlled live binding" convention for cross-module mutable
// state (see currentTab in platform/current-tab.ts), scoped to a single
// panel rather than the whole extension.
//
// createSourcePanelContext seeds every field with a real value or a safe
// no-op placeholder so the object always satisfies SourcePanelContext, even
// before the builder that owns a field has run. Builders run synchronously,
// in dependency order, before toggleSourcePanel returns; nothing reads a
// placeholder after setup because no panel event can fire until then.
import type { PageSource, SourcePanelOptions, SourceSort } from "./source-panel-model.ts";
import type { SourcePanelCopy } from "../shared/source-panel-copy.ts";
import { DEFAULT_SOURCE_PANEL_COPY } from "../shared/source-panel-copy.ts";
import { DEFAULT_SOURCE_PANEL_LAYOUT, type SourcePanelLayout } from "./source-panel-layout.ts";
import { getPanelFormatters } from "./source-panel-format.ts";
import type { PanelDock, PanelPlacement } from "./source-panel-layout.ts";
import type { SourcePanelDownload } from "./source-panel-host.ts";

export type CachedRow = {
  source: PageSource;
  row: HTMLElement;
  deactivate: () => void;
  updateBytes: (bytes: number | undefined) => void;
  updateSelection: (selected: boolean, disabled: boolean) => void;
};

export type SourcePanelContext = {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  readonly panel: HTMLDivElement;
  readonly list: HTMLUListElement;
  readonly liveStatus: HTMLDivElement;
  readonly announce: (message: string) => void;
  /** Teardown callbacks contributed by each builder; run in panelCleanups. */
  readonly cleanupTasks: Array<() => void>;

  panelOptions: SourcePanelOptions;
  copy: SourcePanelCopy;
  formatters: { date: Intl.DateTimeFormat; number: Intl.NumberFormat };
  panelSendDownload: SourcePanelDownload;

  layout: SourcePanelLayout;
  applyLayout: () => void;
  commitLayout: () => void;
  currentDock: () => PanelDock;
  updatePlacementControls: () => void;
  resize: HTMLDivElement;

  setPanelMenuOpen: (
    details: HTMLDetailsElement,
    trigger: HTMLElement,
    menu: HTMLElement,
    open: boolean,
  ) => void;
  wirePanelMenu: (details: HTMLDetailsElement, trigger: HTMLElement, menu: HTMLElement) => void;
  schedulePanelMenuPosition: () => void;
  closeOpenMenus: () => boolean;

  header: HTMLElement;
  title: HTMLHeadingElement;
  close: HTMLButtonElement;
  dockPicker: HTMLDetailsElement;
  dockButton: HTMLElement;
  copyUrls: HTMLButtonElement;
  sourceCount: HTMLSpanElement;
  placementButtons: Map<PanelPlacement, HTMLButtonElement>;
  closePanel: () => void;

  toolbar: HTMLDivElement;
  filter: HTMLInputElement;
  sort: HTMLSelectElement;
  facets: HTMLDivElement;
  sortOptions: ReadonlyArray<readonly [SourceSort, keyof SourcePanelCopy["sort"]]>;
  applyStoredSortPreference: (storedSort: SourceSort) => void;

  queuePreview: (preview: HTMLImageElement | HTMLMediaElement, source: string) => void;
  observeExistingPreview: (preview: HTMLImageElement | HTMLMediaElement) => void;
  resetPreviewObservations: () => void;

  selectionBar: HTMLDivElement;
  batchDialog: HTMLDialogElement;
  selectFiltered: HTMLButtonElement;
  clearSelection: HTMLButtonElement;
  saveSelected: HTMLButtonElement;
  cancelBatch: HTMLButtonElement;
  continueBatch: HTMLButtonElement;
  selectedSourceUrls: Set<string>;
  suppressedSelectionClicks: WeakSet<HTMLInputElement>;
  batchSaving: boolean;
  startSelectionPaint: (event: PointerEvent, input: HTMLInputElement) => void;
  updateSelectionUi: () => void;
  updateAllSelectionRows: () => void;

  allSources: PageSource[];
  refreshSources: () => void;
  configureLiveObservers: () => void;
  resyncResourceTiming: () => void;

  rowCache: Map<string, CachedRow>;
  deactivateAndRemove: (cached: CachedRow) => void;
  highlightedElements: WeakSet<Element>;
  visibleSources: PageSource[];
  render: () => void;
};

// Placeholder for every void-returning field: every builder overwrites its
// fields before toggleSourcePanel returns, and no panel event can fire
// until then, so this body never actually runs.
/* v8 ignore next -- Placeholder overwritten by its owning builder before any call site can run. */
const noop = () => {};
const detachedDiv = () => document.createElement("div");
const detachedButton = () => document.createElement("button");

export const createSourcePanelContext = (
  host: HTMLElement,
  shadow: ShadowRoot,
  panel: HTMLDivElement,
  list: HTMLUListElement,
  liveStatus: HTMLDivElement,
  announce: (message: string) => void,
  panelOptions: SourcePanelOptions,
): SourcePanelContext => ({
  host,
  shadow,
  panel,
  list,
  liveStatus,
  announce,
  cleanupTasks: [],

  panelOptions,
  copy: panelOptions.copy || DEFAULT_SOURCE_PANEL_COPY,
  formatters: getPanelFormatters(panelOptions.locale),
  panelSendDownload: noop,

  layout: { ...DEFAULT_SOURCE_PANEL_LAYOUT },
  applyLayout: noop,
  commitLayout: noop,
  /* v8 ignore next -- Placeholder overwritten by wirePanelResize before any call site can run. */
  currentDock: () => "right",
  updatePlacementControls: noop,
  resize: detachedDiv(),

  setPanelMenuOpen: noop,
  wirePanelMenu: noop,
  schedulePanelMenuPosition: noop,
  /* v8 ignore next -- Placeholder overwritten by wirePanelMenus before any call site can run. */
  closeOpenMenus: () => false,

  header: document.createElement("header"),
  title: document.createElement("h2"),
  close: detachedButton(),
  dockPicker: document.createElement("details"),
  dockButton: document.createElement("summary"),
  copyUrls: detachedButton(),
  sourceCount: document.createElement("span"),
  placementButtons: new Map(),
  closePanel: noop,

  toolbar: detachedDiv(),
  filter: document.createElement("input"),
  sort: document.createElement("select"),
  facets: detachedDiv(),
  sortOptions: [],
  applyStoredSortPreference: noop,

  queuePreview: noop,
  observeExistingPreview: noop,
  resetPreviewObservations: noop,

  selectionBar: detachedDiv(),
  batchDialog: document.createElement("dialog"),
  selectFiltered: detachedButton(),
  clearSelection: detachedButton(),
  saveSelected: detachedButton(),
  cancelBatch: detachedButton(),
  continueBatch: detachedButton(),
  selectedSourceUrls: new Set(),
  suppressedSelectionClicks: new WeakSet(),
  batchSaving: false,
  startSelectionPaint: noop,
  updateSelectionUi: noop,
  updateAllSelectionRows: noop,

  allSources: [],
  refreshSources: noop,
  configureLiveObservers: noop,
  resyncResourceTiming: noop,

  rowCache: new Map(),
  deactivateAndRemove: noop,
  highlightedElements: new WeakSet(),
  visibleSources: [],
  render: noop,
});
