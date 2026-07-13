import { CLICK_TYPES, type ClickType } from "../shared/constants.ts";
import { isSelectableLocale, type SelectableLocale } from "../shared/generated-locales.ts";

export const isClickType = (value: unknown): value is ClickType =>
  typeof value === "string" && Object.values(CLICK_TYPES).includes(value as ClickType);

export const UI_THEMES = ["system", "dark", "light"] as const;
export type UiTheme = (typeof UI_THEMES)[number];
export const isUiTheme = (value: unknown): value is UiTheme =>
  typeof value === "string" && UI_THEMES.includes(value as UiTheme);

const CONTENT_CLICK_COMBO_KEY_CODES: Record<string, number> = {
  alt: 18,
  option: 18,
  ctrl: 17,
  control: 17,
  shift: 16,
  meta: 91,
  cmd: 91,
  command: 91,
  win: 91,
  windows: 91,
  super: 91,
};
const DEFAULT_CONTENT_CLICK_COMBO = "Alt";

const contentClickComboParts = (value: string | number): string[] | null => {
  if (typeof value === "number") return Number.isFinite(value) ? [String(value)] : null;
  const normalized = value.trim();
  if (!normalized || normalized.toLocaleLowerCase() === "none") return [];
  const parts = normalized.split("+").map((part) => part.trim().toLocaleLowerCase());
  return parts.every(
    (part) =>
      Boolean(part) && (part in CONTENT_CLICK_COMBO_KEY_CODES || Number.isFinite(Number(part))),
  )
    ? parts
    : null;
};

export const isContentClickCombo = (value: unknown): value is string | number =>
  (typeof value === "string" || typeof value === "number") &&
  contentClickComboParts(value) !== null;

export const contentClickComboToKeyCodes = (
  value: string | number | null | undefined,
): number[] => {
  if (value == null) return [];
  const parts = contentClickComboParts(value);
  // Invalid imported/profile values must not silently weaken the shortcut to
  // button-only. The normalizer uses the same parser, but this also keeps the
  // exported input helper safe when called directly.
  if (parts === null) {
    const fallback = CONTENT_CLICK_COMBO_KEY_CODES[DEFAULT_CONTENT_CLICK_COMBO.toLocaleLowerCase()];
    return fallback === undefined ? [] : [fallback];
  }
  return parts
    .map((part) => CONTENT_CLICK_COMBO_KEY_CODES[part] ?? Number(part))
    .filter((keyCode) => keyCode > 0);
};

// These defaults are the single source of truth for both the background schema
// and the lightweight direct-storage content path.
export const CONTENT_OPTION_DEFAULTS = {
  contentClickToSave: false,
  autoDownloadEnabled: false,
  autoDownloadRules: "",
  autoDownloadLive: true,
  autoDownloadPrivate: false,
  autoDownloadMaxPerPage: 20,
  sourcePanelEnabled: false,
  sourcePanelBackgrounds: true,
  sourcePanelLive: true,
  sourcePanelPreviews: true,
  sourcePanelResourceHints: true,
  sourcePanelLinks: true,
  uiLocale: "" as "" | SelectableLocale,
  uiTheme: "system" as UiTheme,
  contentClickToSaveCombo: DEFAULT_CONTENT_CLICK_COMBO as string | number,
  contentClickToSaveButton: CLICK_TYPES.LEFT_CLICK as ClickType,
  links: true,
};

export type ContentOptionName = keyof typeof CONTENT_OPTION_DEFAULTS;
export type ResolvedContentOptions = typeof CONTENT_OPTION_DEFAULTS;
export type ContentOptions = Partial<ResolvedContentOptions>;

export const CONTENT_OPTION_KEYS = Object.keys(CONTENT_OPTION_DEFAULTS) as ContentOptionName[];

export const isContentOptionName = (value: string): value is ContentOptionName =>
  CONTENT_OPTION_KEYS.includes(value as ContentOptionName);

export const isAutoDownloadLimit = (value: unknown): value is string | number => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "")
    return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 500;
};

export const normalizeAutoDownloadLimit = (value: string | number): number =>
  isAutoDownloadLimit(value) ? Number(value) : CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage;

export const normalizeContentOption = <Name extends ContentOptionName>(
  name: Name,
  stored: unknown,
): ResolvedContentOptions[Name] => {
  const defaultValue = CONTENT_OPTION_DEFAULTS[name];
  if (typeof stored === "undefined") return defaultValue;
  if (name === "contentClickToSaveCombo")
    return (isContentClickCombo(stored) ? stored : defaultValue) as ResolvedContentOptions[Name];
  if (name === "contentClickToSaveButton")
    return (isClickType(stored) ? stored : defaultValue) as ResolvedContentOptions[Name];
  if (name === "autoDownloadMaxPerPage")
    return normalizeAutoDownloadLimit(
      typeof stored === "string" || typeof stored === "number"
        ? stored
        : CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage,
    ) as ResolvedContentOptions[Name];
  if (name === "uiTheme")
    return (isUiTheme(stored) ? stored : defaultValue) as ResolvedContentOptions[Name];
  if (name === "uiLocale")
    return (isSelectableLocale(stored) ? stored : defaultValue) as ResolvedContentOptions[Name];
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
