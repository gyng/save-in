/**
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {{timeoutMs?: number, description?: string, ignoreErrors?: boolean, intervalMs?: number}} [options]
 * @returns {Promise<T>}
 */
export const poll = async (
  check,
  { timeoutMs = 8000, description = "condition", ignoreErrors = false, intervalMs = 25 } = {},
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

/**
 * Waits inside a browser page using DOM and interaction signals, so one
 * CDP/BiDi evaluation replaces repeated runner-to-browser polling.
 *
 * @param {(expression: string, timeoutMs?: number) => Promise<unknown>} evaluate
 * @param {string} condition
 * @param {{timeoutMs?: number, description?: string}} [options]
 * @returns {Promise<void>}
 */
export const waitForPageCondition = async (
  evaluate,
  condition,
  { timeoutMs = 8000, description = "page condition" } = {},
) => {
  await evaluate(
    `new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(${timeoutMs});
      const root = document.documentElement;
      let settled = false;
      let checking = false;
      let queued = false;
      let observer;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        document.removeEventListener("readystatechange", check);
        document.removeEventListener("focusin", check, true);
        document.removeEventListener("input", check, true);
        document.removeEventListener("change", check, true);
        timeout.removeEventListener("abort", onTimeout);
        callback();
      };
      const check = () => {
        if (settled) return;
        if (checking) {
          queued = true;
          return;
        }
        checking = true;
        Promise.resolve()
          .then(() => (${condition}))
          .then((matched) => {
            if (matched) finish(() => resolve(true));
          })
          .catch((error) => finish(() => reject(error)))
          .finally(() => {
            checking = false;
            if (queued) {
              queued = false;
              check();
            }
          });
      };
      const onTimeout = () => finish(() => reject(new Error(
        ${JSON.stringify(`Timed out waiting for ${description}`)}
      )));
      document.addEventListener("readystatechange", check);
      document.addEventListener("focusin", check, true);
      document.addEventListener("input", check, true);
      document.addEventListener("change", check, true);
      timeout.addEventListener("abort", onTimeout, { once: true });
      if (root) {
        observer = new MutationObserver(check);
        observer.observe(root, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      check();
    })`,
    timeoutMs + 1000,
  );
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

/** @param {unknown} value */
export const decodeBoolean = (value) => {
  if (typeof value !== "boolean") throw new Error("Expected an E2E boolean");
  return value;
};

/** @param {unknown} value */
export const decodeNumber = (value) => {
  if (typeof value !== "number") throw new Error("Expected an E2E number");
  return value;
};

/** @param {unknown} value */
export const decodeString = (value) => {
  if (typeof value !== "string") throw new Error("Expected an E2E string");
  return value;
};

/** @param {unknown} value */
export const decodeRecord = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an E2E record");
  }
  return /** @type {Record<string, unknown>} */ (value);
};

/**
 * @template Value
 * @param {(value: unknown) => Value} decode
 */
export const optional = (decode) => (/** @type {unknown} */ value) =>
  value === undefined ? undefined : decode(value);

/**
 * @template Value
 * @param {(value: unknown) => Value} decode
 */
export const nullable = (decode) => (/** @type {unknown} */ value) =>
  value === null ? null : decode(value);

/**
 * @template Value
 * @param {(value: unknown) => Value} decode
 */
export const arrayOf = (decode) => (/** @type {unknown} */ value) => {
  if (!Array.isArray(value)) throw new Error("Expected an E2E array");
  return value.map(decode);
};

/**
 * @template {Record<string, (value: unknown) => unknown>} Schema
 * @param {Schema} schema
 * @returns {(value: unknown) => {[Key in keyof Schema]: ReturnType<Schema[Key]>}}
 */
export const objectOf = (schema) => (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an E2E object");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, unknown>} */
  const decoded = {};
  for (const [key, decode] of Object.entries(schema)) decoded[key] = decode(record[key]);
  return /** @type {{[Key in keyof Schema]: ReturnType<Schema[Key]>}} */ (decoded);
};

/**
 * @template Value
 * @param {unknown} serialized
 * @param {(value: unknown) => Value} decode
 * @returns {Value}
 */
export const parseJson = (serialized, decode) => {
  if (typeof serialized !== "string") {
    throw new Error(`E2E JSON value was ${typeof serialized} instead of a string`);
  }
  return decode(/** @type {unknown} */ (JSON.parse(serialized)));
};

/**
 * Evaluates an expression that deliberately returns JSON, then validates the
 * parsed value before it crosses back into typed test code.
 *
 * @template Value
 * @param {(expression: string) => Promise<unknown>} evaluate
 * @param {string} expression
 * @param {(value: unknown) => Value} decode
 * @returns {Promise<Value>}
 */
export const evaluateJson = async (evaluate, expression, decode) => {
  return parseJson(await evaluate(expression), decode);
};

/**
 * Keeps a long-lived browser page out of the per-case reset path. The page is
 * refreshed at most once, immediately before a case first drives it.
 *
 * @param {{
 *   evaluate: (expression: string, timeoutMs?: number) => Promise<unknown>,
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
    // close() resolves only once EVERY connection has ended, and a request still
    // in flight -- a fixture tab mid-load on a slow runner -- never counts as
    // idle, so closing only the idle ones leaves cleanup hanging until the test's
    // own timeout. The scenario has already awaited whatever it needed from this
    // server, so drop the rest rather than wait on the browser to let go.
    server.closeAllConnections?.();
  });
