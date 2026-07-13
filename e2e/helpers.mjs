/**
 * @template T
 * @param {() => T | Promise<T>} check
 * @param {{timeoutMs?: number, intervalMs?: number, description?: string, ignoreErrors?: boolean}} [options]
 * @returns {Promise<T>}
 */
export const poll = async (
  check,
  { timeoutMs = 8000, intervalMs = 100, description = "condition", ignoreErrors = true } = {},
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

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
