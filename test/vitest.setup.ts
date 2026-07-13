import { createWebExtensionTestHost, installHostProperty } from "./webextension-test-helpers.ts";

const host = createWebExtensionTestHost();
installHostProperty(globalThis, "browser", host.browser);
installHostProperty(globalThis, "chrome", host.chrome);
installHostProperty(globalThis, "SAVE_IN_CONTENT_E2E", true);
