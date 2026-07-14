import { createWebExtensionTestHost, installHostProperty } from "./webextension-host.fixture.ts";

// These tests wait on local promises and mocked browser callbacks, not external
// services. Vitest's 50 ms polling default dominates their actual work.
const vitestWaitFor = vi.waitFor.bind(vi);
vi.waitFor = (callback, options = {}) =>
  vitestWaitFor(
    callback,
    typeof options === "number" ? { interval: 1, timeout: options } : { interval: 1, ...options },
  );

const host = createWebExtensionTestHost();
installHostProperty(globalThis, "browser", host.browser);
installHostProperty(globalThis, "chrome", host.chrome);
installHostProperty(globalThis, "SAVE_IN_CONTENT_E2E", true);

// Node 26 exposes an unavailable Web Storage getter in some WSL hosts. Do not
// invoke that getter: DOM suites only need this deterministic synchronous
// storage contract.
if (typeof document !== "undefined") {
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
