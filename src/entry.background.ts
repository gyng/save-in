// Background entry point for the rolldown bundle (Firefox event page +
// Chrome service worker). Side-effect-imports every background module in
// manifest.background.scripts order (browser-shim first … index last), then
// re-exposes the handful of objects the e2e's evalSW and cross-context code
// reach as GLOBALS on the worker/event-page scope. The bundle is emitted as
// bare scope-hoisted ESM (no export statements), so it loads as a classic
// script in both the SW (background.sw.js, with the `self.window = self` shim)
// and the Firefox event page (background.js).

import "./browser-shim.ts";
import "./vendor/content-disposition.ts";
import "./chrome-detector.ts";
import "./current-tab.ts";
import "./constants.ts";
import "./util.ts";
import "./session-state.ts";
import "./log.ts";
import "./history.ts";
import "./counter.ts";
import "./download-state.ts";
import "./notification.ts";
import "./path.ts";
import "./offscreen-client.ts";
import "./download.ts";
import "./router.ts";
import "./shortcut.ts";
import "./messaging.ts";
import "./headers.ts";
import "./variable.ts";
import "./menu-build.ts";
import "./menu-click.ts";
import "./menu-tabs.ts";
import "./option.ts";
import "./index.ts";

// Named imports for the globals evalSW (and other execution contexts) touch by
// bare name on the worker/event-page scope.
import {
  MEDIA_TYPES,
  SPECIAL_DIRS,
  SHORTCUT_TYPES,
  SHORTCUT_EXTENSIONS,
  DOWNLOAD_TYPES,
  CONFLICT_ACTION,
  RULE_TYPES,
  MESSAGE_TYPES,
  PATH_SEGMENT_TYPES,
  CLICK_TYPES,
  FORBIDDEN_FILENAME_CHARS,
} from "./constants.ts";
import { BROWSERS, CURRENT_BROWSER, BROWSER_FEATURES } from "./chrome-detector.ts";
import { Util } from "./util.ts";
import { Counter, DownloadState } from "./background-state.ts";
import { Log } from "./log.ts";
import { SaveHistory } from "./history.ts";
import { Notifier } from "./notification.ts";
import { Path } from "./path.ts";
import { OffscreenClient } from "./offscreen-client.ts";
import { Download } from "./download.ts";
import { Router } from "./router.ts";
import { Shortcut } from "./shortcut.ts";
import { RequestHeaders } from "./headers.ts";
import { Variable } from "./variable.ts";
import { Menus } from "./menu-build.ts";
import { OptionsManagement, seedOptions } from "./option.ts";
import { options } from "./options-data.ts";
import { Messaging, registerMessaging } from "./messaging.ts";
import { registerNotifier } from "./notification.ts";
import { registerDownloadListener } from "./download.ts";
import { start } from "./index.ts";

Object.assign(globalThis, {
  // constants
  MEDIA_TYPES,
  SPECIAL_DIRS,
  SHORTCUT_TYPES,
  SHORTCUT_EXTENSIONS,
  DOWNLOAD_TYPES,
  CONFLICT_ACTION,
  RULE_TYPES,
  MESSAGE_TYPES,
  PATH_SEGMENT_TYPES,
  CLICK_TYPES,
  FORBIDDEN_FILENAME_CHARS,
  // browser detection
  BROWSERS,
  CURRENT_BROWSER,
  BROWSER_FEATURES,
  // core
  Util,
  Log,
  SaveHistory,
  Counter,
  DownloadState,
  Notifier,
  Path,
  OffscreenClient,
  Download,
  Router,
  Shortcut,
  RequestHeaders,
  Variable,
  Menus,
  OptionsManagement,
  options,
  Messaging,
});

// Register the MV3 event listeners and run the background bootstrap
// synchronously at startup. Listeners MUST attach synchronously or the service
// worker / event page misses the very event that woke it (MV3 rule #1); the
// modules are otherwise import-side-effect-free so tests can import them without
// registering anything. Order mirrors the former import-eval order.
seedOptions();
registerNotifier();
registerDownloadListener();
registerMessaging();
start();
