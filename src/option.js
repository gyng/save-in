// Short name for convenience
const T = {
  BOOL: "BOOL",
  VALUE: "VALUE",
};

// Mirrors Path.SPECIAL_CHARACTERS_REGEX's forbidden set, kept independent so
// option.js doesn't depend on a real Path global under test. A stored
// replacementChar that is itself one of the characters it's meant to replace
// (or a path separator) would defeat the sanitizer (#221).
// eslint-disable-next-line no-control-regex -- control characters are forbidden replacement characters too
const FORBIDDEN_REPLACEMENT_CHAR_REGEX = /[<>:"/\\|?*\x00-\x1f]/;

let options = {};

const OptionsManagement = {
  OPTION_TYPES: T, // re-export

  OPTION_KEYS: [
    {
      name: "conflictAction",
      type: T.VALUE,
      // "prompt" is Firefox-only; a stored "prompt" on Chrome (imported
      // settings, a migrated profile) makes downloads.download reject and
      // silently kills every download (#89, #217)
      onLoad: (v) =>
        v === CONFLICT_ACTION.PROMPT && CURRENT_BROWSER === BROWSERS.CHROME
          ? CONFLICT_ACTION.UNIQUIFY
          : v,
      default: "uniquify",
    },
    { name: "contentClickToSave", type: T.BOOL, default: false },
    { name: "contentClickToSaveCombo", type: T.VALUE, default: 18 },
    {
      name: "contentClickToSaveButton",
      type: T.VALUE,
      default: CLICK_TYPES.LEFT_CLICK,
    },
    { name: "debug", type: T.BOOL, fn: null, default: false },
    { name: "enableLastLocation", type: T.BOOL, default: true },
    { name: "enableNumberedItems", type: T.BOOL, default: true },
    {
      name: "filenamePatterns",
      type: T.VALUE,
      onSave: (v) => v.trim(),
      onLoad: (v) => Router.parseRules(v),
      default: "",
    },
    { name: "keyLastUsed", type: T.VALUE, default: "e" },
    { name: "keyRoot", type: T.VALUE, default: "e" },
    { name: "links", type: T.BOOL, default: true },
    { name: "preferLinks", type: T.BOOL, default: false },
    { name: "preferLinksFilterEnabled", type: T.BOOL, default: false },
    {
      name: "preferLinksFilter",
      type: T.VALUE,
      default: ".*commons.wikimedia.org/wiki/File:.*",
    },
    { name: "notifyDuration", type: T.VALUE, default: 7000 },
    { name: "notifyOnFailure", type: T.BOOL, default: true },
    { name: "notifyOnRuleMatch", type: T.BOOL, default: true },
    { name: "notifyOnSuccess", type: T.BOOL, default: true },
    { name: "notifyOnLinkPreferred", type: T.BOOL, default: true },
    { name: "page", type: T.BOOL, default: true },
    {
      name: "paths",
      type: T.VALUE,
      onSave: (v) => v.trim() || ".",
      default:
        ". // (alias: Downloads)\nimages\nimages/cute\nvideos // (key: h)\n\nsubmenu\n>submenu/subdir\n>>submenu/subdir/2 // (alias: actual display name)\n>submenu/subdir2 // comments",
    },
    { name: "prompt", type: T.BOOL, default: false },
    { name: "promptIfNoExtension", type: T.BOOL, default: false },
    { name: "promptOnFailure", type: T.BOOL, default: true },
    { name: "promptOnShift", type: T.BOOL, default: true },
    {
      name: "replacementChar",
      type: T.VALUE,
      // Empty string is allowed and means "delete the offending character"
      // rather than replace it; a non-empty value that reintroduces a
      // forbidden character/separator or forms a dot-segment falls back to
      // the default instead of silently breaking every sanitized path (#221)
      onLoad: (v) =>
        v && (FORBIDDEN_REPLACEMENT_CHAR_REGEX.test(v) || v === "." || v === "..") ? "_" : v,
      default: "_",
    },
    { name: "routeExclusive", type: T.BOOL, default: false },
    { name: "routeFailurePrompt", type: T.BOOL, default: false },
    { name: "selection", type: T.BOOL, default: true },
    { name: "shortcutLink", type: T.BOOL, default: false },
    { name: "shortcutMedia", type: T.BOOL, default: false },
    { name: "shortcutPage", type: T.BOOL, default: false },
    { name: "shortcutTab", type: T.BOOL, default: false },
    {
      name: "shortcutType",
      type: T.VALUE,
      default: SHORTCUT_TYPES.HTML_REDIRECT,
    },
    { name: "truncateLength", type: T.VALUE, default: 240 },
    { name: "appendMimeExtension", type: T.BOOL, default: true },
    { name: "fetchViaFetch", type: T.BOOL, default: false },
    // Automatic fallback: retry a failed browser download once via a
    // background fetch (see Download.retryViaFetch)
    { name: "fallbackFetch", type: T.BOOL, default: true },
    { name: "tabEnabled", type: T.BOOL, default: false },
    { name: "closeTabOnSave", type: T.BOOL, default: false },
    { name: "setRefererHeader", type: T.BOOL, default: false },
    {
      name: "setRefererHeaderFilter",
      type: T.VALUE,
      default: "*://i.pximg.net/*",
    },
  ],

  // One-line human descriptions, surfaced by the GET_SCHEMA API so an agent (or
  // a human reading the schema) knows what each option does
  OPTION_DESCRIPTIONS: {
    conflictAction: "Filename-collision behaviour: uniquify, overwrite, or prompt (Firefox only).",
    contentClickToSave: "Enable click-to-save: hold the modifier and click media to save it.",
    contentClickToSaveCombo: "Modifier keycode for click-to-save (18 = Alt).",
    contentClickToSaveButton: "Mouse button for click-to-save.",
    debug: "Enable the session debug log.",
    enableLastLocation: "Show a 'last used' item at the top of the menu.",
    enableNumberedItems: "Add number-key access keys to submenu items.",
    filenamePatterns: "Routing/rename rules (matcher / capture / into blocks).",
    keyLastUsed: "Access key for the 'last used' menu item.",
    keyRoot: "Access key for the root 'Save In' menu.",
    links: "Enable saving of links.",
    preferLinks: "Always prefer the link over the media source.",
    preferLinksFilterEnabled: "Only prefer links on pages matching the filter.",
    preferLinksFilter: "URL match pattern for preferring links.",
    notifyDuration: "Auto-dismiss notifications after this many milliseconds.",
    notifyOnFailure: "Notify when a download fails.",
    notifyOnRuleMatch: "Notify when a routing rule matches.",
    notifyOnSuccess: "Notify when a download completes.",
    notifyOnLinkPreferred: "Notify when a link was saved instead of the source.",
    page: "Enable saving of the current page.",
    paths: "The directory menu structure (one path per line; '>' for submenus).",
    prompt: "Always open the Save As dialog.",
    promptIfNoExtension: "Open Save As when the filename has no extension.",
    promptOnFailure: "Re-prompt with Save As when a download fails.",
    promptOnShift: "Open Save As when Shift is held on click.",
    replacementChar: "Replaces filesystem-forbidden characters (blank = delete them).",
    routeExclusive: "Only save via routing rules; disables the directory submenu.",
    routeFailurePrompt: "Open Save As when no routing rule matches.",
    selection: "Enable saving selected text as a .txt file.",
    shortcutLink: "Save links as shortcut files instead of downloading.",
    shortcutMedia: "Save media as shortcut files instead of downloading.",
    shortcutPage: "Save pages as shortcut files.",
    shortcutTab: "Save tabs as shortcut files (Firefox tab menu).",
    shortcutType: "Shortcut file format (HTML redirect, .url, .desktop, .webloc).",
    truncateLength: "Truncate each path segment to this many characters (0 = no limit).",
    appendMimeExtension:
      "Append a file extension from the server's Content-Type when the filename has none.",
    fetchViaFetch: "Download via the Fetch API instead of the downloads API.",
    fallbackFetch: "Retry a failed download once via a background fetch.",
    tabEnabled: "Enable the tab-strip context menu (Firefox).",
    closeTabOnSave: "Close a tab after saving it.",
    setRefererHeader: "Set the Referer header to the page URL for matching sites.",
    setRefererHeaderFilter: "URL match patterns for the Referer header.",
  },

  getKeys: () => OptionsManagement.OPTION_KEYS.reduce((acc, val) => acc.concat([val.name]), []),

  setOption: (name, value) => {
    if (typeof value !== "undefined") {
      options[name] = value;
    }
  },

  // async because Variable.applyVariables is now async
  checkRoutes: async (state) => {
    if (!state) {
      return {
        path: null,
        captures: null,
      };
    }

    // webext linter does not support spread
    // const last = {
    //   ...state,
    //   info: {
    //     ...state.info,
    //     filenamePatterns: options.filenamePatterns
    //   }
    // };

    const newInfo = Object.assign({}, state.info, {
      filenamePatterns: options.filenamePatterns,
      // Chrome hack for filename: Chrome replaces special characters with `_`
      // This mutates(?) the last object and ruins it
      filename: state.info.initialFilename || state.info.filename,
      // Preview only: don't consume a :counter: value while dry-running rules
      preview: true,
    });
    const last = Object.assign({}, state, { info: newInfo });

    const lastInterpolated = await Variable.applyVariables(
      new Path.Path(Download.getRoutingMatches(last)),
      last.info,
    );
    const testLastResult = lastInterpolated.finalize();

    let testLastCapture;
    for (let i = 0; i < options.filenamePatterns.length; i += 1) {
      testLastCapture = Router.getCaptureMatches(
        options.filenamePatterns[i],
        last.info,
        last.info.filename || last.info.url,
      );

      if (testLastCapture) {
        break;
      }
    }

    return {
      path: testLastResult,
      captures: testLastCapture,
    };
  },
};

OptionsManagement.loadOptions = () =>
  browser.storage.local.get(OptionsManagement.getKeys()).then((loadedOptions) => {
    if (loadedOptions.debug) {
      window.SI_DEBUG = 1;
    }

    const localKeys = Object.keys(loadedOptions);
    localKeys.forEach((k) => {
      const optionType = OptionsManagement.OPTION_KEYS.find((ok) => ok.name === k);
      if (!optionType) {
        // A key from a removed option (or foreign storage) must not break load
        return;
      }
      const fn = optionType.onLoad || ((x) => x);
      OptionsManagement.setOption(k, fn(loadedOptions[k]));
    });

    return options;
  });

// global
options = OptionsManagement.OPTION_KEYS.reduce(
  (acc, val) => Object.assign(acc, { [val.name]: val.default }),
  {},
);

// Export for testing
if (typeof module !== "undefined") {
  module.exports = OptionsManagement;
}
