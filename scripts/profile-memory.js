// @ts-check

const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const loadDevelopmentModule = createRequire(__filename);

const root = path.resolve(__dirname, "..");
const output = path.resolve(
  root,
  process.env.MEMORY_PROFILE_OUTPUT || path.join("dist", "memory-profile.json"),
);
const requestedRepeats = Number.parseInt(process.env.MEMORY_PROFILE_REPEATS || "3", 10);
const repeats = Number.isSafeInteger(requestedRepeats) ? Math.max(1, requestedRepeats) : 3;
const requestedScale = Number.parseInt(process.env.MEMORY_PROFILE_SCALE || "100000", 10);
const scale = Number.isSafeInteger(requestedScale) ? Math.max(10_000, requestedScale) : 100_000;
const reportOnly = process.argv.includes("--report-only");
const WORKER_TIMEOUT_MS = 30_000;

const scenarios = [
  "source-legacy",
  "source-compacted",
  "source-automatic",
  "timing-legacy",
  "timing-bounded",
];

/**
 * @typedef {{
 *   scenario: string,
 *   fixtureCount: number,
 *   retainedCount: number,
 *   retainedDetailCount: number,
 *   baselineHeapBytes: number,
 *   uncollectedGrowthBytes: number,
 *   retainedGrowthBytes: number,
 *   rssBytes: number,
 *   durationMs: number,
 * }} MemorySample
 */

/** @param {string} outputText @param {string} expectedScenario @returns {MemorySample} */
const parseMemorySample = (outputText, expectedScenario) => {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`${expectedScenario} worker returned invalid JSON`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${expectedScenario} worker returned a non-object sample`);
  }
  if (Reflect.get(value, "scenario") !== expectedScenario) {
    throw new Error(`${expectedScenario} worker returned the wrong scenario`);
  }
  for (const field of ["fixtureCount", "retainedCount", "retainedDetailCount"]) {
    const fieldValue = Reflect.get(value, field);
    if (typeof fieldValue !== "number" || !Number.isSafeInteger(fieldValue) || fieldValue < 0) {
      throw new Error(`${expectedScenario} worker returned an invalid ${field}`);
    }
  }
  for (const field of [
    "baselineHeapBytes",
    "uncollectedGrowthBytes",
    "retainedGrowthBytes",
    "rssBytes",
    "durationMs",
  ]) {
    const fieldValue = Reflect.get(value, field);
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || fieldValue < 0) {
      throw new Error(`${expectedScenario} worker returned an invalid ${field}`);
    }
  }
  return /** @type {MemorySample} */ (value);
};

/** @param {number[]} values */
const median = (values) => {
  const ordered = values.toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered[middle];
  if (value === undefined) throw new Error("Cannot take the median of an empty sample");
  return value;
};

const collectGarbage = () => {
  if (!global.gc) throw new Error("Memory profiling requires Node --expose-gc");
  for (let pass = 0; pass < 4; pass += 1) global.gc();
};

/** @param {number} bytes */
const mebibytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

/** @param {string} scenario */
const runWorker = async (scenario) => {
  const sourceModelUrl = pathToFileURL(path.join(root, "src", "content", "source-panel-model.ts"));
  const { collectPageSourceCandidates, createPageSourcePayloadBudget, mergeResourceTimings } =
    await import(sourceModelUrl.href);
  let fixtureCount = scale;
  let retainedCount = 0;
  let retainedDetailCount = 0;
  /** @type {unknown} */
  let retained;

  if (scenario.startsWith("source-")) {
    // The DOM itself dominates at larger scales. Twenty-five thousand repeated
    // resources still gives the retained wrapper/origin arrays a stable signal
    // while keeping one isolated CI worker comfortably below browser-like RSS.
    fixtureCount = Math.min(scale, 25_000);
    const { JSDOM } = loadDevelopmentModule(["js", "dom"].join(""));
    const warmDom = new JSDOM('<img src="warm.jpg">', { url: "https://page.test/" });
    Object.assign(globalThis, {
      document: warmDom.window.document,
      Element: warmDom.window.Element,
    });
    collectPageSourceCandidates(
      warmDom.window.document,
      { includeLinks: false, includeBackgrounds: false, resourceHints: false },
      new Map(),
      createPageSourcePayloadBudget(),
    );
    warmDom.window.close();
    let markup = Array.from({ length: fixtureCount }, () => '<img src="shared.jpg">').join("");
    const dom = new JSDOM(markup, { url: "https://page.test/" });
    markup = "";
    const document = dom.window.document;
    Object.assign(globalThis, { document, Element: dom.window.Element });
    const elements = [...document.querySelectorAll("img")];
    collectGarbage();
    const baselineHeapBytes = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const collected = collectPageSourceCandidates(
      document,
      { includeLinks: false, includeBackgrounds: false, resourceHints: false },
      new Map(),
      createPageSourcePayloadBudget(),
      scenario !== "source-automatic",
    );
    if (scenario === "source-legacy") {
      // Run the production traversal in every source scenario so jsdom's lazy
      // per-element URL state is a shared baseline, then model the old retained
      // shape with one wrapper for every repeated DOM origin.
      collected.length = 0;
      retained = elements.map((element) => ({
        url: "https://cdn.test/shared.jpg",
        kind: "image",
        element,
      }));
    } else {
      retained = collected;
    }
    const durationMs = performance.now() - startedAt;
    const uncollectedHeapBytes = process.memoryUsage().heapUsed;
    collectGarbage();
    const retainedHeapBytes = process.memoryUsage().heapUsed;
    if (!Array.isArray(retained)) throw new Error(`${scenario} did not retain an array`);
    retainedCount = retained.length;
    const first = retained[0];
    retainedDetailCount =
      first && typeof first === "object" && "collectorOriginElements" in first
        ? Array.isArray(first.collectorOriginElements)
          ? first.collectorOriginElements.length
          : 0
        : retained.length;
    return {
      scenario,
      fixtureCount,
      retainedCount,
      retainedDetailCount,
      baselineHeapBytes,
      uncollectedGrowthBytes: Math.max(0, uncollectedHeapBytes - baselineHeapBytes),
      retainedGrowthBytes: Math.max(0, retainedHeapBytes - baselineHeapBytes),
      rssBytes: process.memoryUsage().rss,
      durationMs,
    };
  }

  fixtureCount = Math.max(10_000, Math.floor(scale / 2));
  collectGarbage();
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  const entries = function* () {
    for (let index = 0; index < fixtureCount; index += 1) {
      yield {
        name: `https://cdn.test/resource-${index}.js`,
        encodedBodySize: index + 1,
        transferSize: index + 2,
        serverTiming: [{ name: `controlled-${index}`, description: "x".repeat(512) }],
      };
    }
  };
  const startedAt = performance.now();
  const timings = new Map();
  if (scenario === "timing-legacy") {
    for (const entry of entries()) timings.set(entry.name, entry);
  } else {
    mergeResourceTimings(timings, entries());
  }
  retained = timings;
  const durationMs = performance.now() - startedAt;
  const uncollectedHeapBytes = process.memoryUsage().heapUsed;
  collectGarbage();
  const retainedHeapBytes = process.memoryUsage().heapUsed;
  retainedCount = timings.size;
  retainedDetailCount = [...timings.values()].filter((entry) => "serverTiming" in entry).length;
  return {
    scenario,
    fixtureCount,
    retainedCount,
    retainedDetailCount,
    baselineHeapBytes,
    uncollectedGrowthBytes: Math.max(0, uncollectedHeapBytes - baselineHeapBytes),
    retainedGrowthBytes: Math.max(0, retainedHeapBytes - baselineHeapBytes),
    rssBytes: process.memoryUsage().rss,
    durationMs,
  };
};

/** @param {string} scenario */
const sampleScenario = (scenario) => {
  /** @type {MemorySample[]} */
  const samples = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const child = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        __filename,
        "--worker",
        scenario,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, MEMORY_PROFILE_SCALE: String(scale) },
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        timeout: WORKER_TIMEOUT_MS,
      },
    );
    if (child.error || child.status !== 0) {
      throw new Error(
        `${scenario} memory worker failed (${child.signal || child.status || "unknown"}): ${child.error || child.stderr || child.stdout}`,
      );
    }
    samples.push(parseMemorySample(child.stdout, scenario));
  }
  const first = samples[0];
  if (!first) throw new Error(`${scenario} produced no memory samples`);
  for (const sample of samples) {
    if (
      sample.scenario !== first.scenario ||
      sample.fixtureCount !== first.fixtureCount ||
      sample.retainedCount !== first.retainedCount ||
      sample.retainedDetailCount !== first.retainedDetailCount
    ) {
      throw new Error(`${scenario} produced inconsistent retained shapes across isolated samples`);
    }
  }
  return {
    scenario,
    fixtureCount: first.fixtureCount,
    retainedCount: first.retainedCount,
    retainedDetailCount: first.retainedDetailCount,
    retainedGrowthBytes: median(samples.map((sample) => sample.retainedGrowthBytes)),
    retainedGrowthRangeBytes: {
      minimum: Math.min(...samples.map((sample) => sample.retainedGrowthBytes)),
      maximum: Math.max(...samples.map((sample) => sample.retainedGrowthBytes)),
    },
    uncollectedGrowthBytes: median(samples.map((sample) => sample.uncollectedGrowthBytes)),
    rssBytes: median(samples.map((sample) => sample.rssBytes)),
    durationMs: median(samples.map((sample) => sample.durationMs)),
    samples,
  };
};

const main = async () => {
  const workerIndex = process.argv.indexOf("--worker");
  if (workerIndex >= 0) {
    const scenario = process.argv[workerIndex + 1];
    if (!scenario || !scenarios.includes(scenario)) throw new Error("Unknown memory scenario");
    process.stdout.write(JSON.stringify(await runWorker(scenario)));
    return;
  }

  const results = scenarios.map(sampleScenario);
  const byScenario = new Map(results.map((result) => [result.scenario, result]));
  const sourceLegacy = byScenario.get("source-legacy");
  const sourceCompacted = byScenario.get("source-compacted");
  const sourceAutomatic = byScenario.get("source-automatic");
  const timingLegacy = byScenario.get("timing-legacy");
  const timingBounded = byScenario.get("timing-bounded");
  if (!sourceLegacy || !sourceCompacted || !sourceAutomatic || !timingLegacy || !timingBounded) {
    throw new Error("Memory profile is missing a scenario");
  }
  const sourceLegacyExcessBytes =
    sourceLegacy.retainedGrowthBytes - sourceAutomatic.retainedGrowthBytes;
  const sourceCompactedExcessBytes = Math.max(
    0,
    sourceCompacted.retainedGrowthBytes - sourceAutomatic.retainedGrowthBytes,
  );
  if (sourceLegacyExcessBytes <= 0 || timingLegacy.retainedGrowthBytes <= 0) {
    throw new Error("Legacy memory controls did not produce a measurable retained signal");
  }
  const ratios = {
    sourceRetained: sourceCompactedExcessBytes / sourceLegacyExcessBytes,
    timingRetained: timingBounded.retainedGrowthBytes / timingLegacy.retainedGrowthBytes,
  };
  if (!Number.isFinite(ratios.sourceRetained) || !Number.isFinite(ratios.timingRetained)) {
    throw new Error("Memory profile produced a non-finite retained ratio");
  }
  const report = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    repeats,
    scale,
    reportOnly,
    workerTimeoutMs: WORKER_TIMEOUT_MS,
    thresholds: { sourceRetainedRatio: 0.4, timingRetainedRatio: 0.1 },
    ratios,
    derived: {
      sourceAutomaticBaselineBytes: sourceAutomatic.retainedGrowthBytes,
      sourceLegacyExcessBytes,
      sourceCompactedExcessBytes,
    },
    scenarios: results,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));

  process.stdout.write(`Memory profile (${repeats} isolated samples, scale ${scale})\n`);
  for (const result of results) {
    process.stdout.write(
      `${result.scenario.padEnd(18)} retained=${mebibytes(result.retainedGrowthBytes).padStart(11)} ` +
        `uncollected=${mebibytes(result.uncollectedGrowthBytes).padStart(11)} ` +
        `objects=${String(result.retainedCount).padStart(7)} ${result.durationMs.toFixed(1).padStart(8)} ms\n`,
    );
  }
  process.stdout.write(
    `Retained ratios: sources ${(ratios.sourceRetained * 100).toFixed(1)}%, ` +
      `resource timings ${(ratios.timingRetained * 100).toFixed(1)}%\n` +
      `Diagnostics: ${path.relative(root, output)}\n`,
  );

  if (
    sourceCompacted.retainedCount !== 1 ||
    sourceCompacted.retainedDetailCount !== sourceCompacted.fixtureCount
  ) {
    throw new Error("Source compaction did not retain one row with every CSS origin");
  }
  if (sourceAutomatic.retainedCount !== 1 || sourceAutomatic.retainedDetailCount !== 1) {
    throw new Error("Automatic source collection retained duplicate non-CSS origins");
  }
  if (timingBounded.retainedCount !== 512 || timingBounded.retainedDetailCount !== 0) {
    throw new Error("Resource timing compaction did not retain 512 scalar-only records");
  }
  if (!reportOnly && ratios.sourceRetained > report.thresholds.sourceRetainedRatio) {
    throw new Error(
      `Compacted source state retained ${(ratios.sourceRetained * 100).toFixed(1)}% of the legacy shape`,
    );
  }
  if (!reportOnly && ratios.timingRetained > report.thresholds.timingRetainedRatio) {
    throw new Error(
      `Bounded timing state retained ${(ratios.timingRetained * 100).toFixed(1)}% of the legacy shape`,
    );
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { parseMemorySample };
