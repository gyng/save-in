// @ts-check

// Fast, repeatable Chrome/WebMCP functional dogfood. A watch session keeps one
// isolated browser alive, resets extension state between checks, and reloads
// the staged unpacked build only when source files change.

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { performance } = require("node:perf_hooks");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const { terminateProcessTree } = require("./lib/process-tree");
const { promptRuntimeSettings } = require("./review-demo");

const OPTIONS_TARGET = "src/options/options.html";
const PROFILE = path.join(chrome.ROOT, "dist", "dogfood-profile");
const PROMPT_PROFILE =
  process.env.SAVE_IN_PROMPT_PROFILE || path.join(os.homedir(), ".cache", "save-in-nano-profile");
const PROMPT_RUNTIME =
  process.env.SAVE_IN_PROMPT_RUNTIME || path.join(os.homedir(), ".cache", "save-in-nano-runtime");
const ARTIFACTS = path.join(chrome.ROOT, "dist", "dogfood-artifacts");
const REPORT_FILE = path.join(ARTIFACTS, "functional-latest.json");
const FAILURE_FILE = path.join(ARTIFACTS, "functional-failure.json");
const FAILURE_SCREENSHOT = path.join(ARTIFACTS, "functional-failure.png");
// document.modelContext is a blink runtime feature, off by default for the
// whole origin trial. Without this the round's WebMCP checks assert against a
// browser that could never have registered a tool.
const WEBMCP_ARGS = ["--enable-blink-features=WebMCP"];
const WATCH_DIRECTORIES = ["src", "icons", "_locales"];
const WATCH_FILES = ["manifest.json", "config/rolldown.config.mjs"];

/** @typedef {{watch: boolean, headed: boolean, stage: boolean, requireWebMcp: boolean, requirePromptApi: boolean}} DogfoodArgs */
/** @typedef {{name: string, ok: boolean, durationMs: number, details?: unknown, error?: string}} DogfoodCheck */
/**
 * @typedef {{
 *   startedAt: string,
 *   durationMs: number,
 *   browser: string,
 *   webmcp: string,
 *   checks: DogfoodCheck[],
 *   failures: number,
 *   timings: {stageMs?: number, launchMs?: number},
 * }} DogfoodReport
 */

/** @param {string[]} argv @returns {DogfoodArgs} */
const parseArgs = (argv) => {
  const known = new Set([
    "--watch",
    "--headed",
    "--no-stage",
    "--allow-no-webmcp",
    "--allow-no-prompt-api",
  ]);
  const unknown = argv.filter((argument) => argument.startsWith("--") && !known.has(argument));
  if (unknown.length) throw new Error(`Unknown dogfood option: ${unknown.join(", ")}`);
  return {
    watch: argv.includes("--watch"),
    headed: argv.includes("--headed"),
    stage: !argv.includes("--no-stage"),
    requireWebMcp: !argv.includes("--allow-no-webmcp"),
    requirePromptApi: !argv.includes("--allow-no-prompt-api"),
  };
};

/** @returns {{extraArgs: string[], environment: NodeJS.ProcessEnv} | null} */
const provisionedPromptRuntime = () => {
  try {
    return promptRuntimeSettings(PROMPT_RUNTIME);
  } catch {
    return null;
  }
};

/**
 * The on-device profile is only usable together with its provisioned runtime:
 * without a reachable ChromeML device the model process crashes, and Chrome
 * then disables the model for that profile until it is reprovisioned. Falling
 * back keeps a headed round from poisoning the profile `npm run review` needs.
 *
 * @param {boolean} headed
 * @param {string} promptProfile
 * @param {(profile: string) => boolean} [profileExists]
 * @param {() => {extraArgs: string[], environment: NodeJS.ProcessEnv} | null} [promptRuntime]
 */
const selectDogfoodProfile = (
  headed,
  promptProfile,
  profileExists = fs.existsSync,
  promptRuntime = provisionedPromptRuntime,
) => {
  const runtime = headed && profileExists(promptProfile) ? promptRuntime() : null;
  const preserve = runtime !== null;
  return {
    extraArgs: [...WEBMCP_ARGS, ...(runtime?.extraArgs ?? [])],
    environment: runtime?.environment ?? {},
    profileDir: preserve ? promptProfile : PROFILE,
    preserve,
    enableGpu: preserve,
  };
};

/** @param {number} value */
const milliseconds = (value) => `${Math.round(value)} ms`;

/** @param {number} timeoutMs @param {string} label */
const deadline = (timeoutMs, label) =>
  new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    timer.unref?.();
  });

/** @template T @param {Promise<T>} promise @param {string} label @param {number} [timeoutMs] */
const withTimeout = (promise, label, timeoutMs = 15_000) =>
  Promise.race([promise, deadline(timeoutMs, label)]);

/** @param {string} directory */
const emptyDirectory = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
};

/** @param {import("node:http").Server} server */
const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve(undefined)));
    server.closeAllConnections?.();
  });

const createStalledServer = async () => {
  /** @type {(value?: unknown) => void} */
  let startedResolve = () => {};
  /** @type {(value?: unknown) => void} */
  let closedResolve = () => {};
  /** @type {import("node:http").ServerResponse | undefined} */
  let response;
  const started = new Promise((resolve) => (startedResolve = resolve));
  const closed = new Promise((resolve) => (closedResolve = resolve));
  const server = http.createServer((_request, currentResponse) => {
    response = currentResponse;
    currentResponse.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": "1048576",
      "content-disposition": 'attachment; filename="cancel-me.bin"',
    });
    currentResponse.write(Buffer.alloc(1024, 65));
    currentResponse.once("close", closedResolve);
    startedResolve();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dogfood server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/cancel-me.bin`,
    started,
    closed,
    close: async () => {
      response?.destroy();
      await closeServer(server);
    },
  };
};

/**
 * @param {{port: number, downloadDir: string}} session
 * @param {Record<string, unknown>} baseline
 */
const resetState = async (session, baseline) => {
  const serializedBaseline = JSON.stringify(baseline);
  await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `(async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      const optionsUrl = api.runtime.getURL(${JSON.stringify(OPTIONS_TARGET)});
      const [current, tabs, downloads] = await Promise.all([
        api.tabs.getCurrent(),
        api.tabs.query({}),
        api.downloads.search({}),
      ]);
      const keep = current?.id ?? tabs.find((tab) => tab.url?.startsWith(optionsUrl))?.id;
      const remove = tabs.flatMap((tab) => tab.id !== undefined && tab.id !== keep ? [tab.id] : []);
      await Promise.all(downloads
        .filter((download) => download.state === "in_progress")
        .map((download) => api.downloads.cancel(download.id).catch(() => {})));
      await api.downloads.erase({});
      if (remove.length) await api.tabs.remove(remove);
      if (api.notifications?.getAll) {
        const notifications = await api.notifications.getAll();
        await Promise.all(Object.keys(notifications).map((id) => api.notifications.clear(id)));
      }
      if (api.declarativeNetRequest?.getSessionRules) {
        const rules = await api.declarativeNetRequest.getSessionRules();
        if (rules.length) await api.declarativeNetRequest.updateSessionRules({
          removeRuleIds: rules.map((rule) => rule.id),
        });
      }
      await api.storage.session?.clear?.();
      await api.storage.local.clear();
      await api.storage.local.set(${serializedBaseline});
      await api.runtime.sendMessage({type: "OPTIONS_LOADED"});
      return true;
    })()`,
  );
  emptyDirectory(session.downloadDir);
  await cdp.reloadTargets(session.port, OPTIONS_TARGET);
};

/**
 * @param {{port: number}} session
 * @param {string} expression
 * @param {string} label
 * @param {number} [timeoutMs]
 */
const waitForValue = async (session, expression, label, timeoutMs = 10_000) => {
  const end = performance.now() + timeoutMs;
  /** @type {unknown} */
  let lastValue;
  /** @type {unknown} */
  let lastError;
  while (performance.now() < end) {
    try {
      lastValue = await cdp.evalInTarget(session.port, OPTIONS_TARGET, expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}${
      lastError ? `; last error: ${String(lastError)}` : ""
    }`,
  );
};

/** @param {{port: number}} session */
const waitForOptions = async (session) => {
  await waitForValue(
    session,
    `document.readyState === "complete" &&
      !document.documentElement.classList.contains("localization-pending") &&
      document.querySelector("#history-list") &&
      document.querySelector("#webmcp-status")?.textContent`,
    "initialized options page",
    15_000,
  );
};

/**
 * @param {{port: number}} session
 * @param {boolean} required
 */
const checkPromptApi = async (session, required) => {
  try {
    const result = /** @type {{availability: string, output?: string}} */ (
      await cdp.callFunctionInTarget(
        session.port,
        OPTIONS_TARGET,
        `async function () {
          if (typeof LanguageModel === "undefined") return {availability: "missing"};
          let availability = await LanguageModel.availability();
          const deadline = Date.now() + 60_000;
          while (availability === "downloading" && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            availability = await LanguageModel.availability();
          }
          if (availability !== "available") return {availability};
          const session = await LanguageModel.create();
          try {
            return {
              availability,
              output: await session.prompt(
                "Reply with a short confirmation that local Save In assistance is ready.",
              ),
            };
          } finally {
            session.destroy();
          }
        }`,
        [],
        180_000,
      )
    );
    if (result.availability !== "available" || !result.output?.trim()) {
      if (required) {
        throw new Error(`Expected a Prompt API completion, received: ${result.availability}`);
      }
      return { ...result, required };
    }
    return { ...result, output: result.output.slice(0, 240), required };
  } catch (error) {
    if (required) throw error;
    return { availability: "failed", error: String(error), required };
  }
};

/** @param {DogfoodReport} report @param {string} name @param {() => Promise<unknown>} operation */
const runCheck = async (report, name, operation) => {
  const start = performance.now();
  try {
    const details = await operation();
    const durationMs = performance.now() - start;
    report.checks.push({ name, ok: true, durationMs, details });
    process.stdout.write(`  ✓ ${name} (${milliseconds(durationMs)})\n`);
  } catch (error) {
    const durationMs = performance.now() - start;
    const message = error instanceof Error ? error.stack || error.message : String(error);
    report.checks.push({ name, ok: false, durationMs, error: message });
    process.stdout.write(`  ✗ ${name} (${milliseconds(durationMs)})\n    ${message}\n`);
  }
};

/** @param {{port: number}} session */
const checkOptimisticConfiguration = async (session) => {
  const result = await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `(async () => {
      const send = (message) => chrome.runtime.sendMessage(message);
      await send({type: "APPLY_CONFIG", body: {config: {prompt: false}}});
      const first = await send({
        type: "APPLY_CONFIG",
        body: {config: {prompt: true}, expected: {prompt: false}},
      });
      const stale = await send({
        type: "APPLY_CONFIG",
        body: {config: {prompt: false}, expected: {prompt: false}},
      });
      if (first.body.rejected.length || stale.body.rejected.length !== 1) {
        throw new Error(JSON.stringify({first, stale}));
      }
      return {rejection: stale.body.rejected[0]};
    })()`,
  );
  return result;
};

/** @param {{port: number, downloadDir: string}} session */
const checkHistoryLifecycle = async (session) => {
  const stalled = await createStalledServer();
  try {
    const cancelRule = "comment: ^cancel-ui$\ninto: canceled/:filename:";
    const applyCancel = {
      type: "APPLY_CONFIG",
      body: {
        config: {
          filenamePatterns: cancelRule,
          prompt: false,
          routeFailurePrompt: false,
        },
      },
    };
    const downloadCancel = {
      type: "DOWNLOAD",
      body: {
        url: stalled.url,
        comment: "cancel-ui",
        info: {
          srcUrl: stalled.url,
          suggestedFilename: "cancel-me.bin",
          pageUrl: "https://cancel.example/",
        },
      },
    };
    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `(async () => {
        const applied = await chrome.runtime.sendMessage(${JSON.stringify(applyCancel)});
        if (applied.body.rejected.length) throw new Error(JSON.stringify(applied));
        globalThis.__dogfoodCancelResult = "pending";
        chrome.runtime.sendMessage(${JSON.stringify(downloadCancel)}).then(
          (value) => globalThis.__dogfoodCancelResult = value,
          (error) => globalThis.__dogfoodCancelResult = {error: String(error)},
        );
        return true;
      })()`,
    );
    await withTimeout(stalled.started, "stalled acquisition");
    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `document.querySelector("#tab-section-history").click(); true`,
    );
    const pending = await waitForValue(
      session,
      `(() => {
        const row = [...document.querySelectorAll("#history-list tr")]
          .find((item) => item.textContent.includes("cancel-me.bin"));
        const cancel = row?.querySelector(".history-cancel");
        return cancel && row.querySelector(".status-badge")?.textContent?.trim() === "Saving…";
      })()`,
      "cancelable History row",
    );
    if (!pending) throw new Error("Pending History row was not cancelable");
    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `(() => {
        const row = [...document.querySelectorAll("#history-list tr")]
          .find((item) => item.textContent.includes("cancel-me.bin"));
        row.querySelector(".history-cancel").click();
        return true;
      })()`,
    );
    await withTimeout(stalled.closed, "network abort");
    await waitForValue(
      session,
      `chrome.runtime.sendMessage({type: "HISTORY_GET"}).then((response) =>
        response.body.entries.some((entry) =>
          entry.finalFullPath === "canceled/cancel-me.bin" && entry.status === "USER_CANCELED"))`,
      "durable canceled history",
    );
    await waitForValue(
      session,
      `(() => {
        const row = [...document.querySelectorAll("#history-list tr")]
          .find((item) => item.textContent.includes("cancel-me.bin"));
        return row?.querySelector(".status-badge")?.textContent?.trim() === "Canceled" &&
          !row.querySelector(".history-cancel");
      })()`,
      "canceled History UI",
    );

    const savedRule = "comment: ^saved-ui$\ninto: saved/:filename:";
    const dataUrl = "data:text/plain;base64,c2F2ZWQtaGlzdG9yeS1maWx0ZXI=";
    const applySaved = { type: "APPLY_CONFIG", body: { config: { filenamePatterns: savedRule } } };
    const downloadSaved = {
      type: "DOWNLOAD",
      body: {
        url: dataUrl,
        comment: "saved-ui",
        info: { srcUrl: dataUrl, suggestedFilename: "saved-ui.txt" },
      },
    };
    const accepted = await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `(async () => {
        await chrome.runtime.sendMessage(${JSON.stringify(applySaved)});
        return chrome.runtime.sendMessage(${JSON.stringify(downloadSaved)});
      })()`,
    );
    if (accepted?.body?.status !== "OK") throw new Error(JSON.stringify(accepted));
    await waitForValue(
      session,
      `chrome.runtime.sendMessage({type: "HISTORY_GET"}).then((response) =>
        response.body.entries.some((entry) =>
          entry.finalFullPath === "saved/saved-ui.txt" && entry.status === "complete"))`,
      "durable saved history",
    );
    await waitForValue(
      session,
      `(() => {
        const row = [...document.querySelectorAll("#history-list tr")]
          .find((item) => item.textContent.includes("saved-ui.txt"));
        return row?.querySelector(".status-badge")?.textContent?.trim() === "Saved";
      })()`,
      "saved terminal History row",
      5_000,
    );

    const filters = await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `(() => {
        const select = document.querySelector("#history-status-filter");
        const read = () => ({
          count: document.querySelector("#history-count").textContent,
          text: document.querySelector("#history-list").textContent,
        });
        select.value = "complete";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        const saved = read();
        select.value = "failed";
        select.dispatchEvent(new Event("change", {bubbles: true}));
        const failed = read();
        document.querySelector("#history-clear-filters").click();
        return {saved, failed};
      })()`,
    );
    if (
      !filters.saved.text.includes("saved-ui.txt") ||
      filters.saved.text.includes("cancel-me.bin") ||
      !filters.failed.text.includes("cancel-me.bin") ||
      filters.failed.text.includes("saved-ui.txt")
    ) {
      throw new Error(`History filters returned incorrect rows: ${JSON.stringify(filters)}`);
    }

    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `document.querySelector("#history-export-json").click(); true`,
    );
    const exported = await waitForValue(
      session,
      `chrome.downloads.search({}).then((rows) => rows.find((row) =>
        row.filename.endsWith("/save-in-history.json") && row.state === "complete") || null)`,
      "History JSON export",
    );
    const exportedFile = /** @type {{filename: string}} */ (exported);
    const parsed = JSON.parse(fs.readFileSync(exportedFile.filename, "utf8"));
    const paths = parsed.map(
      (/** @type {{finalFullPath?: string}} */ entry) => entry.finalFullPath,
    );
    if (!paths.includes("canceled/cancel-me.bin") || !paths.includes("saved/saved-ui.txt")) {
      throw new Error(`History export omitted entries: ${JSON.stringify(paths)}`);
    }

    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `document.querySelector("#history-clear").click(); true`,
    );
    // Clearing asks through an in-app dialog, not window.confirm.
    await waitForValue(
      session,
      `(() => {
        const confirm = document.querySelector(".history-clear-dialog .button-danger");
        if (!confirm) return false;
        confirm.click();
        return true;
      })()`,
      "History clear confirmation dialog",
    );
    await waitForValue(
      session,
      `chrome.runtime.sendMessage({type: "HISTORY_GET"}).then((response) =>
        response.body.entries.length === 0 &&
        document.querySelector("#history-count")?.textContent?.startsWith("0"))`,
      "cleared History storage and UI",
    );
    return {
      canceledRequestAborted: true,
      savedFilter: filters.saved.count,
      failedFilter: filters.failed.count,
      exportedEntries: parsed.length,
    };
  } finally {
    await stalled.close();
  }
};

/** @param {{port: number}} session */
const checkWorkerRecovery = async (session) => {
  await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `chrome.runtime.sendMessage({type: "GET_CONFIG"}).then(() => true)`,
  );
  const worker = (await cdp.listTargets(session.port)).find(
    (/** @type {{type: string, url: string}} */ target) =>
      target.type === "service_worker" && target.url.includes("background.sw.js"),
  );
  if (!worker) throw new Error("No MV3 service worker target was available to stop");
  const browser = await cdp.connectBrowser(session.port);
  try {
    await browser.send("Target.closeTarget", { targetId: worker.id });
  } finally {
    browser.close();
  }
  const configKeys = await waitForValue(
    session,
    `chrome.runtime.sendMessage({type: "GET_CONFIG"}).then((response) =>
      Object.keys(response.body.config).length)`,
    "configuration after worker restart",
    10_000,
  );
  await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `(() => {
      document.querySelector("#tab-section-dynamic-downloads").click();
      document.querySelector("#route-debugger-use-sample").click();
      return true;
    })()`,
  );
  const debuggerState = await waitForValue(
    session,
    `(() => {
      const state = document.querySelector("#route-debugger-result")?.dataset.state;
      return state === "matched" || state === "no-match" ? state : "";
    })()`,
    "route debugger after worker restart",
  );
  return { stopped: true, configKeys, debuggerState };
};

/**
 * @param {{port: number, downloadDir: string, browserVersion: string}} session
 * @param {Record<string, unknown>} baseline
 * @param {{stageMs?: number, launchMs?: number}} timings
 * @param {boolean} requireWebMcp
 * @param {{headed: boolean, requirePromptApi: boolean}} promptApi
 */
const runRound = async (session, baseline, timings, requireWebMcp, promptApi) => {
  const started = performance.now();
  /** @type {DogfoodReport} */
  const report = {
    startedAt: new Date().toISOString(),
    durationMs: 0,
    browser: session.browserVersion,
    webmcp: "",
    checks: [],
    failures: 0,
    timings,
  };
  await resetState(session, baseline);
  await waitForOptions(session);
  report.webmcp = String(
    await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `document.querySelector("#webmcp-status")?.textContent?.trim() || "Unavailable"`,
    ),
  );
  process.stdout.write(`\nFunctional dogfood — ${report.webmcp}\n`);

  await runCheck(report, "WebMCP availability", async () => {
    if (requireWebMcp && !report.webmcp.startsWith("Active")) {
      throw new Error(`Expected active WebMCP, received: ${report.webmcp}`);
    }
    return { status: report.webmcp, required: requireWebMcp };
  });

  await runCheck(report, "on-device Prompt API inference", () =>
    promptApi.headed
      ? checkPromptApi(session, promptApi.requirePromptApi)
      : Promise.resolve({ availability: "skipped-headless", required: false }),
  );

  await runCheck(report, "optimistic configuration conflict", () =>
    checkOptimisticConfiguration(session),
  );
  await resetState(session, baseline);
  await waitForOptions(session);
  await runCheck(report, "cancel, terminal history, filters, export, and clear", () =>
    checkHistoryLifecycle(session),
  );
  await resetState(session, baseline);
  await waitForOptions(session);
  await runCheck(report, "MV3 worker restart and route debugger recovery", () =>
    checkWorkerRecovery(session),
  );

  report.durationMs = performance.now() - started;
  report.failures = report.checks.filter((check) => !check.ok).length;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  if (report.failures === 0) {
    fs.rmSync(FAILURE_FILE, { force: true });
    fs.rmSync(FAILURE_SCREENSHOT, { force: true });
  }
  process.stdout.write(
    `${report.failures ? "FAILED" : "Passed"}: ${report.checks.length - report.failures}/${
      report.checks.length
    } checks in ${milliseconds(report.durationMs)}\n`,
  );
  return report;
};

/** @param {{port: number, logPath: string}} session @param {DogfoodReport} report */
const captureFailureArtifacts = async (session, report) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  /** @type {unknown} */
  let pageState;
  try {
    pageState = await cdp.evalInTarget(
      session.port,
      OPTIONS_TARGET,
      `(async () => ({
        activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
        dialogs: document.querySelectorAll('dialog[open]').length,
        webmcp: document.querySelector('#webmcp-status')?.textContent,
        history: (await chrome.runtime.sendMessage({type: "HISTORY_GET"})).body.entries,
        logs: (await chrome.storage.session.get("si-log"))["si-log"] ?? [],
        text: document.body.innerText.slice(0, 12000),
      }))()`,
    );
  } catch (error) {
    pageState = { captureError: String(error) };
  }
  fs.writeFileSync(
    FAILURE_FILE,
    `${JSON.stringify(
      { report, pageState, chromeLog: chrome.logTail(session.logPath) },
      null,
      2,
    )}\n`,
  );
  try {
    const screenshot = await cdp.captureScreenshot(session.port, OPTIONS_TARGET, {
      width: 1440,
      height: 1000,
    });
    fs.writeFileSync(FAILURE_SCREENSHOT, screenshot, "base64");
  } catch (error) {
    process.stderr.write(`Could not capture dogfood screenshot: ${String(error)}\n`);
  }
  process.stderr.write(`Failure artifacts: ${path.relative(chrome.ROOT, FAILURE_FILE)}\n`);
};

/** @param {{port: number, extensionId: string}} session */
const reloadStagedExtension = async (session) => {
  chrome.stageBuild();
  await cdp.loadUnpacked(session.port, chrome.DIST);
  await cdp.replaceTab(
    session.port,
    OPTIONS_TARGET,
    `chrome-extension://${session.extensionId}/${OPTIONS_TARGET}`,
  );
  await waitForOptions(session);
};

/** @param {DogfoodArgs} args */
const main = async (args) => {
  if (args.headed) delete process.env.HEADLESS;
  else process.env.HEADLESS = "1";

  /** @type {{stageMs?: number, launchMs?: number}} */
  const timings = {};
  if (args.stage) {
    const stageStart = performance.now();
    chrome.stageBuild();
    timings.stageMs = performance.now() - stageStart;
    process.stdout.write(`Staged bundle in ${milliseconds(timings.stageMs)}\n`);
  }

  const launchStart = performance.now();
  const selectedProfile = selectDogfoodProfile(args.headed, PROMPT_PROFILE);
  const selectedDownloads = selectedProfile.preserve
    ? path.join(selectedProfile.profileDir, "downloads")
    : undefined;
  if (selectedDownloads) fs.mkdirSync(selectedDownloads, { recursive: true });
  const session = await chrome.launch({
    profileDir: selectedProfile.profileDir,
    ...(selectedDownloads ? { downloadDir: selectedDownloads } : {}),
    extensionDir: chrome.DIST,
    fresh: !selectedProfile.preserve,
    preserveProfile: selectedProfile.preserve,
    enableGpu: selectedProfile.enableGpu,
    extraArgs: selectedProfile.extraArgs,
    environment: selectedProfile.environment,
  });
  if (!session.downloadDir)
    throw new Error("Chrome did not provide an isolated download directory");
  const functionalSession = /** @type {typeof session & {downloadDir: string}} */ (session);
  timings.launchMs = performance.now() - launchStart;
  process.stdout.write(
    `Launched isolated ${session.browserVersion} in ${milliseconds(timings.launchMs)}\n`,
  );
  await cdp.openTab(session.port, `chrome-extension://${session.extensionId}/${OPTIONS_TARGET}`);
  await waitForOptions(session);
  await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `document.querySelector(".welcome-dialog[open] .welcome-accept")?.click(); true`,
  );
  await waitForValue(
    session,
    `!document.querySelector(".welcome-dialog[open]")`,
    "welcome dismissal",
  );
  await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    // webmcpEnabled is the user's opt-in and is off by default, so the round
    // has to answer that switch before it can assert on registered tools. It
    // rides the baseline because resetState restores it and reloads, and
    // registration only reads the switch at page load.
    `chrome.storage.local.set({
      webmcpEnabled: true,
      notifyOnSuccess: false,
      notifyOnFailure: false,
      notifyOnRuleMatch: false,
      notifyOnLinkPreferred: false,
    }).then(() => chrome.runtime.sendMessage({type: "OPTIONS_LOADED"})).then(() => true)`,
  );
  const baseline = await cdp.evalInTarget(
    session.port,
    OPTIONS_TARGET,
    `chrome.storage.local.get(null)`,
  );

  let stopping = false;
  let running = false;
  let queued = false;
  let queuedRebuild = false;
  /** @type {ReturnType<typeof fs.watch>[]} */
  const watchers = [];
  /** @type {NodeJS.Timeout | undefined} */
  let reloadTimer;
  /** @type {readline.Interface | undefined} */
  let input;

  const stop = async () => {
    if (stopping) return;
    const cleanupStart = performance.now();
    stopping = true;
    clearTimeout(reloadTimer);
    watchers.forEach((watcher) => watcher.close());
    input?.close();
    // This process owns a disposable isolated profile, so a short graceful
    // window keeps one-shot feedback fast while the tree-kill fallback still
    // prevents Chrome helpers from leaking between rounds.
    await terminateProcessTree(session.proc, {
      detached: process.platform !== "win32",
      graceMs: 1_000,
    });
    if (!selectedProfile.preserve) await chrome.removeProfile(session.profileDir);
    process.stdout.write(
      `${selectedProfile.preserve ? "Stopped preserved-profile" : "Cleaned isolated"} browser in ${milliseconds(
        performance.now() - cleanupStart,
      )}\n`,
    );
  };
  const requestStop = () => {
    void stop().catch((error) => {
      process.stderr.write(`Dogfood cleanup failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  /** @param {boolean} rebuild */
  const execute = async (rebuild) => {
    if (running) {
      queued = true;
      queuedRebuild ||= rebuild;
      return;
    }
    running = true;
    try {
      if (rebuild) await reloadStagedExtension(session);
      const report = await runRound(functionalSession, baseline, timings, args.requireWebMcp, {
        headed: args.headed,
        requirePromptApi: args.requirePromptApi,
      });
      if (report.failures) await captureFailureArtifacts(session, report);
      if (!args.watch && report.failures) process.exitCode = 1;
    } catch (error) {
      process.exitCode = 1;
      process.stderr.write(
        `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
    } finally {
      running = false;
      if (queued && !stopping) {
        const rebuildQueued = queuedRebuild;
        queued = false;
        queuedRebuild = false;
        void execute(rebuildQueued);
      }
    }
  };

  try {
    await execute(false);
    if (!args.watch) return;

    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void execute(true), 300);
    };
    for (const directory of WATCH_DIRECTORIES) {
      watchers.push(
        fs.watch(path.join(chrome.ROOT, directory), { recursive: true }, scheduleReload),
      );
    }
    for (const file of WATCH_FILES) {
      watchers.push(fs.watch(path.join(chrome.ROOT, file), scheduleReload));
    }
    input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.on("line", () => void execute(false));
    process.stdout.write(
      "Watching source files. Press Enter for an immediate rerun; Ctrl+C to stop.\n",
    );
    await new Promise((resolve) => session.proc.once("exit", resolve));
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    await stop();
  }
};

if (require.main === module) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 2;
  }
  if (args) {
    main(args).catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  }
}

module.exports = { milliseconds, parseArgs, selectDogfoodProfile };
