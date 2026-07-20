import http from "node:http";

import { expect } from "vitest";

import processTree from "../../scripts/lib/process-tree.js";
import { closeLocal, listenLocal, requireValue } from "./helpers.mjs";

const HISTORY_STORAGE_KEY = "save-in-history";
const CONTENT_TAB_COUNT = 30;
const HISTORY_WRITE_COUNT = 100;
const RSS_SAMPLE_INTERVAL = 5;

// The original Firefox fan-out regression grew this workload by about 1.8 GiB.
// Repeated fixed-path runs measured 337–505 MiB in Firefox 152 and 56–77 MiB in
// Chrome 150. Leave browser-version and runner headroom without permitting the
// old failure. The sharded production path measured 24–55 MiB in Firefox and
// 1–6 MiB in Chrome, so its separate ceilings still leave over 4x headroom.
const MAX_LEGACY_RSS_GROWTH_KB = {
  chrome: 512 * 1024,
  firefox: 1024 * 1024,
};
const MAX_PRODUCTION_RSS_GROWTH_KB = {
  chrome: 128 * 1024,
  firefox: 256 * 1024,
};

/** @param {number} index @param {string} payload */
const historyEntry = (index, payload) => ({
  id: `rss-history-${index}`,
  status: "complete",
  url: `https://history-memory.invalid/${index}?payload=${payload}`,
  suggestedFilename: `rss-history-${index}.bin`,
  finalFullPath: `rss-history/rss-history-${index}.bin`,
  variables: { payload },
});

/**
 * Reproduces the v4 regression workload against the staged extension. The
 * runtime messages are event-queue barriers: once every content script handles
 * one, all preceding storage change events in that context have been delivered.
 *
 * @param {{
 *   browserLabel: "chrome" | "firefox",
 *   browserProcess: () => import("node:child_process").ChildProcess | undefined,
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 * }} adapters
 */
export const runHistoryMemoryScenario = async ({ browserLabel, browserProcess, control }) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end("<!doctype html><title>Save In RSS fixture</title>");
  });
  const port = await listenLocal(server);
  const urls = Array.from(
    { length: CONTENT_TAB_COUNT },
    (_, index) => `http://127.0.0.1:${port}/rss-${index}`,
  );
  const opened = await control.windows.create({ focused: false, url: urls });

  try {
    const tabs = await control.tabs.query({ windowId: opened.id });
    const tabIds = tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
    expect(tabIds, "RSS fixture tabs").toHaveLength(CONTENT_TAB_COUNT);
    await Promise.all(
      tabIds.map((id) => control.tabs.wait({ id, status: "complete", timeoutMs: 15_000 })),
    );

    const contentBarrier = () =>
      Promise.all(
        tabIds.map((id) =>
          control.tabs.sendMessage(id, {
            type: "CONTENT_OPTIONS_CHANGED",
            body: { options: {} },
          }),
        ),
      );
    await contentBarrier();

    const pid = requireValue(browserProcess()?.pid, `${browserLabel} process PID is unavailable`);
    /** @param {(sampleRss: () => void) => Promise<void>} workload */
    const measureRss = async (workload) => {
      const baselineRssKb = processTree.processTreeRssKb(pid);
      let peakRssKb = baselineRssKb;
      const sampleRss = () => {
        peakRssKb = Math.max(peakRssKb, processTree.processTreeRssKb(pid));
      };
      await workload(sampleRss);
      sampleRss();
      return { baselineRssKb, peakRssKb, rssGrowthKb: peakRssKb - baselineRssKb };
    };
    const payload = "x".repeat(2048);
    /** @type {ReturnType<typeof historyEntry>[]} */
    const history = [];

    const legacy = await measureRss(async (sampleRss) => {
      for (let index = 0; index < HISTORY_WRITE_COUNT; index += 1) {
        history.push(historyEntry(index, payload));
        await control.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
        if ((index + 1) % RSS_SAMPLE_INTERVAL === 0) sampleRss();
      }
      await contentBarrier();
    });

    /** @param {import("./control-protocol.mjs").HistoryWriteRequest["body"]} body */
    const writeProductionHistory = async (body) => {
      const response = await control.runtime.send({ type: "SAVE_IN_E2E_HISTORY_WRITE", body });
      if (response.body.status === "ERROR") throw new Error(response.body.message);
    };
    await writeProductionHistory({ action: "clear" });
    await contentBarrier();

    const production = await measureRss(async (sampleRss) => {
      for (let index = 0; index < HISTORY_WRITE_COUNT; index += 1) {
        await writeProductionHistory({ action: "add-and-patch", index, payload });
        if ((index + 1) % RSS_SAMPLE_INTERVAL === 0) sampleRss();
      }
      await contentBarrier();
    });

    process.stdout.write(
      `${browserLabel} history RSS: legacy-growth=${Math.round(legacy.rssGrowthKb / 1024)} MiB, ` +
        `production-growth=${Math.round(production.rssGrowthKb / 1024)} MiB\n`,
    );
    expect(
      legacy.rssGrowthKb,
      `${browserLabel} legacy-write RSS grew ${Math.round(legacy.rssGrowthKb / 1024)} MiB`,
    ).toBeLessThanOrEqual(MAX_LEGACY_RSS_GROWTH_KB[browserLabel]);
    expect(
      production.rssGrowthKb,
      `${browserLabel} production-history RSS grew ${Math.round(production.rssGrowthKb / 1024)} MiB`,
    ).toBeLessThanOrEqual(MAX_PRODUCTION_RSS_GROWTH_KB[browserLabel]);
  } finally {
    await Promise.all([control.windows.remove(opened.id), closeLocal(server)]);
  }
};
