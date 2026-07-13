import { createWebExtensionTestHost, installHostProperty } from "./webextension-test-helpers.ts";

const host = createWebExtensionTestHost();
installHostProperty(globalThis, "browser", host.browser);
installHostProperty(globalThis, "chrome", host.chrome);
installHostProperty(globalThis, "SAVE_IN_CONTENT_E2E", true);

// Node 26 exposes an unavailable Web Storage global in some WSL hosts, which
// can shadow jsdom's implementation. Keep DOM suites on the same synchronous
// storage contract regardless of the host Node build.
if (typeof document !== "undefined" && globalThis.localStorage == null) {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => values.set(key, String(value)),
  };
  installHostProperty(globalThis, "localStorage", storage);
}
