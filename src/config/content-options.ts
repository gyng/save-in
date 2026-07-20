import { CLICK_TYPES, type ClickType } from "../shared/constants.ts";
import { isSelectableLocale, type SelectableLocale } from "../shared/generated-locales.ts";
import { isStringKeyedRecord, isStringMember } from "../shared/util.ts";

export const isClickType = (value: unknown): value is ClickType =>
  isStringMember(Object.values(CLICK_TYPES), value);

const UI_THEMES = [
  "system",
  "dark",
  "light",
  "high-contrast-dark",
  "high-contrast-light",
  "high-contrast-yellow",
  "solarized-dark",
  "solarized-light",
  "nord",
  "dracula",
  "gruvbox",
  "monokai",
  "one-dark",
  "tokyo-night",
  "catppuccin",
  "midnight",
  "pastel-pink",
  "paper",
  "terminal",
  "berry",
  "nebula",
  "glacier",
  "matcha",
  "ember",
  "primary-grid",
  "blue-house",
  "gilded-mosaic",
] as const;
export type UiTheme = (typeof UI_THEMES)[number];
const isUiTheme = (value: unknown): value is UiTheme => isStringMember(UI_THEMES, value);
export const isStoredUiTheme = (value: unknown): value is UiTheme | "forest" =>
  value === "forest" || isUiTheme(value);
export const normalizeUiTheme = (value: unknown): UiTheme => {
  if (value === "forest") return "pastel-pink";
  return isUiTheme(value) ? value : "system";
};

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
const DEFAULT_CONTENT_CLICK_COMBO_KEY_CODE = 18;

const isPositiveKeyCode = (value: string | number): boolean => {
  const keyCode = Number(value);
  return Number.isSafeInteger(keyCode) && keyCode > 0;
};

const contentClickComboParts = (value: string | number): string[] | null => {
  if (typeof value === "number") return isPositiveKeyCode(value) ? [String(value)] : null;
  const normalized = value.trim();
  if (!normalized || normalized.toLocaleLowerCase() === "none") return [];
  const parts = normalized.split("+").map((part) => part.trim().toLocaleLowerCase());
  return parts.every(
    (part) =>
      Boolean(part) &&
      (Object.hasOwn(CONTENT_CLICK_COMBO_KEY_CODES, part) || isPositiveKeyCode(part)),
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
    return [DEFAULT_CONTENT_CLICK_COMBO_KEY_CODE];
  }
  return parts
    .map((part) => {
      const namedKeyCode = CONTENT_CLICK_COMBO_KEY_CODES[part];
      return Object.hasOwn(CONTENT_CLICK_COMBO_KEY_CODES, part) && typeof namedKeyCode === "number"
        ? namedKeyCode
        : Number(part);
    })
    .filter((keyCode) => keyCode > 0);
};

// These defaults are the single source of truth for both the background schema
// and the lightweight direct-storage content path.
export type ResolvedContentOptions = {
  contentClickToSave: boolean;
  autoDownloadEnabled: boolean;
  autoDownloadRules: string;
  autoDownloadLive: boolean;
  autoDownloadPrivate: boolean;
  autoDownloadLinks: boolean;
  autoDownloadDocuments: boolean;
  autoDownloadBackgrounds: boolean;
  autoDownloadManifests: boolean;
  autoDownloadDataUrls: boolean;
  autoDownloadMaxPerPage: number;
  sourcePanelEnabled: boolean;
  sourcePanelBackgrounds: boolean;
  sourcePanelLive: boolean;
  sourcePanelPreviews: boolean;
  sourcePanelResourceHints: boolean;
  sourcePanelLinks: boolean;
  uiLocale: "" | SelectableLocale;
  uiTheme: UiTheme;
  contentClickToSaveCombo: string | number;
  contentClickToSaveButton: ClickType;
  contentClickToSaveUseDefault: boolean;
  links: boolean;
  perSiteDisableList: string;
  quickSaveEnabled: boolean;
  quickSaveOnly: boolean;
  quickSaveDirectory: string;
  quickSaveUseDirectory: boolean;
};

export const CONTENT_OPTION_DEFAULTS: ResolvedContentOptions = {
  contentClickToSave: false,
  autoDownloadEnabled: false,
  autoDownloadRules: "",
  autoDownloadLive: true,
  autoDownloadPrivate: false,
  autoDownloadLinks: false,
  autoDownloadDocuments: false,
  autoDownloadBackgrounds: false,
  autoDownloadManifests: false,
  autoDownloadDataUrls: false,
  autoDownloadMaxPerPage: 20,
  sourcePanelEnabled: false,
  sourcePanelBackgrounds: true,
  sourcePanelLive: true,
  sourcePanelPreviews: true,
  sourcePanelResourceHints: true,
  sourcePanelLinks: true,
  uiLocale: "",
  uiTheme: "system",
  contentClickToSaveCombo: DEFAULT_CONTENT_CLICK_COMBO,
  contentClickToSaveButton: CLICK_TYPES.LEFT_CLICK,
  // Click-to-save inherits the last save's folder, which is what #162 asked to
  // opt out of: picking one other folder from the menu silently redirects every
  // later click. Off keeps the inheriting behavior that predates this option.
  contentClickToSaveUseDefault: false,
  links: true,
  perSiteDisableList: "",
  // Quick save keeps the menu unchanged until explicitly opted into, so the
  // context menu never grows a root save item without the user asking for it.
  quickSaveEnabled: false,
  // Browsers only collapse an extension's context-menu items into a submenu
  // when there is more than one, so offering Quick save alone is the one way to
  // reach a save in a single click (#144). Off keeps the full menu.
  quickSaveOnly: false,
  // "." is the Downloads root, matching the effective default before this
  // option existed; an absent stored key preserves that behavior.
  quickSaveDirectory: ".",
  quickSaveUseDirectory: false,
};

export type ContentOptionName = keyof typeof CONTENT_OPTION_DEFAULTS;
export type ContentOptions = Partial<ResolvedContentOptions> & { filenamePatterns?: string };

// Background-to-content updates use a small explicit message instead of a
// storage.onChanged listener in every tab. Firefox clones every changed value
// for every listener, so a growing history array otherwise becomes an
// extension-process memory multiplier even though content.ts ignores it.
export const CONTENT_OPTIONS_CHANGED_MESSAGE = "CONTENT_OPTIONS_CHANGED";

export const CONTENT_OPTION_KEYS = Object.keys(CONTENT_OPTION_DEFAULTS) as ContentOptionName[];
export const CONTENT_STORAGE_KEYS = [...CONTENT_OPTION_KEYS, "filenamePatterns"] as const;

export const isContentOptionName = (value: string): value is ContentOptionName =>
  isStringMember(CONTENT_OPTION_KEYS, value);

export const isAutoDownloadLimit = (value: unknown): value is string | number => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "")
    return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 500;
};

export const normalizeAutoDownloadLimit = (value: string | number): number =>
  isAutoDownloadLimit(value) ? Number(value) : CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage;

type ContentOptionNormalizers = {
  [Name in ContentOptionName]: (stored: unknown) => ResolvedContentOptions[Name];
};

const booleanOption =
  (fallback: boolean) =>
  (stored: unknown): boolean =>
    typeof stored === "boolean" ? stored : fallback;

const stringOption =
  (fallback: string) =>
  (stored: unknown): string =>
    typeof stored === "string" ? stored : fallback;

const CONTENT_OPTION_NORMALIZERS: ContentOptionNormalizers = {
  contentClickToSave: booleanOption(CONTENT_OPTION_DEFAULTS.contentClickToSave),
  autoDownloadEnabled: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadEnabled),
  autoDownloadRules: stringOption(CONTENT_OPTION_DEFAULTS.autoDownloadRules),
  autoDownloadLive: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadLive),
  autoDownloadPrivate: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadPrivate),
  autoDownloadLinks: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadLinks),
  autoDownloadDocuments: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadDocuments),
  autoDownloadBackgrounds: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadBackgrounds),
  autoDownloadManifests: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadManifests),
  autoDownloadDataUrls: booleanOption(CONTENT_OPTION_DEFAULTS.autoDownloadDataUrls),
  autoDownloadMaxPerPage: (stored) =>
    normalizeAutoDownloadLimit(
      typeof stored === "string" || typeof stored === "number"
        ? stored
        : CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage,
    ),
  sourcePanelEnabled: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelEnabled),
  sourcePanelBackgrounds: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelBackgrounds),
  sourcePanelLive: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelLive),
  sourcePanelPreviews: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelPreviews),
  sourcePanelResourceHints: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelResourceHints),
  sourcePanelLinks: booleanOption(CONTENT_OPTION_DEFAULTS.sourcePanelLinks),
  uiLocale: (stored) => (isSelectableLocale(stored) ? stored : CONTENT_OPTION_DEFAULTS.uiLocale),
  uiTheme: normalizeUiTheme,
  contentClickToSaveCombo: (stored) =>
    isContentClickCombo(stored) ? stored : CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo,
  contentClickToSaveUseDefault: booleanOption(CONTENT_OPTION_DEFAULTS.contentClickToSaveUseDefault),
  quickSaveOnly: booleanOption(CONTENT_OPTION_DEFAULTS.quickSaveOnly),
  contentClickToSaveButton: (stored) =>
    isClickType(stored) ? stored : CONTENT_OPTION_DEFAULTS.contentClickToSaveButton,
  links: booleanOption(CONTENT_OPTION_DEFAULTS.links),
  perSiteDisableList: stringOption(CONTENT_OPTION_DEFAULTS.perSiteDisableList),
  quickSaveEnabled: booleanOption(CONTENT_OPTION_DEFAULTS.quickSaveEnabled),
  quickSaveDirectory: stringOption(CONTENT_OPTION_DEFAULTS.quickSaveDirectory),
  quickSaveUseDirectory: booleanOption(CONTENT_OPTION_DEFAULTS.quickSaveUseDirectory),
};

export const normalizeContentOption = <Name extends ContentOptionName>(
  name: Name,
  stored: unknown,
): ResolvedContentOptions[Name] => CONTENT_OPTION_NORMALIZERS[name](stored);

export const normalizeContentOptionsPatch = (value: unknown): ContentOptions => {
  if (!isStringKeyedRecord(value)) return {};
  const normalized: ContentOptions = {};
  const assign = <Name extends ContentOptionName>(name: Name): void => {
    normalized[name] = normalizeContentOption(name, value[name]);
  };
  CONTENT_OPTION_KEYS.forEach((name) => {
    if (Object.hasOwn(value, name)) assign(name);
  });
  if (Object.hasOwn(value, "filenamePatterns")) {
    normalized.filenamePatterns =
      typeof value.filenamePatterns === "string" ? value.filenamePatterns : "";
  }
  return normalized;
};

export const resolveContentOptions = (stored: unknown): ResolvedContentOptions => {
  const values = isStringKeyedRecord(stored) ? stored : {};
  const resolved = { ...CONTENT_OPTION_DEFAULTS };
  const assign = <Name extends ContentOptionName>(name: Name): void => {
    resolved[name] = normalizeContentOption(name, values[name]);
  };
  CONTENT_OPTION_KEYS.forEach(assign);
  return resolved;
};
