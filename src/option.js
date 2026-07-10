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
    { name: "fetchViaContent", type: T.BOOL, default: false },
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
