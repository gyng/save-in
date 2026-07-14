/**
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {{timeoutMs?: number, description?: string, ignoreErrors?: boolean}} [options]
 * @returns {Promise<T>}
 */
export const poll = async (
  check,
  { timeoutMs = 8000, description = "condition", ignoreErrors = true } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (!ignoreErrors) throw error;
      lastError = error;
    }

    if (Date.now() >= deadline) {
      const detail = lastError
        ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : "";
      throw new Error(`Timed out waiting for ${description}${detail}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
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

export const nextBrowserTaskExpression = `new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    resolve();
  };
  channel.port2.postMessage(null);
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
      resolve(address.port);
    });
  });

/** @param {import("node:http").Server} server @returns {Promise<void>} */
export const closeLocal = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
