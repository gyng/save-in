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
} from "../shared/constants.ts";
import {
  BROWSERS,
  CURRENT_BROWSER,
  WEB_EXTENSION_CAPABILITIES,
} from "../platform/chrome-detector.ts";
import { BackgroundState } from "../background/state.ts";
import { peekCounter, resetCounter } from "../background/counter.ts";
import { Log } from "../background/log.ts";
import { SaveHistory } from "../background/history.ts";
import { Notifier } from "../downloads/notification.ts";
import { Path } from "../routing/path.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { Download } from "../downloads/download.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { RequestHeaders } from "../downloads/headers.ts";
import { menuState } from "../background/menu-build.ts";
import { OptionsManagement, seedOptions } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { Messaging, registerMessaging } from "../background/messaging.ts";
import { registerNotifier } from "../downloads/notification.ts";
import { registerDownloadListener } from "../downloads/download.ts";
import { configureBackgroundPorts, start } from "../background/main.ts";

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
configureBackgroundPorts();
registerNotifier();
registerDownloadListener();
registerMessaging();
start();
