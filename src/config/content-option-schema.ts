import { CONTENT_OPTION_DEFAULTS, isClickType } from "./content-options.ts";

// Background-only schema metadata. The content bundle imports the shared
// defaults/normalizer, but not these definition objects.
export const CONTENT_FEATURE_OPTION_DEFINITIONS = [
  { name: "contentClickToSave", type: "BOOL", default: CONTENT_OPTION_DEFAULTS.contentClickToSave },
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
    name: "contentClickToSaveCombo",
    type: "VALUE",
    // Numeric keyCodes remain valid for settings created by older releases.
    onLoad: (value: string | number) => value,
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
