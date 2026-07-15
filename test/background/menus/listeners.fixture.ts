// Context menu click handling: listeners are registered synchronously at
// service worker startup and must wait for async init before acting.
//
// menu-build/menu-click/menu-tabs and their deps are imported for real.
// importMenus resets their owner-controlled state and seeds the same module
// instances the click handlers use, so Object.assign (options,
// WEB_EXTENSION_CAPABILITIES) and vi.spyOn (Download/Notifier) reach the live
// collaborators. Shortcut is auto-mocked (see below). Path stays untouched
// (the handlers build real Path objects).

// Shortcut helpers are auto-mocked with spy:true by the test entry
// (listeners.test.ts) so the click handlers' real imported bindings resolve to
// spies the setup below can stub and the case files can assert on; unstubbed
// exports keep their real implementations. The vi.mock must live in the entry
// file: hoisting it here (an imported helper) does not register before the
// mocked module is first imported.
import { DOWNLOAD_TYPES } from "../../../src/shared/constants.ts";
import {
  makeShortcut,
  suggestShortcutFilename,
  sourceSidecarPath,
} from "../../../src/downloads/shortcut.ts";
import type { CurrentTab } from "../../../src/platform/current-tab.ts";
import type { MenuContext } from "../../../src/background/menu-build.ts";

type MenusFixture = typeof import("../../../src/background/menu-build.ts") &
  typeof import("../../../src/background/menu-click.ts") &
  typeof import("../../../src/background/menu-tabs.ts") & {
    IDS: typeof import("../../../src/background/menu-build.ts").MENU_IDS;
    state: typeof import("../../../src/background/menu-build.ts").menuState;
    pathMappings: typeof import("../../../src/background/menu-build.ts").menuState.pathMappings;
    addPaths: (paths: string[], contexts: MenuContext[]) => void;
  };
// Browser listener mocks intentionally accept partial event payloads: each test
// supplies only the host fields relevant to the branch it exercises.
type TestMenuListener = (info: any, tab?: any) => void;

function assertPresent<T>(value: T): asserts value is NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
}

// Reassigned by importMenus so the setup function and describe-scoped helpers
// below read the same dependency instances as the handlers.
let options: any;
let Download: any;
let Notifier: any;
let WEB_EXTENSION_CAPABILITIES: any;
let setCurrentTab: (tab: CurrentTab | null) => void;
let Runtime: typeof import("../../../src/background/runtime.ts").backgroundRuntime;

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
    saveSourceSidecar: false,
    closeTabOnSave: false,
    tabEnabled: true,
    keyLastUsed: "",
    recentDestinationCount: 3,
  });
  Object.assign(WEB_EXTENSION_CAPABILITIES, { tabContextMenus: false });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue({ status: "started", downloadId: 1 });
  vi.spyOn(Download, "makeObjectUrl").mockReturnValue("data:text/plain;base64,eA==");
  vi.spyOn(Notifier, "createExtensionNotification").mockImplementation(() => {});
  vi.spyOn(Notifier, "expectDownload").mockImplementation(() => {});
  vi.mocked(makeShortcut).mockReturnValue("blob:mock-shortcut");
  vi.mocked(suggestShortcutFilename).mockReturnValue("shortcut.url");
};

const importMenus = async () => {
  const menuBuild = await import("../../../src/background/menu-build.ts");
  const menuTree = await import("../../../src/menus/menu-tree.ts");
  const menuClick = await import("../../../src/background/menu-click.ts");
  const menuTabs = await import("../../../src/background/menu-tabs.ts");
  ({ options } = await import("../../../src/config/options-data.ts"));
  ({ Download } = await import("../../../src/downloads/download.ts"));
  ({ Notifier } = await import("../../../src/downloads/notification.ts"));
  ({ WEB_EXTENSION_CAPABILITIES } = await import("../../../src/platform/chrome-detector.ts"));
  ({ setCurrentTab } = await import("../../../src/platform/current-tab.ts"));
  ({ backgroundRuntime: Runtime } = await import("../../../src/background/runtime.ts"));
  menuBuild.restoreLastUsed(undefined);
  menuBuild.menuState.pathMappings = {};
  seedDeps();
  return {
    ...menuBuild,
    ...menuClick,
    ...menuTabs,
    addPaths: (paths: string[], contexts: MenuContext[]) =>
      menuBuild.renderPathTree(menuTree.buildTree(paths), contexts),
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
  makeShortcut,
  suggestShortcutFilename,
  sourceSidecarPath,
  WEB_EXTENSION_CAPABILITIES,
  setCurrentTab,
  Runtime,
  setupBrowserMocks,
  importMenus,
};
export type { MenusFixture, TestMenuListener };
