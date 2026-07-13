import {
  CONTENT_OPTION_DEFAULTS,
  isAutoDownloadLimit,
  isClickType,
  isContentClickCombo,
  isUiTheme,
  normalizeAutoDownloadLimit,
} from "./content-options.ts";
import { parseAutoDownloadRules } from "../automation/auto-download-rules.ts";

// Background-only schema metadata. The content bundle imports the shared
// defaults/normalizer, but not these definition objects.
export const CONTENT_FEATURE_OPTION_DEFINITIONS = [
  { name: "contentClickToSave", type: "BOOL", default: CONTENT_OPTION_DEFAULTS.contentClickToSave },
  {
    name: "autoDownloadEnabled",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.autoDownloadEnabled,
  },
  {
    name: "autoDownloadRules",
    type: "VALUE",
    onSave: (value: string) => value.trim(),
    onLoad: (value: string) => parseAutoDownloadRules(value).rules,
    default: CONTENT_OPTION_DEFAULTS.autoDownloadRules,
  },
  {
    name: "autoDownloadLive",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.autoDownloadLive,
  },
  {
    name: "autoDownloadPrivate",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.autoDownloadPrivate,
  },
  {
    name: "autoDownloadMaxPerPage",
    type: "VALUE",
    onLoad: normalizeAutoDownloadLimit,
    onSave: normalizeAutoDownloadLimit,
    validate: isAutoDownloadLimit,
    default: CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage,
  },
  { name: "sourcePanelEnabled", type: "BOOL", default: CONTENT_OPTION_DEFAULTS.sourcePanelEnabled },
  {
    name: "sourcePanelBackgrounds",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.sourcePanelBackgrounds,
  },
  { name: "sourcePanelLive", type: "BOOL", default: CONTENT_OPTION_DEFAULTS.sourcePanelLive },
  {
    name: "sourcePanelPreviews",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.sourcePanelPreviews,
  },
  {
    name: "sourcePanelResourceHints",
    type: "BOOL",
    default: CONTENT_OPTION_DEFAULTS.sourcePanelResourceHints,
  },
  { name: "sourcePanelLinks", type: "BOOL", default: CONTENT_OPTION_DEFAULTS.sourcePanelLinks },
  {
    name: "uiTheme",
    type: "VALUE",
    validate: isUiTheme,
    default: CONTENT_OPTION_DEFAULTS.uiTheme,
  },
  {
    name: "contentClickToSaveCombo",
    type: "VALUE",
    // Numeric keyCodes remain valid for settings created by older releases.
    onLoad: (value: string | number) => value,
    validate: isContentClickCombo,
    default: CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo,
  },
  {
    name: "contentClickToSaveButton",
    type: "VALUE",
    validate: isClickType,
    default: CONTENT_OPTION_DEFAULTS.contentClickToSaveButton,
  },
] as const;

export const LINKS_OPTION_DEFINITION = {
  name: "links",
  type: "BOOL",
  default: CONTENT_OPTION_DEFAULTS.links,
} as const;
