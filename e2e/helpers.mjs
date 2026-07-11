export const poll = async (
  check,
  { timeoutMs = 8000, intervalMs = 100, description = "condition", ignoreErrors = true } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (!ignoreErrors) throw error;
      lastError = error;
    }

    if (Date.now() >= deadline) {
      const detail = lastError ? `: ${lastError.message || lastError}` : "";
      throw new Error(`Timed out waiting for ${description}${detail}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

export const listenLocal = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
