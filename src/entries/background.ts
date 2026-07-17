// Shared background entry for Firefox's event page and Chrome's service
// worker. Ordinary ESM dependencies pull in the implementation; explicit
// registration calls at the bottom preserve synchronous MV3 listener setup.
// The bundle is emitted as bare scope-hoisted ESM so both classic hosts can
// execute it.

import { seedOptions } from "../config/option.ts";
import { registerMessaging } from "../background/messaging/index.ts";
import { registerNotifier } from "../downloads/notification.ts";
import { registerDownloadListener } from "../downloads/download.ts";
import { start } from "../background/main.ts";
import { configureBackgroundPorts } from "../background/ports.ts";

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
