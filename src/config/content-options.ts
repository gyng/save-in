import { CLICK_TYPES, type ClickType } from "../shared/constants.ts";

const isClickType = (value: unknown): value is ClickType =>
  typeof value === "string" && Object.values(CLICK_TYPES).includes(value as ClickType);

// These defaults are the single source of truth for both the background schema
// and the lightweight direct-storage content path.
export const CONTENT_OPTION_DEFAULTS = {
  contentClickToSave: false,
  sourcePanelEnabled: false,
  sourcePanelBackgrounds: true,
  sourcePanelLive: true,
  sourcePanelPreviews: true,
  sourcePanelResourceHints: true,
  sourcePanelLinks: true,
  contentClickToSaveCombo: "Alt" as string | number,
  contentClickToSaveButton: CLICK_TYPES.LEFT_CLICK as ClickType,
  links: true,
};

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

export const CONTENT_OPTION_DEFINITIONS = [
  ...CONTENT_FEATURE_OPTION_DEFINITIONS,
  LINKS_OPTION_DEFINITION,
] as const;

export type ContentOptionName = keyof typeof CONTENT_OPTION_DEFAULTS;
export type ResolvedContentOptions = typeof CONTENT_OPTION_DEFAULTS;
export type ContentOptions = Partial<ResolvedContentOptions>;

export const CONTENT_OPTION_KEYS = Object.keys(CONTENT_OPTION_DEFAULTS) as ContentOptionName[];

export const isContentOptionName = (value: string): value is ContentOptionName =>
  CONTENT_OPTION_KEYS.includes(value as ContentOptionName);

export const normalizeContentOption = <Name extends ContentOptionName>(
  name: Name,
  stored: unknown,
): ResolvedContentOptions[Name] => {
  const defaultValue = CONTENT_OPTION_DEFAULTS[name];
  if (typeof stored === "undefined") return defaultValue;
  if (name === "contentClickToSaveCombo")
    return (
      typeof stored === "string" || (typeof stored === "number" && Number.isFinite(stored))
        ? stored
        : defaultValue
    ) as ResolvedContentOptions[Name];
  if (name === "contentClickToSaveButton")
    return (isClickType(stored) ? stored : defaultValue) as ResolvedContentOptions[Name];
  return (
    typeof stored === typeof defaultValue ? stored : defaultValue
  ) as ResolvedContentOptions[Name];
};

export const resolveContentOptions = (stored: unknown): ResolvedContentOptions => {
  const values = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    CONTENT_OPTION_KEYS.map((name) => [name, normalizeContentOption(name, values[name])]),
  ) as ResolvedContentOptions;
};
