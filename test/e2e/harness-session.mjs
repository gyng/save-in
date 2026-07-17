import fs from "node:fs";
import path from "node:path";

/** @param {string} directory */
const emptyDirectory = async (directory) => {
  if (!directory || !fs.existsSync(directory)) return;
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      for (const entry of fs.readdirSync(directory)) {
        fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new Error(`Unable to empty E2E download directory: ${directory}`, { cause: lastError });
};

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   downloadDir: () => string,
 * }} adapters
 */
export const createHarnessSession = ({ control, downloadDir }) => {
  /** @type {Record<string, unknown> | undefined} */
  let baseline;
  /** @type {Record<string, unknown> | undefined} */
  let snapshot;
  return {
    async beginCase() {
      snapshot = baseline;
      if (!snapshot) {
        snapshot = /** @type {Record<string, unknown>} */ (await control.storage.local.get());
      }
    },

    /** @param {{preserveLocal?: boolean}} [options] */
    async endCase({ preserveLocal = false } = {}) {
      /** @type {unknown[]} */
      const failures = [];
      try {
        await control.harness.resetCase(preserveLocal ? undefined : snapshot);
      } catch (error) {
        failures.push(error);
      }
      try {
        await emptyDirectory(downloadDir());
      } catch (error) {
        failures.push(error);
      }
      baseline = failures.length || preserveLocal ? undefined : snapshot;
      snapshot = undefined;
      if (failures.length) {
        const details = failures
          .map((error) => (error instanceof Error ? error.stack || error.message : String(error)))
          .join("\n---\n");
        throw new AggregateError(failures, `E2E case reset failed:\n${details}`);
      }
    },
  };
};
