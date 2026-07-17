import {
  CONFLICT_ACTION,
  FORBIDDEN_FILENAME_CHARS,
  MAX_RECENT_DESTINATIONS,
  REJECTED_SHORTCUT_TYPES,
  SHORTCUT_TYPES,
  UNSAFE_INVISIBLE_FILENAME_CHARS,
  isShortcutType,
  type ConflictAction,
  type ShortcutType,
} from "../shared/constants.ts";
import { isSelectableLocale, type SelectableLocale } from "../shared/generated-locales.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { parseRules } from "../routing/router.ts";
import {
  CONTENT_FEATURE_OPTION_DEFINITIONS,
  LINKS_OPTION_DEFINITION,
} from "./content-option-schema.ts";
import {
  LEGACY_REFERER_HEADER_FILTER,
  OPTION_DEFAULTS,
  defaultOptions,
} from "./option-defaults.ts";
import { parseWebhookEndpoints } from "../shared/webhook.ts";
import { isStringMember } from "../shared/util.ts";

export { defaultOptions };

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
type GuardedValue<Hook> = Hook extends ((value: unknown) => value is infer Value) ? Value : never;
type ValidatedOptionValue<Definition extends OptionKey> = Definition extends {
  validate: infer Validate;
}
  ? GuardedValue<Validate>
  : never;
type StoredOptionValue<Definition extends OptionKey> = Definition extends {
  onLoad: infer Hook;
}
  ? HookInput<Hook>
  : [ValidatedOptionValue<Definition>] extends [never]
    ? WidenDefault<Definition["default"]>
    : ValidatedOptionValue<Definition>;
type RuntimeOptionValue<Definition extends OptionKey> = Definition extends {
  onLoad: infer Hook;
}
  ? HookOutput<Hook> | Definition["default"]
  : StoredOptionValue<Definition>;
type CheckedSaveHook<Definition extends OptionKey> = Definition extends {
  onSave: infer Save;
}
  ? StoredOptionValue<Definition> extends HookInput<Save>
    ? HookOutput<Save> extends StoredOptionValue<Definition>
      ? Definition
      : never
    : never
  : Definition;
type CheckedOptionHooks<Definition extends OptionKey> =
  Definition["default"] extends StoredOptionValue<Definition>
    ? Definition extends { validate: infer Validate }
      ? HookOutput<Validate> extends boolean
        ? StoredOptionValue<Definition> extends HookInput<Validate>
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
const isNonnegativeSafeWholeNumber = (value: unknown): value is string | number => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    return false;
  }
  const number = Number(value);
  return number >= 0 && Number.isSafeInteger(Math.round(number));
};

export const OPTION_KEYS = defineOptions([
  {
    name: "conflictAction",
    type: OPTION_TYPES.VALUE,
    // Imported profiles can carry Chrome's prompt mode onto Firefox, where it
    // fails the download instead of asking (#89, #217).
    onLoad: (v: ConflictAction) =>
      v === CONFLICT_ACTION.PROMPT && !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt
        ? CONFLICT_ACTION.UNIQUIFY
        : v,
    validate: (value: unknown): value is ConflictAction =>
      isStringMember(Object.values(CONFLICT_ACTION), value),
    default: OPTION_DEFAULTS.conflictAction,
  },
  ...CONTENT_FEATURE_OPTION_DEFINITIONS,
  { name: "debug", type: OPTION_TYPES.BOOL, fn: null, default: OPTION_DEFAULTS.debug },
  {
    name: "uiLocale",
    type: OPTION_TYPES.VALUE,
    validate: (value: unknown): value is "" | SelectableLocale =>
      typeof value === "string" && (value === "" || isSelectableLocale(value)),
    default: OPTION_DEFAULTS.uiLocale,
  },
  {
    name: "enableLastLocation",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.enableLastLocation,
  },
  {
    name: "recentDestinationCount",
    type: OPTION_TYPES.VALUE,
    onLoad: normalizeWholeNumber,
    onSave: normalizeWholeNumber,
    validate: (value: unknown): value is string | number => {
      if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "")
        return false;
      const count = Number(value);
      return Number.isSafeInteger(count) && count >= 0 && count <= MAX_RECENT_DESTINATIONS;
    },
    default: OPTION_DEFAULTS.recentDestinationCount,
  },
  {
    name: "enableNumberedItems",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.enableNumberedItems,
  },
  {
    name: "filenamePatterns",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim(),
    onLoad: (v: string) => parseRules(v),
    default: OPTION_DEFAULTS.filenamePatterns,
  },
  { name: "keyLastUsed", type: OPTION_TYPES.VALUE, default: OPTION_DEFAULTS.keyLastUsed },
  { name: "keyRoot", type: OPTION_TYPES.VALUE, default: OPTION_DEFAULTS.keyRoot },
  LINKS_OPTION_DEFINITION,
  { name: "preferLinks", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.preferLinks },
  {
    name: "preferLinksFilterEnabled",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.preferLinksFilterEnabled,
  },
  {
    name: "preferLinksFilter",
    type: OPTION_TYPES.VALUE,
    default: OPTION_DEFAULTS.preferLinksFilter,
  },
  {
    name: "notifyDuration",
    type: OPTION_TYPES.VALUE,
    onLoad: normalizeWholeNumber,
    onSave: normalizeWholeNumber,
    validate: isNonnegativeSafeWholeNumber,
    default: OPTION_DEFAULTS.notifyDuration,
  },
  {
    name: "notifyOnFailure",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.notifyOnFailure,
  },
  {
    name: "notifyOnRuleMatch",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.notifyOnRuleMatch,
  },
  { name: "notifyOnSuccess", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.notifyOnSuccess },
  {
    name: "notifyOnLinkPreferred",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.notifyOnLinkPreferred,
  },
  {
    name: "promptAssistantEnabled",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.promptAssistantEnabled,
  },
  { name: "page", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.page },
  {
    name: "paths",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim() || ".",
    default: OPTION_DEFAULTS.paths,
  },
  { name: "prompt", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.prompt },
  {
    name: "promptIfNoExtension",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.promptIfNoExtension,
  },
  { name: "promptOnFailure", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.promptOnFailure },
  { name: "promptOnShift", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.promptOnShift },
  {
    name: "replacementChar",
    type: OPTION_TYPES.VALUE,
    // Empty means deletion; invalid replacements must not poison every path.
    onLoad: (v: string) =>
      v &&
      (FORBIDDEN_FILENAME_CHARS.test(v) ||
        UNSAFE_INVISIBLE_FILENAME_CHARS.test(v) ||
        v === "." ||
        v === "..")
        ? "_"
        : v,
    default: OPTION_DEFAULTS.replacementChar,
  },
  { name: "routeExclusive", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.routeExclusive },
  {
    name: "routeFailurePrompt",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.routeFailurePrompt,
  },
  {
    name: "routeHideFolderChoices",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.routeHideFolderChoices,
  },
  {
    name: "routeSkipUnmatched",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.routeSkipUnmatched,
  },
  { name: "selection", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.selection },
  { name: "shortcutLink", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.shortcutLink },
  { name: "shortcutMedia", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.shortcutMedia },
  { name: "shortcutPage", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.shortcutPage },
  { name: "shortcutTab", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.shortcutTab },
  {
    name: "saveSourceSidecar",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.saveSourceSidecar,
  },
  {
    name: "shortcutType",
    type: OPTION_TYPES.VALUE,
    // Firefox rejects a download whose filename ends in a shortcut extension
    // it treats as dangerous — .url, .desktop — and fails the save outright
    // rather than renaming it (#207). Fall back to the HTML redirect, the one
    // format it accepts, so a stored or imported profile still saves something.
    onLoad: (v: ShortcutType) =>
      !WEB_EXTENSION_CAPABILITIES.shortcutFileExtensions && REJECTED_SHORTCUT_TYPES.has(v)
        ? SHORTCUT_TYPES.HTML_REDIRECT
        : v,
    validate: isShortcutType,
    default: OPTION_DEFAULTS.shortcutType,
  },
  {
    name: "truncateLength",
    type: OPTION_TYPES.VALUE,
    onLoad: normalizeWholeNumber,
    onSave: normalizeWholeNumber,
    validate: isNonnegativeSafeWholeNumber,
    default: OPTION_DEFAULTS.truncateLength,
  },
  {
    name: "appendMimeExtension",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.appendMimeExtension,
  },
  { name: "fetchViaFetch", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.fetchViaFetch },
  { name: "fallbackFetch", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.fallbackFetch },
  {
    name: "includeFetchCredentials",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.includeFetchCredentials,
  },
  {
    name: "externalDownloadAllowlist",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim(),
    default: OPTION_DEFAULTS.externalDownloadAllowlist,
  },
  {
    name: "webmcpEnabled",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webmcpEnabled,
  },
  {
    name: "webhookEnabled",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webhookEnabled,
  },
  {
    name: "webhookAllowInsecure",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webhookAllowInsecure,
  },
  {
    name: "webhookUrl",
    type: OPTION_TYPES.VALUE,
    onSave: (v: string) => v.trim(),
    // One endpoint per line. A stored value from when this held a single URL is
    // a one-line list, so it still validates exactly as it did.
    //
    // Whether http:// counts as an endpoint depends on webhookAllowInsecure,
    // and this hook is handed one option with no sight of its siblings. It
    // therefore checks the widest shape an endpoint can have -- a scheme the
    // user could legitimately have allowed -- and background/config-apply.ts
    // applies the actual policy at the write boundary, where the flag is known.
    // Being permissive here is deliberate: option.ts falls back to the default
    // when validate fails, so a stricter rule would silently empty a saved list
    // on load for anyone who had turned http:// on.
    validate: (value: unknown): value is string =>
      typeof value === "string" &&
      (value.trim() === "" ||
        parseWebhookEndpoints(value, { allowInsecure: true }).issues.length === 0),
    default: OPTION_DEFAULTS.webhookUrl,
  },
  {
    name: "webhookIncludePageUrl",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webhookIncludePageUrl,
  },
  {
    name: "webhookIncludePageTitle",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webhookIncludePageTitle,
  },
  {
    name: "webhookIncludeSelectionText",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.webhookIncludeSelectionText,
  },
  {
    name: "trackBrowserDownloads",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.trackBrowserDownloads,
  },
  {
    name: "routeBrowserDownloads",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.routeBrowserDownloads,
  },
  {
    name: "browserDownloadFiltersEnabled",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.browserDownloadFiltersEnabled,
  },
  {
    name: "browserDownloadFilter",
    type: OPTION_TYPES.VALUE,
    default: OPTION_DEFAULTS.browserDownloadFilter,
  },
  {
    name: "browserDownloadExcludeFilter",
    type: OPTION_TYPES.VALUE,
    default: OPTION_DEFAULTS.browserDownloadExcludeFilter,
  },
  {
    name: "routeBrowserDownloadsFirefox",
    type: OPTION_TYPES.BOOL,
    default: OPTION_DEFAULTS.routeBrowserDownloadsFirefox,
  },
  { name: "tabEnabled", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.tabEnabled },
  { name: "closeTabOnSave", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.closeTabOnSave },
  { name: "setRefererHeader", type: OPTION_TYPES.BOOL, default: OPTION_DEFAULTS.setRefererHeader },
  {
    name: "setRefererHeaderFilter",
    type: OPTION_TYPES.VALUE,
    // Preserve customized filters; extend only the untouched pre-v4 preset so
    // upgraded Firefox profiles gain the verified MangaDex host (#218).
    onLoad: (value: string) =>
      value === LEGACY_REFERER_HEADER_FILTER ? OPTION_DEFAULTS.setRefererHeaderFilter : value,
    default: OPTION_DEFAULTS.setRefererHeaderFilter,
  },
] as const);

export type SaveInOptions = {
  [Definition in (typeof OPTION_KEYS)[number] as Definition["name"]]: LoadedOptionValue<Definition>;
};

export type StoredSaveInOptions = {
  [Definition in (typeof OPTION_KEYS)[number] as Definition["name"]]: StoredOptionValue<Definition>;
};

export type SaveInOptionName = keyof SaveInOptions;
