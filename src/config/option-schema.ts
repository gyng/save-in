import {
  CONFLICT_ACTION,
  FORBIDDEN_FILENAME_CHARS,
  SHORTCUT_TYPES,
  isShortcutType,
  type ConflictAction,
  type ShortcutType,
} from "../shared/constants.ts";
import { isSelectableLocale } from "../shared/generated-locales.ts";
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
  onLoad?: unknown;
  onSave?: unknown;
  validate?: unknown;
};

type HookSignature<Hook> = Hook extends (...args: infer Parameters) => infer Output
  ? { parameters: Parameters; output: Output }
  : never;
type HookInput<Hook> =
  HookSignature<Hook> extends {
    parameters: [infer Value, ...unknown[]];
  }
    ? Value
    : never;
type HookOutput<Hook> = HookSignature<Hook> extends { output: infer Output } ? Output : never;
type StoredOptionValue<Definition extends OptionKey> = Definition extends {
  onLoad: infer Hook;
}
  ? HookInput<Hook>
  : WidenDefault<Definition["default"]>;
type RuntimeOptionValue<Definition extends OptionKey> = Definition extends {
  onLoad: infer Hook;
}
  ? HookOutput<Hook> | Definition["default"]
  : WidenDefault<Definition["default"]>;
type CheckedSaveHook<Definition extends OptionKey> = Definition extends {
  onSave: infer Save;
}
  ? Definition["default"] extends HookInput<Save>
    ? HookOutput<Save> extends StoredOptionValue<Definition>
      ? Definition
      : never
    : never
  : Definition;
type CheckedOptionHooks<Definition extends OptionKey> =
  Definition["default"] extends StoredOptionValue<Definition>
    ? Definition extends { validate: infer Validate }
      ? HookOutput<Validate> extends boolean
        ? Definition["default"] extends HookInput<Validate>
          ? CheckedSaveHook<Definition>
          : never
        : never
      : CheckedSaveHook<Definition>
    : never;
type CheckedOptionDefinition<Definition extends OptionKey> =
  Definition["type"] extends typeof OPTION_TYPES.BOOL
    ? Definition["default"] extends boolean
      ? CheckedOptionHooks<Definition>
      : never
    : Definition["default"] extends string | number
      ? CheckedOptionHooks<Definition>
      : never;

const defineOptions = <const Definitions extends readonly OptionKey[]>(
  definitions: Definitions & {
    readonly [Index in keyof Definitions]: Definitions[Index] extends OptionKey
      ? CheckedOptionDefinition<Definitions[Index]>
      : never;
  },
): Definitions => definitions;

type WidenDefault<Value> = Value extends boolean
  ? boolean
  : Value extends number
    ? number
    : Value extends string
      ? string
      : Value;

type LoadedOptionValue<Definition extends OptionKey> = RuntimeOptionValue<Definition>;

const normalizeWholeNumber = (value: string | number): number => Math.round(Number(value));
const isNonnegativeNumber = (value: unknown): value is string | number => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    return false;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
};

export const OPTION_KEYS = defineOptions([
  {
    name: "conflictAction",
    type: OPTION_TYPES.VALUE,
    // Imported profiles can contain Firefox's prompt mode on Chrome.
    onLoad: (v: ConflictAction) =>
      v === CONFLICT_ACTION.PROMPT && !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt
        ? CONFLICT_ACTION.UNIQUIFY
        : v,
    validate: (value: unknown): value is ConflictAction =>
      typeof value === "string" && Object.values(CONFLICT_ACTION).includes(value as ConflictAction),
    default: CONFLICT_ACTION.UNIQUIFY,
  },
  ...CONTENT_FEATURE_OPTION_DEFINITIONS,
  { name: "debug", type: OPTION_TYPES.BOOL, fn: null, default: false },
  {
    name: "uiLocale",
    type: OPTION_TYPES.VALUE,
    validate: (value: unknown): value is string =>
      typeof value === "string" && (value === "" || isSelectableLocale(value)),
    default: "",
  },
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
    validate: isShortcutType,
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
  { name: "includeFetchCredentials", type: OPTION_TYPES.BOOL, default: true },
  {
    name: "externalDownloadAllowlist",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim(),
    default: "",
  },
  { name: "trackBrowserDownloads", type: OPTION_TYPES.BOOL, default: false },
  { name: "routeBrowserDownloads", type: OPTION_TYPES.BOOL, default: false },
  { name: "browserDownloadFilter", type: OPTION_TYPES.VALUE, default: "" },
  { name: "browserDownloadExcludeFilter", type: OPTION_TYPES.VALUE, default: "" },
  { name: "routeBrowserDownloadsFirefox", type: OPTION_TYPES.BOOL, default: false },
  { name: "tabEnabled", type: OPTION_TYPES.BOOL, default: false },
  { name: "closeTabOnSave", type: OPTION_TYPES.BOOL, default: false },
  { name: "setRefererHeader", type: OPTION_TYPES.BOOL, default: false },
  { name: "setRefererHeaderFilter", type: OPTION_TYPES.VALUE, default: "*://i.pximg.net/*" },
] as const);

export type SaveInOptions = {
  [Definition in (typeof OPTION_KEYS)[number] as Definition["name"]]: LoadedOptionValue<Definition>;
};

export type SaveInOptionName = keyof SaveInOptions;

export const defaultOptions = (): SaveInOptions =>
  Object.fromEntries(
    OPTION_KEYS.map(({ name, default: defaultValue }) => [name, defaultValue]),
  ) as SaveInOptions;
