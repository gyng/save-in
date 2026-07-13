// Shared background entry for Firefox's event page and Chrome's service
// worker. Ordinary ESM dependencies pull in the implementation; explicit
// registration calls at the bottom preserve synchronous MV3 listener setup.
// The bundle is emitted as bare scope-hoisted ESM so both classic hosts can
// execute it.

import { SHORTCUT_TYPES } from "../shared/constants.ts";
import { CURRENT_BROWSER, WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { BackgroundState } from "../background/state.ts";
import { peekCounter, resetCounter } from "../background/counter.ts";
import { Log } from "../background/log.ts";
import { SaveHistory } from "../background/history.ts";
import { Notifier } from "../downloads/notification.ts";
import { Path } from "../routing/path.ts";
import { Download } from "../downloads/download.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { menuState } from "../background/menu-build.ts";
import { OptionsManagement, seedOptions } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { Messaging, registerMessaging } from "../background/messaging.ts";
import { registerNotifier } from "../downloads/notification.ts";
import { registerDownloadListener } from "../downloads/download.ts";
import { configureBackgroundPorts, start } from "../background/main.ts";
import { backgroundRuntime } from "../background/runtime.ts";
import { installBackgroundE2EBridge } from "../background/e2e-bridge.ts";

installBackgroundE2EBridge(globalThis, {
  runtime: backgroundRuntime,
  SHORTCUT_TYPES,
  CURRENT_BROWSER,
  WEB_EXTENSION_CAPABILITIES,
  Log,
  SaveHistory,
  BackgroundState,
  peekCounter,
  resetCounter,
  Notifier,
  Path,
  Download,
  Shortcut,
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
