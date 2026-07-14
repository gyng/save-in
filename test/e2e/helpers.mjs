/**
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {{timeoutMs?: number, description?: string, ignoreErrors?: boolean, intervalMs?: number}} [options]
 * @returns {Promise<T>}
 */
export const poll = async (
  check,
  { timeoutMs = 8000, description = "condition", ignoreErrors = true, intervalMs = 25 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastValue;

  for (;;) {
    try {
      const value = await check();
      lastValue = value;
      if (value) return value;
    } catch (error) {
      if (!ignoreErrors) throw error;
      lastError = error;
    }

    if (Date.now() >= deadline) {
      const observed = lastValue === undefined ? "" : `; last value: ${JSON.stringify(lastValue)}`;
      const detail = lastError
        ? `; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : "";
      throw new Error(`Timed out waiting for ${description}${observed}${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/** @type {E2EResourceScope | undefined} */
let activeScope;

export class E2EResourceScope {
  constructor() {
    /** @type {Array<{label: string, cleanup: () => void | Promise<void>}>} */
    this.cleanups = [];
    this.disposed = false;
  }

  /** @param {string} label @param {() => void | Promise<void>} cleanup */
  defer(label, cleanup) {
    if (this.disposed) throw new Error(`Cannot register ${label} on a disposed E2E scope`);
    const entry = { label, cleanup };
    this.cleanups.push(entry);
    return () => {
      const index = this.cleanups.indexOf(entry);
      if (index >= 0) this.cleanups.splice(index, 1);
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    /** @type {unknown[]} */
    const failures = [];
    for (const { label, cleanup } of this.cleanups.toReversed()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(new Error(`Unable to clean up ${label}`, { cause: error }));
      }
    }
    this.cleanups.length = 0;
    if (activeScope === this) activeScope = undefined;
    if (failures.length) throw new AggregateError(failures, "E2E resource cleanup failed");
  }
}

export const beginResourceScope = () => {
  if (activeScope && !activeScope.disposed) {
    throw new Error("The previous E2E resource scope was not disposed");
  }
  activeScope = new E2EResourceScope();
  return activeScope;
};

/**
 * Converts a prior assertion or poll contract into a value TypeScript can
 * safely narrow, while retaining a useful runtime failure if that contract
 * regresses.
 *
 * @template Value
 * @param {Value | null | undefined} value
 * @param {string} message
 * @returns {Value}
 */
export const requireValue = (value, message) => {
  if (value == null) throw new Error(message);
  return value;
};

/**
 * Keeps a long-lived browser page out of the per-case reset path. The page is
 * refreshed at most once, immediately before a case first drives it.
 *
 * @param {{
 *   evaluate: (expression: string, timeoutMs?: number) => Promise<any>,
 *   prepare: () => Promise<void>,
 * }} adapters
 */
export const createLazyPageEvaluator = ({ evaluate, prepare }) => {
  let ready = true;
  /** @type {Promise<void> | undefined} */
  let preparing;

  const ensureReady = async () => {
    if (ready) return;
    preparing ??= prepare()
      .then(() => {
        ready = true;
      })
      .finally(() => {
        preparing = undefined;
      });
    await preparing;
  };

  return {
    /** @param {string} expression @param {number} [timeoutMs] */
    async evaluate(expression, timeoutMs) {
      await ensureReady();
      return evaluate(expression, timeoutMs);
    },
    invalidate() {
      ready = false;
    },
    markReady() {
      ready = true;
    },
  };
};

/**
 * Builds a browser-side wait that subscribes before its initial search, so a
 * download completing during setup cannot be missed.
 *
 * @param {{filenameRegex?: string, filenameIncludes?: string, url?: string, timeoutMs?: number}} options
 */
export const waitForDownloadExpression = ({
  filenameRegex,
  filenameIncludes,
  url,
  timeoutMs = 8000,
}) => {
  const matcher = filenameRegex
    ? `new RegExp(${JSON.stringify(filenameRegex)}).test(entry.filename)`
    : filenameIncludes
      ? `entry.filename.includes(${JSON.stringify(filenameIncludes)})`
      : `entry.url === ${JSON.stringify(url)}`;
  const description = filenameRegex ?? filenameIncludes ?? url ?? "download";
  return `new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(${timeoutMs});
    const description = ${JSON.stringify(description)};
    let settled = false;
    let lastRows = [];
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      browser.downloads.onChanged.removeListener(onChanged);
      timeout.removeEventListener("abort", onTimeout);
      callback();
    };
    const fail = (error) => finish(() => reject(error));
    const check = async () => {
      const downloads = await browser.downloads.search({});
      const rows = downloads.filter((entry) => ${matcher});
      lastRows = rows.map(({ id, state, filename, url }) => ({ id, state, filename, url }));
      if (lastRows.some((entry) => entry.state === "complete")) {
        finish(() => resolve(JSON.stringify(lastRows)));
      }
    };
    const onChanged = () => void check().catch(fail);
    const onTimeout = () => fail(new Error(
      "Timed out waiting for " + description + ": " + JSON.stringify(lastRows)
    ));
    browser.downloads.onChanged.addListener(onChanged);
    timeout.addEventListener("abort", onTimeout, { once: true });
    void check().catch(fail);
  })`;
};

/**
 * @param {"history" | "logs"} collection
 * @param {string} predicate
 * @param {number} [timeoutMs]
 */
export const waitForApiEntriesExpression = (collection, predicate, timeoutMs = 8000) =>
  `new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(${timeoutMs});
    let settled = false;
    let lastEntries = [];
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      browser.storage.onChanged.removeListener(onChanged);
      timeout.removeEventListener("abort", onTimeout);
      callback();
    };
    const fail = (error) => finish(() => reject(error));
    const check = async () => {
      const entries = await api.${collection}();
      lastEntries = entries.filter(${predicate});
      if (lastEntries.length) finish(() => resolve(JSON.stringify(lastEntries)));
    };
    const onChanged = () => void check().catch(fail);
    const onTimeout = () => fail(new Error(
      "Timed out waiting for ${collection}: " + JSON.stringify(lastEntries)
    ));
    browser.storage.onChanged.addListener(onChanged);
    timeout.addEventListener("abort", onTimeout, { once: true });
    void check().catch(fail);
  })`;

/** @param {string} urlIncludes @param {number} [timeoutMs] */
export const waitForTabExpression = (urlIncludes, timeoutMs = 8000) =>
  `new Promise((resolve, reject) => {
    const target = ${JSON.stringify(urlIncludes)};
    const timeout = AbortSignal.timeout(${timeoutMs});
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      timeout.removeEventListener("abort", onTimeout);
      callback();
    };
    const fail = (error) => finish(() => reject(error));
    const check = async () => {
      const tab = (await browser.tabs.query({})).find((candidate) =>
        candidate.url?.includes(target) && candidate.status === "complete"
      );
      if (tab) {
        finish(() => resolve(JSON.stringify({ id: tab.id, url: tab.url, status: tab.status })));
      }
    };
    const onUpdated = () => void check().catch(fail);
    const onTimeout = () => fail(new Error("Timed out waiting for tab: " + target));
    browser.tabs.onUpdated.addListener(onUpdated);
    timeout.addEventListener("abort", onTimeout, { once: true });
    void check().catch(fail);
  })`;

/**
 * @param {string} source
 * @param {string} name
 * @param {string[]} [initialNames]
 * @param {number} [timeoutMs]
 */
export const appendImageAndWaitForSourceExpression = (
  source,
  name,
  initialNames = [],
  timeoutMs = 8000,
) =>
  `new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(${timeoutMs});
    const expectedInitial = ${JSON.stringify(initialNames)};
    let initial;
    let appended = false;
    let observingRoot = false;
    let observer;
    const finish = (callback) => {
      observer?.disconnect();
      timeout.removeEventListener("abort", onTimeout);
      callback();
    };
    const check = () => {
      const root = document.querySelector("#save-in-source-panel")?.shadowRoot;
      if (!root) return;
      if (!observingRoot) {
        observingRoot = true;
        observer.disconnect();
        observer.observe(root, { childList: true, subtree: true, characterData: true });
      }
      const current = [...root.querySelectorAll(".source-link .name")]
        .map((node) => node.textContent || "");
      if (!appended) {
        if (!expectedInitial.every((expected) => current.includes(expected))) return;
        initial = current;
        appended = true;
        const image = document.createElement("img");
        image.src = ${JSON.stringify(source)};
        image.alt = ${JSON.stringify(name)};
        document.body.append(image);
      }
      if (current.includes(${JSON.stringify(name)})) {
        finish(() => resolve(JSON.stringify({ initial, current })));
      }
    };
    const onTimeout = () => {
      const root = document.querySelector("#save-in-source-panel")?.shadowRoot;
      const current = root
        ? [...root.querySelectorAll(".source-link .name")].map((node) => node.textContent || "")
        : [];
      finish(() => reject(new Error(
        "Timed out waiting for Page Source ${name}: " + JSON.stringify({ initial, current })
      )));
    };
    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timeout.addEventListener("abort", onTimeout, { once: true });
    check();
  })`;

/** @param {import("node:http").Server} server @returns {Promise<number>} */
export const listenLocal = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Local test server did not bind to a TCP port"));
        return;
      }
      activeScope?.defer(`local server on port ${address.port}`, () => closeLocal(server));
      resolve(address.port);
    });
  });

/** @param {import("node:http").Server} server @returns {Promise<void>} */
export const closeLocal = (server) =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
