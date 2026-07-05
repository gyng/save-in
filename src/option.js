// Short name for convenience
const T = {
  BOOL: "BOOL",
  VALUE: "VALUE",
};

let options = {};

const OptionsManagement = {
  OPTION_TYPES: T, // re-export

  OPTION_KEYS: [
    { name: "conflictAction", type: T.VALUE, default: "uniquify" },
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
        ".\nimages\nimages/cute\nvideos // (key: h)\n\nsubmenu\n>submenu/subdir\n>>submenu/subdir/2 // (alias: actual display name)\n>submenu/subdir2 // comments",
    },
    { name: "prompt", type: T.BOOL, default: false },
    { name: "promptIfNoExtension", type: T.BOOL, default: false },
    { name: "promptOnFailure", type: T.BOOL, default: true },
    { name: "promptOnShift", type: T.BOOL, default: true },
    { name: "replacementChar", type: T.VALUE, default: "_" },
    { name: "routeExclusive", type: T.BOOL, default: false },
    { name: "routeFailurePrompt", type: T.BOOL, default: false },
    { name: "selection", type: T.BOOL, default: true },
    { name: "shortcutLink", type: T.BOOL, default: false },
    { name: "shortcutMedia", type: T.BOOL, default: false },
    { name: "shortcutPage", type: T.BOOL, default: false },
    {
      name: "shortcutType",
      type: T.VALUE,
      default: SHORTCUT_TYPES.HTML_REDIRECT,
    },
    { name: "truncateLength", type: T.VALUE, default: 240 },
    { name: "setRefererHeader", type: T.BOOL, default: false },
    {
      name: "setRefererHeaderFilter",
      type: T.VALUE,
      default: "*://i.pximg.net/*",
    },
  ],

  getKeys: () => OptionsManagement.OPTION_KEYS.map((val) => val.name),

  setOption: (name, value) => {
    if (typeof value !== "undefined") {
      options[name] = value;
    }
  },

  checkRoutes: (state) => {
    if (!state) {
      return {
        path: null,
        captures: null,
      };
    }

    const newInfo = {
      ...state.info,
      filenamePatterns: options.filenamePatterns,
      filename: state.info.initialFilename ?? state.info.filename,
    };
    const last = { ...state, info: newInfo };

    const lastInterpolated = Variable.applyVariables(
      new Path.Path(Download.getRoutingMatches(last)),
      last.info
    );
    const testLastResult = lastInterpolated.finalize();

    let testLastCapture;
    for (let i = 0; i < options.filenamePatterns.length; i += 1) {
      testLastCapture = Router.getCaptureMatches(
        options.filenamePatterns[i],
        last.info,
        last.info.filename ?? last.info.url
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
  browser.storage.local
    .get(OptionsManagement.getKeys())
    .then((loadedOptions) => {
      if (loadedOptions.debug) {
        self.SI_DEBUG = 1;
      }

      const optionMap = new Map(
        OptionsManagement.OPTION_KEYS.map((ok) => [ok.name, ok])
      );
      const localKeys = Object.keys(loadedOptions);
      localKeys.forEach((k) => {
        const optionType = optionMap.get(k);
        const fn = optionType.onLoad || ((x) => x);
        OptionsManagement.setOption(k, fn(loadedOptions[k]));
      });

      return options;
    });

// global
options = Object.fromEntries(
  OptionsManagement.OPTION_KEYS.map((val) => [val.name, val.default])
);

// Export for testing
if (typeof module !== "undefined") {
  module.exports = OptionsManagement;
}
