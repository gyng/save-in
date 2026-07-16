// Deliberately shared, not content-owned: background/messaging/{handlers,index}.ts
// build this copy for the external SOURCE_PANEL_COPY API, and
// content/source-panel*.ts render it. Background importing a content/
// implementation module would invert the execution-context boundary AGENTS.md
// establishes, so this stays here as a cross-context contract plus pure
// helper rather than moving into either owner (docs/CODE-ORGANIZATION.md
// Phase 3.1).
import { isStringKeyedRecord } from "./util.ts";

export type SourcePanelLocalize = (key: string, substitutions?: string | string[]) => string;

export type SourcePanelCopy = {
  title: string;
  resizeLabel: string;
  close: string;
  closeLabel: string;
  dockPositionTemplate: string;
  dockPositions: { right: string; bottom: string; left: string; top: string; floating: string };
  changeDockLabel: string;
  dockPanel: string;
  popOutPanel: string;
  popOutHelp: string;
  copyFilteredUrls: string;
  copyFilteredUrlsLabel: string;
  selectFiltered: string;
  clearSelection: string;
  selectedCountTemplate: string;
  hiddenSelectedCountTemplate: string;
  saveSelected: string;
  batchConfirmTemplate: string;
  batchContinue: string;
  batchCancel: string;
  batchSavingTemplate: string;
  batchSavedTemplate: string;
  filterSources: string;
  filterLabel: string;
  sortLabel: string;
  sort: {
    newest: string;
    relevance: string;
    oldest: string;
    largest: string;
    name: string;
  };
  kinds: {
    all: string;
    image: string;
    video: string;
    audio: string;
    document: string;
    stream: string;
    link: string;
  };
  noMatches: string;
  noMatchesFilterTemplate: string;
  noSources: string;
  clearFilters: string;
  sourceCountTemplate: string;
  embeddedSource: string;
  sourceInstructionsTemplate: string;
  sizeUnknown: string;
  detectedAtTemplate: string;
  current: string;
  previewUnavailable: string;
  locate: string;
  createAutomaticRule: string;
  save: string;
  savePlaylist: string;
  copyYtDlp: string;
  copyYtDlpHelp: string;
  moreActions: string;
  copied: string;
  copyFailed: string;
  rowInstructions: string;
  copiedUrlsTemplate: string;
};

const VALUE_SLOT = "{value}";
const URL_SLOT = "{url}";

export const formatSourcePanelCopy = (template: string, slot: string, value: string | number) =>
  template.replace(slot, String(value));

export const createSourcePanelCopy = (localize: SourcePanelLocalize): SourcePanelCopy => ({
  title: localize("o_sPageSources") || "Page sources",
  resizeLabel: localize("sourcePanelResizeLabel") || "Resize Page Sources",
  close: localize("sourcePanelClose") || "Close",
  closeLabel: localize("sourcePanelCloseLabel") || "Close Page Sources",
  dockPositionTemplate:
    localize("sourcePanelDockPosition", [VALUE_SLOT]) || `Panel position: ${VALUE_SLOT}`,
  dockPositions: {
    right: localize("sourcePanelDockRight") || "Right",
    bottom: localize("sourcePanelDockBottom") || "Bottom",
    left: localize("sourcePanelDockLeft") || "Left",
    top: localize("sourcePanelDockTop") || "Top",
    floating: localize("sourcePanelDockFloating") || "Floating",
  },
  changeDockLabel: localize("sourcePanelChangeDockLabel") || "Choose panel position",
  dockPanel: localize("sourcePanelDockPanel") || "Dock Page Sources",
  popOutPanel: localize("sourcePanelPopOutPanel") || "Pop out Page Sources",
  popOutHelp: localize("sourcePanelPopOutHelp") || "Pop out into a draggable panel",
  copyFilteredUrls: localize("sourcePanelCopyFilteredUrls") || "Copy URLs in the current filter",
  copyFilteredUrlsLabel:
    localize("sourcePanelCopyFilteredUrlsLabel") || "Copy filtered source URLs",
  selectFiltered: localize("sourcePanelSelectFiltered") || "Select filtered",
  clearSelection: localize("sourcePanelClearSelection") || "Clear selection",
  selectedCountTemplate:
    localize("sourcePanelSelectedCount", [VALUE_SLOT]) || `${VALUE_SLOT} selected`,
  hiddenSelectedCountTemplate:
    localize("sourcePanelHiddenSelectedCount", [VALUE_SLOT]) || `${VALUE_SLOT} hidden`,
  saveSelected: localize("sourcePanelSaveSelected") || "Save selected",
  batchConfirmTemplate:
    localize("sourcePanelBatchConfirm", [VALUE_SLOT]) || `Save ${VALUE_SLOT} selected sources?`,
  batchContinue: localize("sourcePanelBatchContinue") || "Save sources",
  batchCancel: localize("sourcePanelBatchCancel") || "Cancel",
  batchSavingTemplate:
    localize("sourcePanelBatchSaving", [VALUE_SLOT]) || `Saving ${VALUE_SLOT} sources…`,
  batchSavedTemplate:
    localize("sourcePanelBatchSaved", [VALUE_SLOT]) || `Started ${VALUE_SLOT} downloads`,
  filterSources: localize("html_filterSources") || "Filter sources",
  filterLabel: localize("sourcePanelFilterLabel") || "Filter page sources",
  sortLabel: localize("sourcePanelSortLabel") || "Sort sources",
  sort: {
    newest: localize("sourcePanelSortNewest") || "Newest",
    relevance: localize("sourcePanelSortRelevance") || "Relevance",
    oldest: localize("sourcePanelSortOldest") || "Oldest",
    largest: localize("sourcePanelSortLargest") || "Largest",
    name: localize("sourcePanelSortName") || "Name",
  },
  kinds: {
    all: localize("html_all") || "All",
    image: localize("html_image") || "Image",
    video: localize("html_video") || "Video",
    audio: localize("sourcePanelKindAudio") || "Audio",
    document: localize("sourcePanelKindDocument") || "Document",
    stream: localize("sourcePanelKindPlaylist") || "Playlist",
    link: localize("html_link") || "Link",
  },
  noMatches: localize("sourcePanelNoMatches") || "No sources match the current filters.",
  noMatchesFilterTemplate:
    localize("sourcePanelNoMatchesFilter", [VALUE_SLOT]) || `No sources match “${VALUE_SLOT}”.`,
  noSources:
    localize("sourcePanelNoSources") || "No page media or streaming-video playlists detected yet.",
  clearFilters: localize("sourcePanelClearFilters") || "Clear filters",
  sourceCountTemplate:
    localize("sourcePanelSourceCount", [VALUE_SLOT]) || `Sources found: ${VALUE_SLOT}`,
  embeddedSource: localize("sourcePanelEmbeddedSource") || "Embedded page source",
  sourceInstructionsTemplate:
    localize("sourcePanelSourceInstructions", [URL_SLOT]) ||
    `${URL_SLOT}. Right-click for Save In; Alt+click to save immediately.`,
  sizeUnknown: localize("sourcePanelSizeUnknown") || "size unknown",
  detectedAtTemplate:
    localize("sourcePanelDetectedAt", [VALUE_SLOT]) || `Detected at ${VALUE_SLOT}`,
  current: localize("html_current") || "Current",
  previewUnavailable: localize("sourcePanelPreviewUnavailable") || "Preview unavailable",
  locate: localize("sourcePanelLocate") || "Locate",
  createAutomaticRule: localize("sourcePanelCreateAutomaticRule") || "Create automatic rule",
  save: localize("sourcePanelSave") || "Save",
  savePlaylist: localize("sourcePanelSavePlaylist") || "Save playlist",
  copyYtDlp: localize("sourcePanelCopyYtDlp") || "Copy URL for yt-dlp",
  copyYtDlpHelp: localize("sourcePanelCopyYtDlpHelp") || "Copy the video URL to use with yt-dlp",
  moreActions: localize("sourcePanelMoreActions") || "More actions",
  copied: localize("sourcePanelCopied") || "Copied",
  copyFailed: localize("sourcePanelCopyFailed") || "Copy failed",
  rowInstructions:
    localize("sourcePanelRowInstructions") ||
    "Alt+click to save; right-click the source title for Save In",
  copiedUrlsTemplate:
    localize("sourcePanelCopiedUrls", [VALUE_SLOT]) || `Copied ${VALUE_SLOT} URLs`,
});

export const SOURCE_PANEL_COPY_VALUE_SLOT = VALUE_SLOT;
export const SOURCE_PANEL_COPY_URL_SLOT = URL_SLOT;
export const DEFAULT_SOURCE_PANEL_COPY = createSourcePanelCopy(() => "");

const matchesStringShape = (value: unknown, shape: unknown): boolean => {
  if (typeof shape === "string") return typeof value === "string";
  if (!isStringKeyedRecord(value) || !isStringKeyedRecord(shape)) return false;
  return Object.entries(shape).every(([key, nestedShape]) =>
    matchesStringShape(value[key], nestedShape),
  );
};

// Content scripts can receive responses from a stale background instance after
// an extension update. Validate every field used by the panel instead of
// promoting a partially checked structured-clone value to SourcePanelCopy.
export const isSourcePanelCopy = (value: unknown): value is SourcePanelCopy =>
  matchesStringShape(value, DEFAULT_SOURCE_PANEL_COPY);
