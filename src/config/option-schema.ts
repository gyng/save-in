import { CONFLICT_ACTION, FORBIDDEN_FILENAME_CHARS, SHORTCUT_TYPES } from "../shared/constants.ts";
import type { ConflictAction, ShortcutType } from "../shared/constants.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { parseRules } from "../routing/router.ts";
import {
  CONTENT_FEATURE_OPTION_DEFINITIONS,
  LINKS_OPTION_DEFINITION,
} from "./content-option-schema.ts";

export const OPTION_TYPES = { BOOL: "BOOL", VALUE: "VALUE" } as const;

type OptionType = (typeof OPTION_TYPES)[keyof typeof OPTION_TYPES];
type OptionKey = {
  name: string;
  type: OptionType;
  default: unknown;
  fn?: null;
  onLoad?: (...args: never[]) => unknown;
  onSave?: (...args: never[]) => unknown;
  validate?: (...args: never[]) => boolean;
};

type WidenDefault<Value> = Value extends boolean
  ? boolean
  : Value extends number
    ? number
    : Value extends string
      ? string
      : Value;

type LoadedOptionValue<Definition> = Definition extends {
  onLoad: (...args: never[]) => infer Loaded;
}
  ? Loaded
  : Definition extends { default: infer Default }
    ? WidenDefault<Default>
    : never;

const normalizeWholeNumber = (value: string | number): number => Math.round(Number(value));
const isNonnegativeNumber = (value: unknown): boolean => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    return false;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
};

export const OPTION_KEYS = [
  {
    name: "conflictAction",
    type: OPTION_TYPES.VALUE,
    // Imported profiles can contain Firefox's prompt mode on Chrome.
    onLoad: (v: ConflictAction) =>
      v === CONFLICT_ACTION.PROMPT && !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt
        ? CONFLICT_ACTION.UNIQUIFY
        : v,
    validate: (v: string) => Object.values(CONFLICT_ACTION).includes(v as ConflictAction),
    default: CONFLICT_ACTION.UNIQUIFY,
  },
  ...CONTENT_FEATURE_OPTION_DEFINITIONS,
  { name: "debug", type: OPTION_TYPES.BOOL, fn: null, default: false },
  { name: "enableLastLocation", type: OPTION_TYPES.BOOL, default: true },
  { name: "enableNumberedItems", type: OPTION_TYPES.BOOL, default: true },
  {
    name: "filenamePatterns",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim(),
    onLoad: (v: string) => parseRules(v),
    default: "",
  },
  { name: "keyLastUsed", type: OPTION_TYPES.VALUE, default: "e" },
  { name: "keyRoot", type: OPTION_TYPES.VALUE, default: "e" },
  LINKS_OPTION_DEFINITION,
  { name: "preferLinks", type: OPTION_TYPES.BOOL, default: false },
  { name: "preferLinksFilterEnabled", type: OPTION_TYPES.BOOL, default: false },
  {
    name: "preferLinksFilter",
    type: OPTION_TYPES.VALUE,
    default: ".*commons.wikimedia.org/wiki/File:.*",
  },
  {
    name: "notifyDuration",
    type: OPTION_TYPES.VALUE,
    onLoad: normalizeWholeNumber,
    onSave: normalizeWholeNumber,
    validate: isNonnegativeNumber,
    default: 7000,
  },
  { name: "notifyOnFailure", type: OPTION_TYPES.BOOL, default: true },
  { name: "notifyOnRuleMatch", type: OPTION_TYPES.BOOL, default: true },
  { name: "notifyOnSuccess", type: OPTION_TYPES.BOOL, default: true },
  { name: "notifyOnLinkPreferred", type: OPTION_TYPES.BOOL, default: true },
  { name: "page", type: OPTION_TYPES.BOOL, default: true },
  {
    name: "paths",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim() || ".",
    default: ". // (alias: Downloads)\nimages\nimages/cats\n>images/cats/tabby\nvideos",
  },
  { name: "prompt", type: OPTION_TYPES.BOOL, default: false },
  { name: "promptIfNoExtension", type: OPTION_TYPES.BOOL, default: false },
  { name: "promptOnFailure", type: OPTION_TYPES.BOOL, default: true },
  { name: "promptOnShift", type: OPTION_TYPES.BOOL, default: true },
  {
    name: "replacementChar",
    type: OPTION_TYPES.VALUE,
    // Empty means deletion; invalid replacements must not poison every path.
    onLoad: (v: string) =>
      v && (FORBIDDEN_FILENAME_CHARS.test(v) || v === "." || v === "..") ? "_" : v,
    default: "_",
  },
  { name: "routeExclusive", type: OPTION_TYPES.BOOL, default: false },
  { name: "routeFailurePrompt", type: OPTION_TYPES.BOOL, default: false },
  { name: "selection", type: OPTION_TYPES.BOOL, default: true },
  { name: "shortcutLink", type: OPTION_TYPES.BOOL, default: false },
  { name: "shortcutMedia", type: OPTION_TYPES.BOOL, default: false },
  { name: "shortcutPage", type: OPTION_TYPES.BOOL, default: false },
  { name: "shortcutTab", type: OPTION_TYPES.BOOL, default: false },
  {
    name: "shortcutType",
    type: OPTION_TYPES.VALUE,
    onLoad: (v: ShortcutType) => v,
    validate: (v: string) => Object.values(SHORTCUT_TYPES).includes(v as ShortcutType),
    default: SHORTCUT_TYPES.HTML_REDIRECT,
  },
  {
    name: "truncateLength",
    type: OPTION_TYPES.VALUE,
    onLoad: normalizeWholeNumber,
    onSave: normalizeWholeNumber,
    validate: isNonnegativeNumber,
    default: 240,
  },
  { name: "appendMimeExtension", type: OPTION_TYPES.BOOL, default: true },
  { name: "fetchViaFetch", type: OPTION_TYPES.BOOL, default: false },
  { name: "fallbackFetch", type: OPTION_TYPES.BOOL, default: true },
  { name: "trackBrowserDownloads", type: OPTION_TYPES.BOOL, default: false },
  { name: "routeBrowserDownloads", type: OPTION_TYPES.BOOL, default: false },
  { name: "browserDownloadFilter", type: OPTION_TYPES.VALUE, default: "" },
  { name: "browserDownloadExcludeFilter", type: OPTION_TYPES.VALUE, default: "" },
  { name: "routeBrowserDownloadsFirefox", type: OPTION_TYPES.BOOL, default: false },
  { name: "tabEnabled", type: OPTION_TYPES.BOOL, default: false },
  { name: "closeTabOnSave", type: OPTION_TYPES.BOOL, default: false },
  { name: "setRefererHeader", type: OPTION_TYPES.BOOL, default: false },
  { name: "setRefererHeaderFilter", type: OPTION_TYPES.VALUE, default: "*://i.pximg.net/*" },
] as const satisfies readonly OptionKey[];

export type SaveInOptions = {
  [Definition in (typeof OPTION_KEYS)[number] as Definition["name"]]: LoadedOptionValue<Definition>;
};

export type SaveInOptionName = keyof SaveInOptions;
