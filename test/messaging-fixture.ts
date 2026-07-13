// Background messaging: routes messages from content scripts, the options
// page, and external extensions to options/downloads.
//
// messaging.ts registers its onMessage/onMessageExternal listeners at eval, so
// the fake listener objects below are installed before it (and the real SCC it
// pulls in) evaluates — hence the dynamic imports. Its deps are then imported
// for real and controlled through vi.spyOn (methods) / Object.assign (data, and
// real Path values): the handlers assert against controlled shapes — a
// two-key option schema, a fixed matcher/variable set, a stubbed
// router/interpolator — that the real 40-key config and live routing wouldn't
// match.

import { MESSAGE_TYPES, DOWNLOAD_TYPES } from "../src/shared/constants.ts";
import type { CurrentTab } from "../src/platform/current-tab.ts";
import { clearPersistenceDiagnostics } from "../src/shared/persistence-diagnostics.ts";

// Capture the listeners registerMessaging() attaches (the shared host fixture's
// runtime events dispatch through their own internal lists, so replace them).
// These must exist before registerMessaging() runs.
(global.browser.runtime as any).onMessage = { addListener: vi.fn() };
(global.browser.runtime as any).onMessageExternal = { addListener: vi.fn() };

const { Messaging, registerMessaging } = await import("../src/background/messaging.ts");
// Imported after the fakes above: messaging.ts already pulled the whole real SCC
// into the module cache, so these return the same instances its handlers hold —
// spies / Object.assign on them reach the live code.
const { OptionsManagement } = await import("../src/config/option.ts");
const { options } = await import("../src/config/options-data.ts");
const { Download } = await import("../src/downloads/download.ts");
const { Notifier } = await import("../src/downloads/notification.ts");
const Menus = await import("../src/background/menu-build.ts");
const router = await import("../src/routing/router.ts");
const Variable = await import("../src/routing/variable.ts");
const { Path } = await import("../src/routing/path.ts");
const { setCurrentTab } = await import("../src/platform/current-tab.ts");
const { backgroundRuntime } = await import("../src/background/runtime.ts");
const { SaveHistory } = await import("../src/background/history.ts");
const { ExternalDownloadRejections } =
  await import("../src/background/external-download-rejections.ts");
const SourcePanelState = await import("../src/background/source-panel-state.ts");
const RoutePreview = await import("../src/background/route-preview.ts");

// The entry owns registration, so attach the listeners explicitly against the
// fakes above before capturing them.
registerMessaging();
const [[onMessage]] = (global.browser.runtime.onMessage.addListener as any).mock.calls;
const [[onMessageExternal]] = (global.browser.runtime.onMessageExternal.addListener as any).mock
  .calls;

// The tracked tab the handlers fall back to; a stable ref so `toBe` can assert
// identity against what setCurrentTab seeded this run.
let trackedTab: CurrentTab;

const setupGlobals = () => {
  vi.restoreAllMocks();
  clearPersistenceDiagnostics();

  trackedTab = { id: 1, title: "Tracked Tab" };
  setCurrentTab(trackedTab);
  Object.assign(options, {
    conflictAction: "uniquify",
    externalDownloadAllowlist: "trusted-extension",
  });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue({ status: "started", downloadId: 1 });
  // Download.launch stays real: it just calls renameAndDownload (the rejection
  // path it also handles is covered in download-flow.test).
  vi.spyOn(Notifier, "expectDownload").mockImplementation((url?: string) => ({ url }));
  vi.spyOn(Menus, "buildTree").mockImplementation((paths: string[]) => ({
    items: paths.map((path, index) => ({
      kind: "path",
      sourceIndex: index,
      id: `save-in-${index}`,
      title: path,
      number: index,
      parsedDir: path,
      comment: "",
      menuIndex: String(index),
      parentId: "save-in-root",
      raw: path,
    })),
    errors: [],
  }));
  vi.spyOn(router, "parseRulesCollecting").mockReturnValue({ rules: [], errors: [] });
  vi.spyOn(router, "traceRules").mockResolvedValue({ selectedRule: null } as any);
  Object.keys(Variable.transformers).forEach((key) => delete Variable.transformers[key]);
  Object.assign(Variable.transformers, { ":date:": () => {}, ":year:": () => {} });
  vi.spyOn(Variable, "applyVariables").mockImplementation((path: any) =>
    Promise.resolve({
      buf: [],
      finalize: () => `interp:${path.raw}`,
      toString: () => `interp:${path.raw}`,
    }),
  );
  Object.assign(OptionsManagement, {
    OPTION_KEYS: [
      { name: "prompt", type: "BOOL", default: false },
      { name: "paths", type: "VALUE", default: ".", onSave: (value: string) => value.trim() },
    ],
    OPTION_TYPES: { BOOL: "BOOL", VALUE: "VALUE" },
    OPTION_DESCRIPTIONS: { prompt: "Always open Save As", paths: "The menu structure" },
  });
  vi.spyOn(RoutePreview, "previewRoutes").mockReturnValue({
    path: "routed/dir",
    captures: null,
  } as any);
  vi.spyOn(SaveHistory, "get").mockResolvedValue([]);
  vi.spyOn(SaveHistory, "clear").mockResolvedValue();
  vi.spyOn(ExternalDownloadRejections, "get").mockResolvedValue([]);
  vi.spyOn(ExternalDownloadRejections, "record").mockResolvedValue();
  vi.spyOn(ExternalDownloadRejections, "clear").mockResolvedValue();
  vi.spyOn(Notifier, "reportExternalDownloadRejection").mockResolvedValue();
  vi.spyOn(SourcePanelState, "syncSourcePanelToTab").mockResolvedValue();
  vi.spyOn(SourcePanelState, "setSourcePanelOpenState").mockResolvedValue();

  backgroundRuntime.reset = vi.fn();
  delete backgroundRuntime.ready;
  backgroundRuntime.optionErrors = { paths: [], filenamePatterns: [] };
  delete backgroundRuntime.lastDownloadState;
  backgroundRuntime.debug = false;
  global.browser.runtime.sendMessage = vi.fn();
  (global.browser as any).storage = {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  };
  (global.browser.tabs as any).query = vi.fn(() => Promise.resolve([{ id: 42 }]));
  global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve());
};

export {
  MESSAGE_TYPES,
  DOWNLOAD_TYPES,
  Messaging,
  OptionsManagement,
  options,
  Download,
  Notifier,
  Menus,
  router,
  Variable,
  Path,
  setCurrentTab,
  backgroundRuntime,
  SaveHistory,
  ExternalDownloadRejections,
  SourcePanelState,
  RoutePreview,
  onMessage,
  onMessageExternal,
  trackedTab,
  setupGlobals,
};
