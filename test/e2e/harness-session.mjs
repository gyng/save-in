import fs from "node:fs";
import path from "node:path";

/** @param {Record<string, unknown> | undefined} snapshot */
const cleanupExpression = (snapshot) => `(async () => {
  const optionsUrl = browser.runtime.getURL("src/options/options.html");
  const failures = [];
  const attempt = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      failures.push(label + ": " + String(error?.stack || error));
    }
  };
  await Promise.all([
    attempt("tabs", async () => {
      const [current, tabs] = await Promise.all([browser.tabs.getCurrent(), browser.tabs.query({})]);
      const keep = current?.id ?? tabs.find((tab) => tab.url?.startsWith(optionsUrl))?.id;
      const remove = tabs.flatMap((tab) => tab.id !== undefined && tab.id !== keep ? [tab.id] : []);
      if (remove.length) await browser.tabs.remove(remove);
    }),
    attempt("downloads", async () => {
      const downloads = await browser.downloads.search({});
      await Promise.all(downloads
        .filter((download) => download.state === "in_progress")
        .map((download) => browser.downloads.cancel(download.id).catch(() => {})));
      await browser.downloads.erase({});
    }),
    attempt("notifications", async () => {
      if (!browser.notifications?.getAll) return;
      const notifications = await browser.notifications.getAll();
      await Promise.all(Object.keys(notifications).map((id) => browser.notifications.clear(id)));
    }),
    attempt("session rules", async () => {
      if (!browser.declarativeNetRequest?.getSessionRules) return;
      const rules = await browser.declarativeNetRequest.getSessionRules();
      if (rules.length) {
        await browser.declarativeNetRequest.updateSessionRules({
          removeRuleIds: rules.map((rule) => rule.id),
        });
      }
    }),
  ]);
  await attempt("session storage", () => browser.storage.session?.clear?.());
  ${
    snapshot
      ? `await attempt("local storage", async () => {
    await browser.storage.local.clear();
    await browser.storage.local.set(${JSON.stringify(snapshot)});
  });`
      : ""
  }
  await attempt("runtime reset", () => api.reset());
  if (failures.length) throw new Error(failures.join("\\n---\\n"));
  return true;
})()`;

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
 *   evaluateBackground: (expression: string, timeoutMs?: number) => Promise<any>,
 *   evaluateControl?: (expression: string, timeoutMs?: number) => Promise<any>,
 *   downloadDir: () => string,
 * }} adapters
 */
export const createHarnessSession = ({
  evaluateBackground,
  evaluateControl = evaluateBackground,
  downloadDir,
}) => {
  /** @type {Record<string, unknown> | undefined} */
  let baseline;
  /** @type {Record<string, unknown> | undefined} */
  let snapshot;
  return {
    async beginCase() {
      snapshot = baseline;
      if (!snapshot) {
        snapshot = JSON.parse(
          await evaluateControl(
            `browser.storage.local.get(null).then((stored) => JSON.stringify(stored))`,
          ),
        );
      }
    },

    /** @param {{preserveLocal?: boolean}} [options] */
    async endCase({ preserveLocal = false } = {}) {
      /** @type {unknown[]} */
      const failures = [];
      try {
        await evaluateControl(cleanupExpression(preserveLocal ? undefined : snapshot), 15000);
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
