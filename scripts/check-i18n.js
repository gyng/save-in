// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
/** @type {string[]} */
const violations = [];
/** @param {string} message */
const report = (message) => violations.push(message);
/** @param {string} file */
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

/** @param {string} label @param {string} source */
const checkDuplicateCatalogKeys = (label, source) => {
  const seen = new Set();
  for (const match of source.matchAll(/^  "([^"]+)":/gm)) {
    const key = match[1];
    if (seen.has(key)) report(`${label}: duplicate key ${key}`);
    seen.add(key);
  }
};

/** @param {string} directory @returns {string[]} */
const listFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(file) : [file];
  });

const manifestFile = path.join(root, "manifest.json");
const manifestSource = fs.readFileSync(manifestFile, "utf8");
const manifest = JSON.parse(manifestSource);
const sourceFiles = listFiles(path.join(root, "src")).filter((file) => /\.(?:html|ts)$/.test(file));
const runtimeKeys = new Set();
for (const file of [manifestFile, ...sourceFiles]) {
  const source = file === manifestFile ? manifestSource : fs.readFileSync(file, "utf8");
  if (!file.endsWith(".ts")) {
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) runtimeKeys.add(match[1]);
  }
  if (file.endsWith(".ts")) {
    for (const match of source.matchAll(
      /(?:(?<!\.)\b(?:getMessage|historyMessage|localize|message)|\b[A-Za-z_$][\w$]*\.getMessage)\(\s*["']([A-Za-z0-9_]+)["']/g,
    )) {
      runtimeKeys.add(match[1]);
    }
    // Status labels pair a static message key with an English fallback, then
    // select the pair by the stored browser status at runtime.
    for (const match of source.matchAll(/\[\s*["'](historyStatus[A-Za-z0-9_]+)["']\s*,\s*["']/g)) {
      runtimeKeys.add(match[1]);
    }
  }
}

const manifestMessagePattern = /^__MSG_[A-Za-z0-9_]+__$/;
const manifestUiStrings = [
  ["name", manifest.name],
  ["short_name", manifest.short_name],
  ["description", manifest.description],
  ["action.default_title", manifest.action?.default_title],
  ["browser_action.default_title", manifest.browser_action?.default_title],
  ["page_action.default_title", manifest.page_action?.default_title],
  ...Object.entries(manifest.commands || {}).map(([name, command]) => [
    `commands.${name}.description`,
    command?.description,
  ]),
];
for (const [location, value] of manifestUiStrings) {
  if (typeof value === "string" && !manifestMessagePattern.test(value)) {
    report(`manifest.json ${location}: user-visible value must use __MSG_key__ localization`);
  }
}

// Profiles can keep an options page alive across an extension update. Retain
// the removed dedicated automation editor's dynamic labels for that stale UI.
const retainedCompatibilityKeys = [
  "autoDownloadAddCondition",
  "autoDownloadCondition",
  "autoDownloadDeleteCondition",
  "autoDownloadDeleteRule",
  "autoDownloadDestination",
  "autoDownloadEditorMode",
  "autoDownloadEmpty",
  "autoDownloadGrammar",
  "autoDownloadIgnoreCase",
  "autoDownloadIgnoreCaseHelp",
  "autoDownloadMoveDown",
  "autoDownloadMoveUp",
  "autoDownloadNewRule",
  "autoDownloadPattern",
  "autoDownloadRule",
  "autoDownloadRuleName",
  "autoDownloadRulesHelp",
  "autoDownloadText",
  "autoDownloadVisual",
  "autoDownloadVisualInvalid",
];
retainedCompatibilityKeys.forEach((key) => runtimeKeys.add(key));
// An options page left open across an update may still render the former
// generic History export label.
runtimeKeys.add("html_export");

// Keep the reviewed History catalog batch valid when translations land before
// the options-page update that consumes them. This list is intentionally exact
// so unrelated unused messages still fail the policy check.
const catalogAheadHistoryKeys = [
  "historyActiveFilters",
  "historyCancelDownload",
  "historyCancelDownloadNamed",
  "historyCancelDownloadTitle",
  "historyCancelingDownload",
  "historyClearFailed",
  "historyClearing",
  "historyDateRangeInvalid",
  "historyDeleteAll",
  "historyDeleteConfirmDescription",
  "historyDeleteConfirmTitle",
  "historyExportAll",
  "historyFilterSearch",
  "historyFilterSince",
  "historyFilterThrough",
  "historyFilteredResultsCount",
  "historyKeepHistory",
  "historyLoadFailed",
  "historyNewer",
  "historyOlder",
  "historyPageCount",
  "historyResultCount",
  "historyResultCountOne",
  "historyRetry",
  "historyRoutingApplied",
  "historyRoutingAppliedTitle",
  "historyShowFolderFailed",
  "historyShowFolderUnavailable",
  "historyShowInFolder",
  "historyStatusCanceled",
  "historyStatusDownloadFailed",
  "historyStatusNetworkFailed",
  "historyStatusNoRuleMatch",
  "historyStatusPreparationFailed",
  "historyStatusPreparationInterrupted",
  "historyStatusRoutingFailed",
  "historyStatusSaving",
  "historyStatusStateLost",
  "historyStorageLimit",
  "historyTableCaption",
];
catalogAheadHistoryKeys.forEach((key) => runtimeKeys.add(key));

const allowedMessageFields = new Set(["description", "message", "placeholders"]);
const allowedPlaceholderFields = new Set(["content", "example"]);
/** @param {string} label @param {Record<string, any>} catalog */
const checkSchema = (label, catalog) => {
  for (const [key, definition] of Object.entries(catalog)) {
    if (!definition || typeof definition !== "object" || typeof definition.message !== "string") {
      report(`${label}.${key}: message must be a string`);
      continue;
    }
    for (const field of Object.keys(definition)) {
      if (!allowedMessageFields.has(field)) report(`${label}.${key}: unknown field ${field}`);
    }
    if (definition.description !== undefined && typeof definition.description !== "string") {
      report(`${label}.${key}: description must be a string`);
    }
    for (const [name, placeholder] of Object.entries(definition.placeholders || {})) {
      if (
        !placeholder ||
        typeof placeholder !== "object" ||
        typeof placeholder.content !== "string"
      ) {
        report(`${label}.${key}.${name}: placeholder content must be a string`);
        continue;
      }
      for (const field of Object.keys(placeholder)) {
        if (!allowedPlaceholderFields.has(field)) {
          report(`${label}.${key}.${name}: unknown placeholder field ${field}`);
        }
      }
      if (placeholder.example !== undefined && typeof placeholder.example !== "string") {
        report(`${label}.${key}.${name}: placeholder example must be a string`);
      }
    }
  }
};

const englishSource = read("_locales/en/messages.json");
checkDuplicateCatalogKeys("en", englishSource);
const english = JSON.parse(englishSource);
checkSchema("en", english);
for (const [key, definition] of Object.entries(english)) {
  if (!definition.description?.trim()) report(`en.${key}: missing translator description`);
  if (!runtimeKeys.has(key)) report(`en.${key}: not used by runtime source`);
}
for (const key of runtimeKeys) {
  if (!english[key]) report(`en: missing runtime key ${key}`);
}

/** @param {string} value */
const edgeWhitespace = (value) => [value.match(/^\s*/)?.[0] || "", value.match(/\s*$/)?.[0] || ""];
const protectedTokenPattern =
  /Save In|Chrome|Firefox|macOS|Windows|GitHub|MDN|WebMCP|WebExtensions?|Content-(?:Disposition|Type)|Referer|SHA-256|ISO 8601|JavaScript|HTML|HTTP\(S\)|HTTPS?|POST|MIME|UUID|JSON|CSV|TSV|HLS|DASH|API|CSS|UTC|PDF|\bURL(?=s?\b)|Ctrl\+Shift\+Y|Command\+Shift\+Y|\*:\/\/[^\s]+?\/\*|:[A-Za-z0-9$]+:|\$[A-Z0-9_]+\$/g;
const literalMessageKeys = [
  "o_cSaveShortcutsTypeMac",
  "o_cSaveShortcutsTypeMacWebloc",
  "o_cSaveShortcutsTypeWindows",
  "o_cSaveShortcutsTypeFreedesktop",
  "html_altOption",
  "html_command",
  "html_commandWindowsKey",
  "html_ctrl",
  "html_macctrl",
  "html_none",
  "html_shift",
];
const keyboardTokenKeys = [
  "o_cKeyboardShortcutClickToHelp",
  "o_cKeyboardShortcutModifierHelp",
  "o_cOpenDialogShift",
  "o_lShortcutFormat",
  "o_lShortcutPrimaryModifier",
  "o_lShortcutValidKey",
  "o_lSourcePanelShortcutHelp",
];
const keyboardTokenPattern = /\b(?:Alt|Shift|Ctrl|Command|MacCtrl|None|F12|PageDown)\b/g;
const browserExtensionKeys = [
  "html_allowedExtensionIds",
  "html_approvedExtensions",
  "html_extensionId",
  "html_letTrustedExtensionsSendUrlsThroughSaveInS",
  "html_noExtensionsAreApprovedExternalDownloadsAreBlockedBy",
  "html_oneExtensionIdPerLine",
  "html_onlyApprovedExtensionsCanStartDownloadsUseTheCalling",
  "html_pasteAnExtensionId",
  "html_theseExtensionsTriedToStartADownloadAddOnly",
  "html_useOneExtensionIdPerLineForBulkChanges",
  "html_webextensionsSuchAsFoxyGesturesCanMessageSaveIn",
];
/** @type {Map<string, RegExp>} */
const browserExtensionTermByLocale = new Map([
  ["de", /Erweiterung/],
  ["es", /extensi/i],
  ["fr", /extension/i],
  ["it", /estension/i],
  ["ja", /拡張機能/],
  ["ko", /확장 프로그램/],
  ["nl_AI", /extensi/i],
  ["pt_BR", /extens/i],
  ["sv_AI", /tillägg/i],
  ["zh_CN", /扩展程序/],
  ["zh_TW", /擴充功能/],
]);
const generatedRoot = path.join(root, "src", "i18n", "generated");
/** @type {{locale:string, catalog:Record<string, any>}[]} */
const generatedCatalogs = [];
for (const entry of fs.readdirSync(generatedRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const locale = entry.name;
  const catalogSource = fs.readFileSync(path.join(generatedRoot, locale, "messages.json"), "utf8");
  checkDuplicateCatalogKeys(locale, catalogSource);
  const catalog = JSON.parse(catalogSource);
  generatedCatalogs.push({ locale, catalog });
  checkSchema(locale, catalog);
  for (const key of Object.keys(catalog))
    if (!english[key]) report(`${locale}: unknown key ${key}`);
  for (const [key, canonical] of Object.entries(english)) {
    const translated = catalog[key];
    if (!translated) {
      report(`${locale}: missing key ${key}`);
      continue;
    }
    if (
      JSON.stringify(translated.placeholders || {}) !== JSON.stringify(canonical.placeholders || {})
    ) {
      report(`${locale}.${key}: placeholders differ from English`);
    }
    if (translated.message.includes("__SI_TOKEN_"))
      report(`${locale}.${key}: protected token leaked`);
    if (
      JSON.stringify(edgeWhitespace(translated.message)) !==
      JSON.stringify(edgeWhitespace(canonical.message))
    ) {
      report(`${locale}.${key}: edge whitespace differs from English`);
    }
    if (key !== "translationCredits" && /[\u200B-\u200D\uFEFF]/.test(translated.message)) {
      report(`${locale}.${key}: invisible translation artifact`);
    }
    for (const token of canonical.message.match(protectedTokenPattern) || []) {
      if (!translated.message.includes(token))
        report(`${locale}.${key}: missing technical token ${token}`);
    }
    if (canonical.message.endsWith("…") && !translated.message.endsWith("…")) {
      report(`${locale}.${key}: missing terminal ellipsis`);
    }
  }
  const translatedCount = Object.keys(catalog).filter(
    (key) => catalog[key]?.message !== english[key]?.message,
  ).length;
  if (translatedCount <= Object.keys(catalog).length * 0.8) {
    report(`${locale}: fewer than 80% of messages are translated`);
  }
  for (const key of literalMessageKeys) {
    if (catalog[key]?.message !== english[key]?.message)
      report(`${locale}.${key}: literal label changed`);
  }
  for (const key of keyboardTokenKeys) {
    for (const token of english[key]?.message.match(keyboardTokenPattern) || []) {
      if (!catalog[key]?.message.includes(token))
        report(`${locale}.${key}: missing keyboard token ${token}`);
    }
  }
  const browserExtensionTerm = browserExtensionTermByLocale.get(locale);
  if (browserExtensionTerm) {
    for (const key of browserExtensionKeys) {
      if (!browserExtensionTerm.test(catalog[key]?.message || "")) {
        report(`${locale}.${key}: missing locale browser-extension term`);
      }
    }
  }
}

const intentionallySharedEnglishKeys = new Set([
  ...literalMessageKeys,
  "contextMenuRoot",
  "extensionName",
  "historyColumnUrl",
  "o_lGithub",
  "o_lUiThemeDracula",
  "o_lUiThemeGruvbox",
  "o_lUiThemeMonokai",
  "o_lUiThemeNebula",
  "o_lUiThemeNord",
  "pathTextEmptyExample",
  "routeDebuggerSha256",
  "routeTextEmptyExample",
  "translationCredits",
]);
for (const [key, canonical] of Object.entries(english)) {
  if (intentionallySharedEnglishKeys.has(key)) continue;
  const generatedMessages = generatedCatalogs.map(({ catalog }) => catalog[key]?.message);
  if (generatedMessages.every((message) => message === canonical.message)) {
    report(`all generated locales: untranslated key ${key}`);
  } else if (generatedMessages.every((message) => message === generatedMessages[0])) {
    report(`all generated locales: shared stale or untranslated value for ${key}`);
  }
}

const intentionallyLiteralText = new Set([
  "Chrome",
  "Chrome 150+",
  "CSV",
  "Firefox",
  "GitHub",
  "JSON",
  "macOS / Linux",
  "MDN",
  "Save In",
  "TSV",
  "WebMCP",
  "Windows",
]);
const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/** @param {string} tagSource */
const parseTag = (tagSource) => {
  const name = tagSource.match(/^<\s*([\w-]+)/)?.[1]?.toLowerCase() || "";
  /** @type {Record<string, string>} */
  const attributes = {};
  const body = tagSource.replace(/^<\s*[\w-]+/, "");
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const attributeName = match[1];
    if (attributeName) {
      attributes[attributeName.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return { name, attributes };
};
/** @param {string} htmlFile */
const checkStaticHtml = (htmlFile) => {
  const source = fs.readFileSync(htmlFile, "utf8");
  /** @type {{name:string, attributes:Record<string,string>, index:number, children:number}[]} */
  const stack = [];
  for (const token of source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const { name, attributes } = parseTag(token);
      if (!name) continue;
      const parent = stack.at(-1);
      const index = parent?.children || 0;
      if (parent) parent.children += 1;
      const frame = { name, attributes, index, children: 0 };
      const ignoredAttributeContext = [frame, ...stack].some(
        ({ name: tag, attributes: attrs }) =>
          tag === "code" ||
          tag === "pre" ||
          attrs.id === "uiLocale" ||
          "data-technical-literal" in attrs,
      );
      if (!ignoredAttributeContext) {
        for (const attribute of ["alt", "aria-label", "placeholder", "title"]) {
          const value = attributes[attribute];
          if (
            value &&
            /[A-Za-z]/.test(value) &&
            !value.includes("__MSG_") &&
            !/^(?:\*:\/\/|images\/|jpg\|png$|Y$)/.test(value)
          ) {
            report(
              `${path.relative(root, htmlFile)}: unlocalized ${attribute}=${JSON.stringify(value)}`,
            );
          }
        }
      }
      if (!token.endsWith("/>") && !voidElements.has(name)) stack.push(frame);
      continue;
    }

    const text = token.replace(/\s+/g, " ").trim();
    if (!text || !/[A-Za-z]/.test(text) || text.includes("__MSG_")) continue;
    const ignored = stack.some(
      ({ name, attributes }) =>
        name === "code" ||
        name === "pre" ||
        attributes.id === "uiLocale" ||
        "data-technical-literal" in attributes,
    );
    const cell = [...stack].toReversed().find(({ name }) => name === "td");
    const referenceExample =
      cell?.index === 1 &&
      stack.some(
        ({ name, attributes }) => name === "table" && /\bbox\b/.test(attributes.class || ""),
      );
    if (
      !ignored &&
      !referenceExample &&
      !intentionallyLiteralText.has(text) &&
      !/^(?:https?:\/\/|[A-Za-z0-9_.-]+\.(?:gif|jpe?g|m3u8|mp4|png|webp))/.test(text)
    ) {
      report(`${path.relative(root, htmlFile)}: unlocalized text ${JSON.stringify(text)}`);
    }
  }
};

for (const file of sourceFiles.filter(
  (candidate) => candidate.endsWith(".html") && candidate.includes(`${path.sep}options${path.sep}`),
)) {
  checkStaticHtml(file);
}

if (violations.length) {
  for (const violation of [...new Set(violations)].toSorted()) {
    process.stderr.write(`i18n policy violation: ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Localization catalog and source checks passed.\n");
}
