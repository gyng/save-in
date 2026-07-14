import fs from "node:fs";
import path from "node:path";

const cleanupExpression = `(() => {
  const optionsUrl = browser.runtime.getURL("src/options/options.html");
  return Promise.all([
    browser.tabs.getCurrent().then((current) => browser.tabs.query({}).then(async (tabs) => {
      const keep = current?.id ?? tabs.find((tab) => tab.url?.startsWith(optionsUrl))?.id;
      const remove = tabs.flatMap((tab) => tab.id !== undefined && tab.id !== keep ? [tab.id] : []);
      if (remove.length) await browser.tabs.remove(remove).catch(() => {});
    })),
    browser.downloads.search({}).then(async (downloads) => {
      await Promise.all(downloads
        .filter((download) => download.state === "in_progress")
        .map((download) => browser.downloads.cancel(download.id).catch(() => {})));
      await browser.downloads.erase({}).catch(() => {});
    }),
    browser.notifications?.getAll?.().then((notifications) =>
      Promise.all(Object.keys(notifications).map((id) => browser.notifications.clear(id)))
    ).catch(() => {}),
    browser.declarativeNetRequest?.getSessionRules?.().then((rules) =>
      rules.length
        ? browser.declarativeNetRequest.updateSessionRules({
            removeRuleIds: rules.map((rule) => rule.id),
          })
        : undefined
    ).catch(() => {}),
  ]).then(() => browser.storage.session?.clear?.()).then(() => true);
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
 *   resetRuntime?: () => Promise<any>,
 *   reloadOptions: () => Promise<void>,
 *   downloadDir: () => string,
 * }} adapters
 */
export const createHarnessSession = ({
  evaluateBackground,
  evaluateControl = evaluateBackground,
  resetRuntime = () => evaluateBackground(`api.reset().then(() => true)`),
  reloadOptions,
  downloadDir,
}) => {
  /** @type {Record<string, unknown> | undefined} */
  let snapshot;
  return {
    async beginCase() {
      snapshot = JSON.parse(
        await evaluateControl(
          `browser.storage.local.get(null).then((stored) => JSON.stringify(stored))`,
        ),
      );
    },

    /** @param {{preserveLocal?: boolean}} [options] */
    async endCase({ preserveLocal = false } = {}) {
      /** @type {unknown[]} */
      const failures = [];
      try {
        await evaluateControl(cleanupExpression, 15000);
      } catch (error) {
        failures.push(error);
      }
      if (!preserveLocal && snapshot) {
        try {
          await evaluateControl(
            `browser.storage.local.clear()
            .then(() => browser.storage.local.set(${JSON.stringify(snapshot)}))
            .then(() => true)`,
            15000,
          );
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await emptyDirectory(downloadDir());
      } catch (error) {
        failures.push(error);
      }
      try {
        await reloadOptions();
      } catch (error) {
        failures.push(error);
      }
      try {
        await resetRuntime();
      } catch (error) {
        failures.push(error);
      }
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
