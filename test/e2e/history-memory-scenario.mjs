import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { expect } from "vitest";

import processTree from "../../scripts/lib/process-tree.js";
import { closeLocal, listenLocal, requireValue } from "./helpers.mjs";

const HISTORY_STORAGE_KEY = "save-in-history";
const CONTENT_TAB_COUNT = 30;
const HISTORY_WRITE_COUNT = 100;
const HISTORY_WARMUP_WRITE_COUNT = 5;
const RSS_SAMPLE_INTERVAL = 5;

// Firefox can reserve over 200 MiB when the extension first writes its sharded
// storage shape. Keep that cold first-use allocation visible under a separate
// ceiling, then gate the repeated-write workload after five warm-up writes so
// allocator high-water behavior cannot mask per-write growth. The direct
// legacy-key writes run last as positive-control telemetry only: Firefox's
// browser-owned storage fan-out and GC timing varied from 292 MiB to 1.25 GiB
// across identical Firefox 140 runs.
const MAX_PRODUCTION_COLD_START_RSS_GROWTH_KB = {
  chrome: 128 * 1024,
  firefox: 384 * 1024,
};
const MAX_PRODUCTION_STEADY_RSS_GROWTH_KB = {
  chrome: 64 * 1024,
  firefox: 128 * 1024,
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
      const samplesKb = [processTree.processTreeRssKb(pid)];
      const sampleRss = () => {
        samplesKb.push(processTree.processTreeRssKb(pid));
      };
      await workload(sampleRss);
      sampleRss();
      return processTree.summarizeRssKb(samplesKb);
    };
    const payload = "x".repeat(2048);
    /** @type {ReturnType<typeof historyEntry>[]} */
    const history = [];

    /** @param {import("./control-protocol.mjs").HistoryWriteRequest["body"]} body */
    const writeProductionHistory = async (body) => {
      const response = await control.runtime.send({ type: "SAVE_IN_E2E_HISTORY_WRITE", body });
      if (response.body.status === "ERROR") throw new Error(response.body.message);
    };
    // Measure production first. Warming the browser allocator with the legacy
    // fan-out workload can otherwise hide a production regression behind an
    // already-raised heap high-water mark.
    await writeProductionHistory({ action: "clear" });
    await contentBarrier();

    const coldStart = await measureRss(async (sampleRss) => {
      for (let index = 0; index < HISTORY_WARMUP_WRITE_COUNT; index += 1) {
        await writeProductionHistory({ action: "add-and-patch", index, payload });
        sampleRss();
      }
      await contentBarrier();
    });

    await writeProductionHistory({ action: "clear" });
    await contentBarrier();

    const production = await measureRss(async (sampleRss) => {
      for (let index = 0; index < HISTORY_WRITE_COUNT; index += 1) {
        await writeProductionHistory({ action: "add-and-patch", index, payload });
        if ((index + 1) % RSS_SAMPLE_INTERVAL === 0) sampleRss();
      }
      await contentBarrier();
    });

    await writeProductionHistory({ action: "clear" });
    await contentBarrier();

    const legacy = await measureRss(async (sampleRss) => {
      for (let index = 0; index < HISTORY_WRITE_COUNT; index += 1) {
        history.push(historyEntry(index, payload));
        await control.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
        if ((index + 1) % RSS_SAMPLE_INTERVAL === 0) sampleRss();
      }
      await contentBarrier();
    });

    const artifactDirectory = process.env.E2E_ARTIFACT_DIR;
    if (artifactDirectory) {
      const artifactPath = path.resolve(artifactDirectory, `memory-history-${browserLabel}.json`);
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            browser: browserLabel,
            workload: {
              contentTabs: CONTENT_TAB_COUNT,
              historyWrites: HISTORY_WRITE_COUNT,
              warmupWrites: HISTORY_WARMUP_WRITE_COUNT,
              payloadCharacters: payload.length,
              sampleInterval: RSS_SAMPLE_INTERVAL,
            },
            coldStartPeakGrowthCeilingKb: MAX_PRODUCTION_COLD_START_RSS_GROWTH_KB[browserLabel],
            productionPeakGrowthCeilingKb: MAX_PRODUCTION_STEADY_RSS_GROWTH_KB[browserLabel],
            coldStart,
            production,
            legacy,
          },
          null,
          2,
        ),
      );
    }

    process.stdout.write(
      `${browserLabel} history RSS: cold-start-peak=${Math.round(coldStart.peakGrowthKb / 1024)} MiB, ` +
        `production-peak=${Math.round(production.peakGrowthKb / 1024)} MiB, ` +
        `production-retained=${Math.round(production.retainedGrowthKb / 1024)} MiB, ` +
        `legacy-peak=${Math.round(legacy.peakGrowthKb / 1024)} MiB, ` +
        `legacy-retained=${Math.round(legacy.retainedGrowthKb / 1024)} MiB\n`,
    );
    expect(
      coldStart.peakGrowthKb,
      `${browserLabel} production-history cold start peaked ${Math.round(coldStart.peakGrowthKb / 1024)} MiB above baseline`,
    ).toBeLessThanOrEqual(MAX_PRODUCTION_COLD_START_RSS_GROWTH_KB[browserLabel]);
    expect(
      production.peakGrowthKb,
      `${browserLabel} production-history RSS peaked ${Math.round(production.peakGrowthKb / 1024)} MiB above baseline`,
    ).toBeLessThanOrEqual(MAX_PRODUCTION_STEADY_RSS_GROWTH_KB[browserLabel]);
  } finally {
    await Promise.all([control.windows.remove(opened.id), closeLocal(server)]);
  }
};
