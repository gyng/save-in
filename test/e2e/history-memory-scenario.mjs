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

/** @param {string} artifactDirectory @param {string} browserLabel @param {string} suiteAttempt */
const nextMemoryArtifact = (artifactDirectory, browserLabel, suiteAttempt) => {
  for (let sampleSequence = 1; ; sampleSequence += 1) {
    const artifactPath = path.resolve(
      artifactDirectory,
      `memory-history-${browserLabel}-attempt-${suiteAttempt}-sample-${sampleSequence}.json`,
    );
    if (!fs.existsSync(artifactPath)) return { artifactPath, sampleSequence };
  }
};

// Firefox 140 can transiently reserve over 1 GiB when the extension first
// writes its sharded storage shape, then release most of it at the event-queue
// barrier. Gate what survives that barrier, while keeping transient peaks in
// telemetry. For repeated writes, measure the final retained rise from the
// sampled trough so an elevated post-startup baseline cannot hide warmed
// growth and a released browser-process reservation cannot impersonate a leak.
//
// Evidence behind the numbers below (repo policy: raising a baseline needs
// before/after measurement, not qualitative reasoning alone):
// - Prior whole-process metric (git history, commit e9a5a396, since
//   superseded): repeated fixed-path legacy-key runs measured 337-505 MiB
//   retained growth in Firefox 152 and 56-77 MiB in Chrome 150 as a positive
//   control; the sharded production path measured 24-55 MiB in Firefox and
//   1-6 MiB in Chrome under that same whole-process-tree metric.
// - The metric has since changed twice and is no longer the whole-process
//   figure quoted above: it moved to a cold-start-vs-steady-state peak split
//   (commit a002a765), then to the current cold-start-retained-growth vs.
//   baseline-cohort retained-draw-up split (commit 09f43a3d; see "Browser RSS
//   measurement" in docs/contributing/E2E.md). The cohort figure excludes
//   late renderer/utility/GPU processes as valid lifecycle churn, which the
//   old whole-process figures above did not exclude, so the two are not
//   directly comparable and the prior range is prior-metric context only, not
//   evidence for the ceilings below.
// - MAX_PRODUCTION_COLD_START_RETAINED_RSS_GROWTH_KB (128/384) and
//   MAX_PRODUCTION_RETAINED_DRAWUP_RSS_GROWTH_KB (64/128) carry forward the
//   values set when the cold-start/steady split was introduced (commit
//   a002a765), sized as headroom over the whole-process measurements
//   available at that time; they have not been re-measured against the
//   current cohort-retained-draw-up metric.
// TODO: the next local full e2e run (`npm run e2e`; artifacts land under
// dist/e2e-artifacts/run-*/memory-history-*.json) should record its observed
// coldStart.retainedGrowthKb and production.cohort.retainedDrawupKb beside
// these ceilings so this comment cites current-metric evidence instead of
// only the superseded whole-process ranges above.
const MAX_PRODUCTION_COLD_START_RETAINED_RSS_GROWTH_KB = {
  chrome: 128 * 1024,
  firefox: 384 * 1024,
};
const MAX_PRODUCTION_RETAINED_DRAWUP_RSS_GROWTH_KB = {
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
  /** @param {import("./control-protocol.mjs").HistoryWriteRequest["body"]} body */
  const writeProductionHistory = async (body) => {
    const response = await control.runtime.send({ type: "SAVE_IN_E2E_HISTORY_WRITE", body });
    if (response.body.status === "ERROR") throw new Error(response.body.message);
  };

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
      const baseline = processTree.processTreeMemorySnapshot(pid);
      const baselinePids = new Set(baseline.processes.map((process) => process.pid));
      const samplesKb = [baseline.rssKb];
      const cohortSamplesKb = [baseline.rssKb];
      const processCounts = [baseline.processes.length];
      const sampleRss = () => {
        const snapshot = processTree.processTreeMemorySnapshot(pid);
        samplesKb.push(snapshot.rssKb);
        cohortSamplesKb.push(
          snapshot.processes.reduce(
            (total, process) => total + (baselinePids.has(process.pid) ? process.rssKb : 0),
            0,
          ),
        );
        processCounts.push(snapshot.processes.length);
      };
      await workload(sampleRss);
      sampleRss();
      return {
        ...processTree.summarizeRssKb(samplesKb),
        baselineProcessCount: baseline.processes.length,
        processCounts,
        cohort: processTree.summarizeRssKb(cohortSamplesKb),
      };
    };
    const payload = "x".repeat(2048);
    /** @type {ReturnType<typeof historyEntry>[]} */
    const history = [];

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
      const configuredAttempt = process.env.E2E_SUITE_ATTEMPT || "1";
      const suiteAttempt = /^\d+$/.test(configuredAttempt) ? configuredAttempt : "1";
      const { artifactPath, sampleSequence } = nextMemoryArtifact(
        artifactDirectory,
        browserLabel,
        suiteAttempt,
      );
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(
        artifactPath,
        JSON.stringify(
          {
            schemaVersion: 5,
            capturedAt: new Date().toISOString(),
            browser: browserLabel,
            suiteAttempt: Number(suiteAttempt),
            sampleSequence,
            workload: {
              contentTabs: CONTENT_TAB_COUNT,
              historyWrites: HISTORY_WRITE_COUNT,
              warmupWrites: HISTORY_WARMUP_WRITE_COUNT,
              payloadCharacters: payload.length,
              sampleInterval: RSS_SAMPLE_INTERVAL,
            },
            coldStartRetainedGrowthCeilingKb:
              MAX_PRODUCTION_COLD_START_RETAINED_RSS_GROWTH_KB[browserLabel],
            productionRetainedDrawupCeilingKb:
              MAX_PRODUCTION_RETAINED_DRAWUP_RSS_GROWTH_KB[browserLabel],
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
        `cold-start-retained=${Math.round(coldStart.retainedGrowthKb / 1024)} MiB, ` +
        `production-drawup=${Math.round(production.maximumDrawupKb / 1024)} MiB, ` +
        `production-cohort-retained-drawup=${Math.round(production.cohort.retainedDrawupKb / 1024)} MiB, ` +
        `production-retained=${Math.round(production.retainedGrowthKb / 1024)} MiB, ` +
        `legacy-peak=${Math.round(legacy.peakGrowthKb / 1024)} MiB, ` +
        `legacy-retained=${Math.round(legacy.retainedGrowthKb / 1024)} MiB\n`,
    );
    expect(
      coldStart.retainedGrowthKb,
      `${browserLabel} production-history cold start retained ${Math.round(coldStart.retainedGrowthKb / 1024)} MiB above baseline`,
    ).toBeLessThanOrEqual(MAX_PRODUCTION_COLD_START_RETAINED_RSS_GROWTH_KB[browserLabel]);
    expect(
      production.cohort.retainedDrawupKb,
      `${browserLabel} production-history stable-process RSS retained ${Math.round(production.cohort.retainedDrawupKb / 1024)} MiB above its sampled trough`,
    ).toBeLessThanOrEqual(MAX_PRODUCTION_RETAINED_DRAWUP_RSS_GROWTH_KB[browserLabel]);
  } finally {
    try {
      await writeProductionHistory({ action: "clear" });
    } finally {
      await Promise.all([control.windows.remove(opened.id), closeLocal(server)]);
    }
  }
};
