// Context menu click handling: listeners are registered synchronously at
// service worker startup and must wait for async init before acting.
//
// menu-build/menu-click/menu-tabs and their deps are imported for real. Each
// test resets the module registry (fresh menu state per case), so the deps are
// re-imported inside importMenus after the reset — they resolve to the same
// fresh instances the menu modules just loaded, so Object.assign (options,
// WEB_EXTENSION_CAPABILITIES) and vi.spyOn (Download/Notifier/Shortcut) reach the live
// click handlers. Path stays untouched (the handlers build real Path objects).

import { DOWNLOAD_TYPES } from "../src/shared/constants.ts";
import type { CurrentTab } from "../src/platform/current-tab.ts";

type MenusFixture = typeof import("../src/background/menu-build.ts") &
  typeof import("../src/background/menu-click.ts") &
  typeof import("../src/background/menu-tabs.ts") & {
    IDS: typeof import("../src/background/menu-build.ts").MENU_IDS;
    state: typeof import("../src/background/menu-build.ts").menuState;
    pathMappings: typeof import("../src/background/menu-build.ts").menuState.pathMappings;
    addPaths: (paths: string[], contexts: string[]) => void;
  };
// Browser listener mocks intentionally accept partial event payloads: each test
// supplies only the host fields relevant to the branch it exercises.
type TestMenuListener = (info: any, tab?: any) => void;

function assertPresent<T>(value: T): asserts value is NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
}

// Reassigned each module reset (in importMenus) to the fresh dep instances; the
// setup fn and the describe-scoped helpers below read them.
let options: any;
let Download: any;
let Notifier: any;
let Shortcut: any;
let WEB_EXTENSION_CAPABILITIES: any;
let setCurrentTab: (tab: CurrentTab | null) => void;
let Runtime: typeof import("../src/background/runtime.ts").backgroundRuntime;

const setupBrowserMocks = () => {
  (global.browser as any).contextMenus = {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn(() => Promise.resolve()),
    onClicked: { addListener: vi.fn() },
  };
  (global.browser.runtime as any).openOptionsPage = vi.fn();
  (global.browser.downloads as any).showDefaultFolder = vi.fn();
  global.browser.storage.local.set = vi.fn(() => Promise.resolve());
};

// Seed the freshly-imported deps: spy the click-handler collaborators, mutate
// the real options bag and the WEB_EXTENSION_CAPABILITIES live-binding object in place.
// Download.launch stays real (it just calls the spied renameAndDownload, then
// swallows rejections — its logging/reportFailure path is covered in
// download-flow.test).
const seedDeps = () => {
  setCurrentTab(null);
  Object.assign(options, {
    links: true,
    selection: true,
    page: true,
    enableLastLocation: true,
    enableNumberedItems: false,
    truncateLength: 240,
    // The original stubbed bag omitted replacementChar, so filename
    // sanitisation stripped forbidden chars (empty replacement) rather than
    // substituting the real default "_".
    replacementChar: undefined,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    notifyOnLinkPreferred: false,
    shortcutMedia: false,
    shortcutLink: false,
    shortcutPage: false,
    shortcutTab: false,
    shortcutType: "HTML_REDIRECT",
    closeTabOnSave: false,
    tabEnabled: true,
    keyLastUsed: "",
  });
  Object.assign(WEB_EXTENSION_CAPABILITIES, { tabContextMenus: false });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue({ status: "started", downloadId: 1 });
  vi.spyOn(Download, "makeObjectUrl").mockReturnValue("data:text/plain;base64,eA==");
  vi.spyOn(Notifier, "createExtensionNotification").mockImplementation(() => {});
  vi.spyOn(Notifier, "expectDownload").mockImplementation(() => {});
  vi.spyOn(Shortcut, "makeShortcut").mockReturnValue("blob:mock-shortcut");
  vi.spyOn(Shortcut, "suggestShortcutFilename").mockReturnValue("shortcut.url");
};

const importMenus = async () => {
  const menuBuild = await import("../src/background/menu-build.ts");
  const menuClick = await import("../src/background/menu-click.ts");
  const menuTabs = await import("../src/background/menu-tabs.ts");
  ({ options } = await import("../src/config/options-data.ts"));
  ({ Download } = await import("../src/downloads/download.ts"));
  ({ Notifier } = await import("../src/downloads/notification.ts"));
  ({ Shortcut } = await import("../src/downloads/shortcut.ts"));
  ({ WEB_EXTENSION_CAPABILITIES } = await import("../src/platform/chrome-detector.ts"));
  ({ setCurrentTab } = await import("../src/platform/current-tab.ts"));
  ({ backgroundRuntime: Runtime } = await import("../src/background/runtime.ts"));
  seedDeps();
  return {
    ...menuBuild,
    ...menuClick,
    ...menuTabs,
    addPaths: (paths: string[], contexts: string[]) =>
      menuBuild.renderPathTree(menuBuild.buildTree(paths), contexts),
    IDS: menuBuild.MENU_IDS,
    state: menuBuild.menuState,
    pathMappings: menuBuild.menuState.pathMappings,
  };
};

export {
  DOWNLOAD_TYPES,
  assertPresent,
  options,
  Download,
  Notifier,
  Shortcut,
  WEB_EXTENSION_CAPABILITIES,
  setCurrentTab,
  Runtime,
  setupBrowserMocks,
  importMenus,
};
export type { MenusFixture, TestMenuListener };
