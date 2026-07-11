// Shared background entry for Firefox's event page and Chrome's service
// worker. Ordinary ESM dependencies pull in the implementation; explicit
// registration calls at the bottom preserve synchronous MV3 listener setup.
// The bundle is emitted as bare scope-hoisted ESM so both classic hosts can
// execute it.

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
import { BROWSERS, CURRENT_BROWSER, WEB_EXTENSION_CAPABILITIES } from "./chrome-detector.ts";
import { BackgroundState } from "./background-state.ts";
import { peekCounter, resetCounter } from "./counter.ts";
import { Log } from "./log.ts";
import { SaveHistory } from "./history.ts";
import { Notifier } from "./notification.ts";
import { Path } from "./path.ts";
import { OffscreenClient } from "./offscreen-client.ts";
import { Download } from "./download.ts";
import { Shortcut } from "./shortcut.ts";
import { RequestHeaders } from "./headers.ts";
import { menuState } from "./menu-build.ts";
import { OptionsManagement, seedOptions } from "./option.ts";
import { options } from "./options-data.ts";
import { Messaging, registerMessaging } from "./messaging.ts";
import { registerNotifier } from "./notification.ts";
import { registerDownloadListener } from "./download.ts";
import { start } from "./background-main.ts";

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
  WEB_EXTENSION_CAPABILITIES,
  // core
  Log,
  SaveHistory,
  BackgroundState,
  peekCounter,
  resetCounter,
  Notifier,
  // The browser e2e harness constructs route values through evalSW.
  Path,
  OffscreenClient,
  Download,
  Shortcut,
  RequestHeaders,
  // Minimal state surface used by the browser harness; menu behavior remains
  // ordinary module functions rather than a runtime namespace object.
  menuState,
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
