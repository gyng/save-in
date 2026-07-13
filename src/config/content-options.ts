import { CLICK_TYPES, type ClickType } from "../shared/constants.ts";

export const isClickType = (value: unknown): value is ClickType =>
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
