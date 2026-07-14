// Firefox end-to-end suite: throwaway profile, temporary install over RDP
// (the about:debugging mechanism), evaluated in the extension's background
// event page and an extension-page control client. Tests are sequential but
// restore a steady-state baseline after each case.

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import firefox from "../../scripts/lib/firefox.js";
import { inBackgroundContext } from "./background-context.mjs";
import { registerSharedBrowserCases } from "./cases/shared-browser.cases.mjs";
import {
  runContentDispositionScenario,
  runExternalExtensionScenario,
  runInterruptedTransferRecoveryScenario,
  runPrivateBrowserActivityScenario,
  runPrivateContextScenario,
} from "./shared-scenarios.mjs";
import { createHarnessSession } from "./harness-session.mjs";
import {
  appendImageAndWaitForSourceExpression,
  beginResourceScope,
  closeLocal,
  createLazyPageEvaluator,
  listenLocal,
  poll,
  waitForApiEntriesExpression,
  waitForDownloadExpression,
  waitForTabExpression,
} from "./helpers.mjs";

/** @type {Awaited<ReturnType<typeof firefox.launch>>} */
let session;
let suiteFailed = false;
/** @type {import("./helpers.mjs").E2EResourceScope | undefined} */
let resourceScope;
/** @type {ReturnType<typeof createHarnessSession> | undefined} */
let harness;
const FIRST_INSTALL_TEST = "first install starts with a focused welcome";
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(process.env.E2E_ARTIFACT_DIR)
  : path.resolve("dist", "e2e-artifacts");

/** @param {string} expr @param {number} [timeoutMs] */
const rawEvalOptions = (expr, timeoutMs) =>
  session.evaluateInTab("src/options/options.html", expr, timeoutMs);
/** @param {string} expr @param {number} [timeoutMs] */
const evalBackground = (expr, timeoutMs) => rawEvalOptions(inBackgroundContext(expr), timeoutMs);
const reloadOptionsPage = async () => {
  const tabId = await session.evaluate(
    `browser.tabs.query({}).then((tabs) => tabs.find((tab) =>
      tab.url?.startsWith(browser.runtime.getURL("src/options/options.html")))?.id)`,
  );
  if (tabId === undefined) {
    await session.evaluate(
      `browser.tabs.create({ url: browser.runtime.getURL("src/options/options.html") })`,
    );
  } else {
    await session.evaluate(`browser.tabs.reload(${JSON.stringify(tabId)})`);
  }
  await poll(
    async () =>
      (await rawEvalOptions(`document.readyState === "complete" &&
        Boolean(browser.runtime?.id) &&
        Boolean(document.querySelector("#autocomplete-paths")) &&
        document.querySelector("#paths")?.getAttribute("aria-busy") === "false" &&
        document.querySelector("#filenamePatterns")?.getAttribute("aria-busy") === "false"`))
        ? true
        : null,
    { description: "reloaded Firefox options page", ignoreErrors: true },
  );
};
const optionsPage = createLazyPageEvaluator({
  evaluate: rawEvalOptions,
  prepare: reloadOptionsPage,
});
const evalOptions = optionsPage.evaluate;
/** @param {string} name */
const artifactName = (name) =>
  name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();

/** @param {string} testName @param {number | undefined} durationMs */
const captureFailureArtifacts = async (testName, durationMs) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  /** @type {Record<string, any>} */
  const report = {
    testName,
    durationMs,
    capturedAt: new Date().toISOString(),
    runId: process.env.E2E_RUN_ID,
    browser: {
      executable: session?.browserPath,
      version: session?.browserVersion,
    },
  };
  try {
    report.background = JSON.parse(
      await evalBackground(`Promise.all([
        api.inspect(), api.logs(), api.history(), browser.storage.local.get(null),
        browser.tabs.query({}).then((tabs) => tabs.map(({ id, title, url, active }) => ({ id, title, url, active })))
      ]).then(([inspect, logs, history, local, tabs]) => JSON.stringify({ inspect, logs, history, local, tabs }))`),
    );
  } catch (error) {
    report.backgroundCaptureError = String(error);
  }
  try {
    if (session?.bidi) {
      fs.writeFileSync(
        path.join(ARTIFACTS, `firefox-failure-${artifactName(testName)}.png`),
        Buffer.from(await session.bidi.captureScreenshot("src/options/options.html"), "base64"),
      );
    }
  } catch (error) {
    report.screenshotCaptureError = String(error);
  }
  try {
    report.browserLogTail = session?.logPath
      ? fs.readFileSync(session.logPath, "utf8").slice(-12000).trim()
      : "";
  } catch (error) {
    report.browserLogError = String(error);
  }
  fs.writeFileSync(
    path.join(ARTIFACTS, `firefox-failure-${artifactName(testName)}.json`),
    JSON.stringify(report, null, 2),
  );
};

/** @param {string} filenamePart @param {number} [deadlineMs] @returns {Promise<any[]>} */
const waitForDownloads = async (filenamePart, deadlineMs = 8000) =>
  JSON.parse(
    await evalBackground(
      waitForDownloadExpression({ filenameIncludes: filenamePart, timeoutMs: deadlineMs }),
      deadlineMs + 2000,
    ),
  );

/** @param {string} url @returns {Promise<string>} */
const waitForDownloadUrl = async (url) => {
  const rows = JSON.parse(await evalBackground(waitForDownloadExpression({ url })));
  return path.basename(rows.at(-1).filename);
};

/** @param {string} url @returns {Promise<string>} */
const downloadUsingBrowserFilename = async (url) => {
  await evalBackground(`browser.tabs.create({ url: ${JSON.stringify(url)} }).then(() => true)`);
  return waitForDownloadUrl(url);
};

/** @param {string} predicate @param {number} [deadlineMs] @returns {Promise<any[]>} */
const waitForLog = async (predicate, deadlineMs = 8000) =>
  JSON.parse(
    await evalBackground(
      waitForApiEntriesExpression("logs", predicate, deadlineMs),
      deadlineMs + 2000,
    ),
  );

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const startPageServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<html><body><img id="img" src="/pic.png" width="50" height="50"></body></html>');
    }
  });
  const port = await listenLocal(server);
  return { server, port };
};

const startSourcePanelServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
      res.end(PNG);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Page Sources e2e</title>
      <img src="/first.png" alt="first"><img src="/second.png" alt="second">`);
  });
  const port = await listenLocal(server);
  return { server, port };
};

beforeAll(async () => {
  try {
    session = await firefox.launch();
    // Native notifications are exercised by one focused test below. Keep the
    // rest of the download-heavy suite from submitting Windows toasts.
    await evalBackground(`browser.storage.local.set({
      notifyOnSuccess: false,
      notifyOnFailure: false,
      notifyOnRuleMatch: false,
      notifyOnLinkPreferred: false,
    }).then(() => api.reset()).then(() => "notifications suppressed")`);
    harness = createHarnessSession({
      evaluateBackground: evalBackground,
      evaluateControl: (expression, timeoutMs) => session.evaluate(expression, timeoutMs),
      downloadDir: () => session.downloadDir,
    });
  } catch (error) {
    suiteFailed = true;
    throw error;
  }
});

beforeEach(async ({ task }) => {
  resourceScope = beginResourceScope();
  if (task.name !== FIRST_INSTALL_TEST) optionsPage.invalidate();
  if (!harness) throw new Error("Firefox E2E harness was not initialized");
  await harness.beginCase();
});

afterAll(async () => {
  if (session) {
    let cleanupError;
    try {
      await session.cleanup();
    } catch (error) {
      cleanupError = error;
    }
    if (!suiteFailed && !cleanupError && session.logPath)
      fs.rmSync(session.logPath, { force: true });
    if (cleanupError) throw cleanupError;
  }
});

afterEach(async ({ task }) => {
  /** @type {unknown[]} */
  const cleanupErrors = [];
  if (task.result?.state === "fail") {
    suiteFailed = true;
    try {
      await captureFailureArtifacts(task.name, task.result?.duration);
    } catch (error) {
      process.stderr.write(
        `Unable to capture Firefox failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
    }
  }
  try {
    await resourceScope?.dispose();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await harness?.endCase({
      preserveLocal: task.name === FIRST_INSTALL_TEST && task.result?.state !== "fail",
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Firefox E2E case cleanup failed");
  }
});

test("first install starts with a focused welcome", async () => {
  const welcome = await poll(
    async () => {
      const state = JSON.parse(
        await evalOptions(`browser.storage.local.get("welcomePendingVersion").then((stored) =>
          JSON.stringify({
            open: document.querySelector("#welcome-dialog")?.open === true,
            focused: document.activeElement === document.querySelector(".welcome-accept"),
            pending: stored.welcomePendingVersion,
          }))`),
      );
      return state.open && state.focused ? state : null;
    },
    { description: "Firefox first-install welcome dialog" },
  );
  expect(welcome.pending).toBe(1);

  await evalOptions(`document.querySelector(".welcome-accept").click()`);
  await poll(
    async () => {
      const state = JSON.parse(
        await evalOptions(`browser.storage.local.get("welcomePendingVersion").then((stored) =>
          JSON.stringify({
            dismissed: !document.querySelector("#welcome-dialog"),
            pending: stored.welcomePendingVersion,
          }))`),
      );
      return state.dismissed && state.pending === undefined ? state : null;
    },
    { description: "Firefox welcome dismissal" },
  );
});

test("background event page initialises cleanly", async () => {
  const state = JSON.parse(
    await evalBackground(`api.inspect().then((state) => JSON.stringify(state))`),
  );

  expect(state.browser).toBe("FIREFOX");
  expect(state.capabilities).toMatchObject({
    tabContextMenus: true,
    accessKeys: true,
    downloadFilenameSuggestion: false,
    downloadDeltaFilename: false,
    conflictActionPrompt: true,
    downloadRequestHeaders: true,
  });
  expect(state.promptConflictAction).toBe("prompt");
  // Event pages keep a real DOM (unlike Chrome's service worker)...
  expect(state.hasObjectUrl).toBe(true);
  expect(
    await evalBackground(
      `api.logs().then((log) => log.some((entry) => entry.message === "init failed"))`,
    ),
  ).toBe(false);
});

test("options page autosaves through Firefox host APIs", async () => {
  const original = await evalBackground(`api.getOption("promptOnShift")`);
  const changed = !original;
  try {
    await poll(
      async () =>
        (await evalOptions(
          `(() => {
            const checkbox = document.querySelector("#promptOnShift");
            return document.readyState === "complete" && checkbox && !checkbox.disabled;
          })()`,
        )) === true
          ? true
          : null,
      { description: "Firefox options controls" },
    );
    await evalOptions(
      `(() => {
        const checkbox = document.querySelector("#promptOnShift");
        checkbox.checked = ${JSON.stringify(changed)};
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );

    const state = await poll(
      async () => {
        const candidate = JSON.parse(
          await evalBackground(`Promise.all([
            browser.storage.local.get("promptOnShift"),
            api.getOption("promptOnShift"),
          ]).then(([stored, live]) => JSON.stringify({ stored: stored.promptOnShift, live }))`),
        );
        return candidate.stored === changed && candidate.live === changed ? candidate : null;
      },
      { description: "Firefox options autosave" },
    );
    expect(state).toEqual({ stored: changed, live: changed });
  } finally {
    await evalBackground(`api.setOptions({ promptOnShift: ${JSON.stringify(original)} })`);
  }
});

test("event-page reload hydrates persisted options before replying", async () => {
  const original = await evalBackground(`api.getOption("promptOnShift")`);
  const persisted = !original;
  try {
    await evalBackground(
      `browser.storage.local.set({ promptOnShift: ${JSON.stringify(persisted)} })`,
    );
    await session.reloadBackgroundPage();
    expect(await evalBackground(`api.getOption("promptOnShift")`)).toBe(persisted);
  } finally {
    await evalBackground(`api.setOptions({ promptOnShift: ${JSON.stringify(original)} })`).catch(
      () =>
        session
          .evaluate(`browser.storage.local.set({ promptOnShift: ${JSON.stringify(original)} })`)
          .catch(() => {}),
    );
  }
});

test("event-page cold start removes a stale Referer session rule", async () => {
  await evalBackground(`browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [66000001],
    addRules: [{
      id: 66000001,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{
          header: "Referer",
          operation: "set",
          value: "https://stale.example/",
        }],
      },
      condition: {
        urlFilter: "|http://127.0.0.1/",
        resourceTypes: ["xmlhttprequest"],
      },
    }],
  }).then(() => true)`);
  await session.reloadBackgroundPage();
  const remaining = JSON.parse(
    await evalBackground(
      `browser.declarativeNetRequest.getSessionRules().then((rules) => JSON.stringify(rules.map(({ id }) => id)))`,
    ),
  );
  expect(remaining).not.toContain(66_000_001);
});

test("event-page cold start recovers an interrupted in-flight fetch", async () => {
  await runInterruptedTransferRecoveryScenario({
    evaluate: evalBackground,
    restartBackground: () => session.reloadBackgroundPage(),
    filename: "interrupted-firefox.bin",
  });
});

test("download completes through the real pipeline", async () => {
  await evalBackground(
    `api.startDownload({
        content: "firefox e2e content",
        suggestedFilename: "ff-smoke.txt",
        pageUrl: "https://example.com/",
      }).then(() => "started")`,
  );
  const downloads = await waitForDownloads("ff-smoke");

  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toBe("firefox e2e content");
});

test("private context-menu saves leave no extension history or session state", async () => {
  const privateWindowId = Number(
    await evalBackground(`browser.windows.create({ incognito: true, url: "about:blank" })
      .then((window) => window.id)`),
  );
  try {
    await runPrivateContextScenario({
      evaluate: evalBackground,
      waitForDownloads: async (filename) => {
        const privatePath = path.join(session.downloadDir, "e2e", "private", `${filename}.txt`);
        await poll(() => (fs.existsSync(privatePath) ? true : null), {
          description: "Firefox private download file",
        });
        return [{ state: "complete", filename: privatePath }];
      },
      filename: "private-firefox",
    });
  } finally {
    await evalBackground(`browser.windows.remove(${privateWindowId})`);
  }
});

test("real Private Browsing activity stays out of routing, history, and automatic saves until opted in", async () => {
  await runPrivateBrowserActivityScenario({
    evaluate: evalBackground,
    openPrivatePage: async (url) => {
      const opened = JSON.parse(
        await evalBackground(`browser.windows.create({ incognito: true, url: ${JSON.stringify(url)} })
          .then((window) => JSON.stringify({ windowId: window.id }))`),
      );
      const tab = JSON.parse(await evalBackground(`(${waitForTabExpression("/private-browser")})`));
      return {
        tabId: tab.id,
        target: `127.0.0.1:${new URL(tab.url).port}/private-browser`,
        close: () =>
          evalBackground(`browser.windows.remove(${opened.windowId})`).then(() => undefined),
      };
    },
    evaluatePrivatePage: (target, expression) => session.evaluateInTab(target, expression),
    waitForFile: async (relativePath) => {
      const fullPath = path.join(session.downloadDir, relativePath);
      await poll(
        () => (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0 ? fullPath : null),
        {
          description: `Firefox private file ${relativePath}`,
        },
      );
      return fullPath;
    },
    filenamePrefix: "private-firefox-real",
  });
});

test("Save In filenames match live Firefox Content-Disposition behavior", async () => {
  await runContentDispositionScenario({
    evaluate: evalBackground,
    downloadUsingBrowserFilename,
    waitForDownloadUrl,
  });
});

test("success notifications are created by the real download listener", async () => {
  try {
    const beforeLog = Number(
      await evalBackground(`api.notificationCalls("reset")
        .then(() => browser.notifications.getAll())
        .then((rows) => Promise.all(Object.keys(rows).map((id) => browser.notifications.clear(id))))
        .then(() => browser.storage.local.set({ notifyOnSuccess: true, notifyDuration: 0 }))
        .then(() => api.reset())
        .then(() => api.logs())
        .then((log) => log.length)`),
    );

    await evalBackground(`api.startDownload({
      content: "firefox notification content",
      suggestedFilename: "ff-notification-e2e.txt",
      pageUrl: "https://example.com/",
    }).then(() => "started")`);
    const downloads = await waitForDownloads("ff-notification-e2e");
    const download = downloads.find((row) => row.state === "complete");
    expect(download?.id).toEqual(expect.any(Number));
    const notificationId = String(download.id);

    const notification = await poll(
      async () => {
        const calls = JSON.parse(
          await evalBackground(
            `api.notificationCalls("get").then((calls) => JSON.stringify(calls))`,
          ),
        );
        return calls.find((/** @type {any} */ call) => call.id === notificationId) || null;
      },
      { description: "success notification for ff-notification-e2e" },
    );
    expect(notification.message).toContain("ff-notification-e2e");
    const failures = JSON.parse(
      await evalBackground(
        `api.logs().then((log) => JSON.stringify(log.slice(${beforeLog}).filter((e) => e.message === "notification create failed")))`,
      ),
    );
    expect(failures).toEqual([]);
  } finally {
    await evalBackground(`browser.notifications.getAll()
      .then((rows) => Promise.all(Object.keys(rows).map((id) => browser.notifications.clear(id))))
      .then(() => browser.storage.local.set({ notifyOnSuccess: false }))
      .then(() => browser.storage.local.remove("notifyDuration"))
      .then(() => api.reset())
      .then(() => "restored")`);
  }
});

test("options reset re-initialises", async () => {
  const reset = await evalBackground(`api.reset().then(() => "reset-ok")`);
  expect(reset).toBe("reset-ok");
});

test("downloads receive the configured Referer header", async () => {
  /** @type {Array<{method: string, referer: string}>} */
  const receivedRequests = [];
  const body = "firefox referer protected content";
  const expectedHash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  const server = http.createServer((req, res) => {
    receivedRequests.push({ method: req.method || "", referer: req.headers.referer || "" });
    if (req.headers.referer !== referer) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("missing referer");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/webp" });
    res.end(body);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/referer-probe.txt`;
  const referer = "http://referrer.example/download-test";
  const previous = JSON.parse(
    await evalBackground(`Promise.all([
      api.getOption("setRefererHeader"),
      api.getOption("setRefererHeaderFilter"),
    ]).then(([setRefererHeader, setRefererHeaderFilter]) =>
      JSON.stringify({ setRefererHeader, setRefererHeaderFilter }))`),
  );

  try {
    await evalBackground(`api.setOptions({
        setRefererHeader: true,
        setRefererHeaderFilter: "*://127.0.0.1/*",
      }).then(() => api.startDownload({
        url: ${JSON.stringify(url)},
        pageUrl: ${JSON.stringify(referer)},
        path: "e2e/referer-protected-firefox-:mimeext:-:sha256:.txt",
        suggestedFilename: "referer-probe-firefox.txt",
      }))`);
    const rows = await waitForDownloads("referer-protected-firefox");
    const done = rows.find((/** @type {any} */ row) => row.state === "complete");
    expect(done).toBeTruthy();
    expect(receivedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
    expect(receivedRequests.every(({ referer: observed }) => observed === referer)).toBe(true);
    expect(done.filename).toContain(`referer-protected-firefox-webp-${expectedHash}`);
    expect(fs.readFileSync(done.filename, "utf8")).toBe(body);
    const remainingRules = JSON.parse(
      await evalBackground(
        `browser.declarativeNetRequest.getSessionRules().then((rules) => JSON.stringify(rules.map((rule) => rule.id)))`,
      ),
    );
    expect(remainingRules).not.toContain(66_000_001);
  } finally {
    try {
      await evalBackground(`api.setOptions(${JSON.stringify(previous)})`);
    } finally {
      await closeLocal(server);
    }
  }
});

test("message-driven downloads work and never inherit a stale route", async () => {
  // Establish the stale-state precondition locally so this regression remains
  // meaningful when the test is isolated or reordered.
  const staleRoute = "filename: routeme\ninto: stale-message/renamed-:filename:";
  await evalBackground(
    `browser.storage.local.set({
      filenamePatterns: ${JSON.stringify(staleRoute)},
    }).then(() => api.reset()).then(() => "stale route loaded")`,
  );

  await evalBackground(
    `api.downloadMessage({
        content: "ff message download",
        info: {
          pageUrl: "https://example.com/",
          srcUrl: "https://example.com/src.png",
          suggestedFilename: "ff-msg-download.txt",
        },
        sender: { tab: { id: 1, title: "E2E Tab" } },
      }).then(() => "started")`,
  );
  const downloads = await waitForDownloads("ff-msg-download");
  expect(downloads).toHaveLength(1);
  expect(downloads.map((/** @type {any} */ x) => x.state)).toEqual(["complete"]);
  expect(downloads[0].filename).toMatch(/ff-msg-download\.txt$/);
  expect(downloads[0].filename).not.toMatch(/stale-message/);
});

test("a separately installed extension negotiates, authorizes, and routes a download", async () => {
  const callerId = "save-in-e2e-caller@example.invalid";
  const root = await session.rdp.getRoot();
  await session.rdp.installTemporaryAddon(
    root.addonsActor,
    path.resolve("test", "e2e", "fixtures", "external-caller"),
  );
  const callerActor = await session.rdp.findAddonActor(callerId);
  const callerConsole = await session.rdp.getConsoleActor(callerActor);

  await runExternalExtensionScenario({
    evaluate: evalBackground,
    sendExternal: (message) =>
      session.rdp
        .evaluate(
          callerConsole,
          `browser.runtime.sendMessage(
            "{72d92df5-2aa0-4b06-b807-aa21767545cd}",
            ${JSON.stringify(message)}
          ).then((response) => JSON.stringify(response))`,
        )
        .then(JSON.parse),
    callerId,
    waitForDownloads,
    filename: "external-firefox.bin",
  });
});

test("ordinary browser downloads can be tracked and experimentally rerouted on Firefox", async () => {
  /** @type {import("node:http").ServerResponse | undefined} */
  let heldNativeResponse;
  let nativeRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/native-ff.bin") {
      nativeRequests += 1;
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="native-ff.bin"',
      });
      // Keep the browser-owned request in flight until Firefox's experimental
      // route cancels it. The routed replacement is the second request.
      if (nativeRequests === 1) {
        heldNativeResponse = res;
        res.write("ordinary firefox download");
        return;
      }
      res.end("ordinary firefox download");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<a id="native" href="/native-ff.bin">download</a>');
  });
  const port = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${port}/`;
  const target = `127.0.0.1:${port}`;

  try {
    await evalBackground(`browser.storage.local.set({
      trackBrowserDownloads: true,
      routeBrowserDownloadsFirefox: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      filenamePatterns: "mime: ^application/octet-stream$\\nreferrerdomain: ^127\\.0\\.0\\.1$\\ninto: browser-routed/:filename:",
    }).then(() => api.reset())`);
    await evalBackground(`browser.tabs.create({ url: ${JSON.stringify(pageUrl)} })`);
    await evalBackground(waitForTabExpression(target));
    await session.evaluateInTab(target, `document.querySelector("#native").click()`);

    const rows = await waitForDownloads("browser-routed");
    expect(rows.some((/** @type {any} */ row) => row.state === "complete")).toBe(true);
    expect(rows.some((/** @type {any} */ row) => row.filename.includes("browser-routed"))).toBe(
      true,
    );
    const observed = JSON.parse(
      await evalBackground(
        waitForApiEntriesExpression(
          "history",
          `(entry) => entry.info?.context === "browser" && entry.status === "complete"`,
        ),
      ),
    );
    expect(observed.at(-1)).toMatchObject({ status: "complete", info: { context: "browser" } });
  } finally {
    heldNativeResponse?.destroy();
    await evalBackground(`browser.storage.local.set({
      trackBrowserDownloads: false,
      routeBrowserDownloadsFirefox: false,
      browserDownloadFilter: "",
      filenamePatterns: "",
    }).then(() => api.reset())`);
    await closeLocal(server);
  }
});

test("click-to-save rejects synthetic input and accepts a trusted alt+click", async () => {
  const { server, port } = await startPageServer();
  const pageUrl = `http://127.0.0.1:${port}/`;
  const targetUrl = `127.0.0.1:${port}`;
  const previousContentClickToSave = await evalBackground(`api.getOption("contentClickToSave")`);
  const previousContentClickToSaveCombo = await evalBackground(
    `api.getOption("contentClickToSaveCombo")`,
  );

  try {
    // Enable click-to-save and reinitialise so the content script picks it up
    await evalBackground(
      `browser.storage.local.set({ contentClickToSave: true, contentClickToSaveCombo: 18 })
        .then(() => api.reset())
        .then(() => "enabled")`,
    );

    await evalBackground(
      `browser.tabs.create({ url: ${JSON.stringify(pageUrl)} }).then(() => "opened")`,
    );
    await evalBackground(waitForTabExpression(targetUrl));

    await session.evaluateInTab(
      targetUrl,
      `(() => {
        const alt = new KeyboardEvent("keydown", { keyCode: 18, bubbles: true });
        window.dispatchEvent(alt);
        const img = document.getElementById("img");
        img.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1 }));
        return "clicked";
      })()`,
    );

    const downloads = JSON.parse(
      await evalBackground(
        `browser.downloads.search({}).then((items) => JSON.stringify(items
          .filter((item) => item.url === ${JSON.stringify(`${pageUrl}pic.png`)})))`,
      ),
    );
    expect(downloads).toHaveLength(0);

    await evalBackground(`browser.tabs.query({}).then((tabs) => {
      const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(targetUrl)}));
      if (tab?.id == null) throw new Error("click-to-save fixture tab missing");
      return browser.tabs.update(tab.id, { active: true });
    })`);
    const point = JSON.parse(
      await session.evaluateInTab(
        targetUrl,
        `(() => {
          const rect = document.getElementById("img").getBoundingClientRect();
          return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        })()`,
      ),
    );
    await session.bidi.altClick(targetUrl, point.x, point.y);

    const trustedDownloads = await waitForDownloads("pic.png");
    expect(trustedDownloads.some((/** @type {any} */ item) => item.state === "complete")).toBe(
      true,
    );
    expect(fs.readFileSync(trustedDownloads.at(-1).filename)).toEqual(PNG);
  } finally {
    try {
      await evalBackground(`browser.storage.local
        .set({
          contentClickToSave: ${JSON.stringify(previousContentClickToSave)},
          contentClickToSaveCombo: ${JSON.stringify(previousContentClickToSaveCombo)},
        })
        .then(() => browser.tabs.query({}))
        .then((tabs) => browser.tabs.remove(tabs
          .filter((tab) => tab.url?.includes(${JSON.stringify(targetUrl)}))
          .map((tab) => tab.id)
          .filter((id) => id != null)))
        .then(() => api.reset())`);
    } finally {
      await closeLocal(server);
    }
  }
});

test("automatic Page Sources routes initial and live matches and enforces the visit limit", async () => {
  const { server, port } = await startSourcePanelServer();
  const target = `localhost:${port}/automatic-sources`;
  const pageUrl = `http://${target}`;
  const previous = JSON.parse(
    await evalBackground(`browser.storage.local.get([
      "autoDownloadEnabled", "autoDownloadLive", "autoDownloadMaxPerPage", "filenamePatterns"
    ]).then((stored) => JSON.stringify(stored))`),
  );
  const automaticKeys = [
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
  ];
  const missingAutomaticKeys = automaticKeys.filter((key) => !(key in previous));

  try {
    await evalBackground(`browser.storage.local.set({
      autoDownloadEnabled: true,
      autoDownloadLive: true,
      autoDownloadMaxPerPage: 3,
      filenamePatterns: ${JSON.stringify(
        `url: .*
into: e2e/ordinary-should-not-match/

context: ^auto$
pageurl: ^http://localhost:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: \\.png$
into: e2e/automatic-firefox/:filename:`,
      )},
    }).then(() => api.reset()).then(() => "enabled")`);
    await evalBackground(`browser.tabs.create({ url: ${JSON.stringify(pageUrl)} })`);
    await evalBackground(waitForTabExpression(target));
    const initial = await poll(
      async () => {
        const rows = JSON.parse(
          await evalBackground(`browser.downloads.search({})
            .then((items) => JSON.stringify(items.filter((item) => item.filename.includes("automatic-firefox"))
              .map(({ state, filename, url }) => ({ state, filename, url }))))`),
        );
        return rows.filter((/** @type {any} */ row) => row.state === "complete").length === 2
          ? rows
          : null;
      },
      { timeoutMs: 10000, description: "initial Firefox automatic Page Sources downloads" },
    );
    expect(initial.filter((/** @type {any} */ row) => row.state === "complete")).toHaveLength(2);
    expect(
      initial.every(
        (/** @type {any} */ row) => !row.filename.includes("ordinary-should-not-match"),
      ),
    ).toBe(true);

    await session.evaluateInTab(
      target,
      `(() => {
        for (const name of ["late.png", "over-limit.png"]) {
          const image = document.createElement("img");
          image.src = "/" + name;
          document.body.append(image);
        }
        return true;
      })()`,
    );
    await waitForDownloadUrl(`http://localhost:${port}/late.png`);
    const rows = JSON.parse(
      await evalBackground(`browser.downloads.search({}).then((items) => JSON.stringify(items.filter(
        (item) => item.url === "http://localhost:${port}/over-limit.png"
      )))`),
    );
    expect(rows).toHaveLength(0);
  } finally {
    await evalBackground(`Promise.all([
      browser.storage.local.set(${JSON.stringify(previous)}),
      browser.storage.local.remove(${JSON.stringify(missingAutomaticKeys)}),
    ])
      .then(() => browser.tabs.query({}))
      .then((tabs) => browser.tabs.remove(tabs.filter((tab) =>
        tab.url?.includes(${JSON.stringify(target)})
      ).map((tab) => tab.id).filter((id) => id != null)))
      .then(() => api.reset())`);
    await closeLocal(server);
  }
});

test("Page Sources discovers, updates live, and restores across tabs", async () => {
  const { server, port } = await startSourcePanelServer();
  const firstMatch = `localhost:${port}/sources-one`;
  const secondMatch = `localhost:${port}/sources-two`;
  const firstTarget = `localhost:${port}`;
  const secondTarget = `localhost:${port}`;
  const firstUrl = `http://${firstMatch}`;
  const secondUrl = `http://${secondMatch}`;

  try {
    await evalBackground(`browser.storage.local.set({
      sourcePanelEnabled: true,
      sourcePanelLive: true,
      sourcePanelPreviews: false,
      sourcePanelBackgrounds: false,
      sourcePanelResourceHints: false,
      sourcePanelLinks: false,
    }).then(() => api.reset()).then(() => "enabled")`);
    await evalBackground(
      `browser.tabs.create({ url: ${JSON.stringify(firstUrl)} }).then(() => "opened")`,
    );
    await evalBackground(waitForTabExpression(firstMatch));
    await poll(
      async () => {
        try {
          return (await session.evaluateInTab(
            firstTarget,
            "document.readyState === 'complete'",
          )) === true
            ? true
            : null;
        } catch {
          return null;
        }
      },
      { description: "Firefox Page Sources fixture target" },
    );
    const [discoveryJson] = await Promise.all([
      session.evaluateInTab(
        firstTarget,
        appendImageAndWaitForSourceExpression("/late.png", "late.png", ["second.png", "first.png"]),
      ),
      evalBackground(`browser.tabs.query({}).then(async (tabs) => {
        const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(firstMatch)}));
        if (!tab?.id) throw new Error("Page Sources fixture tab missing");
        await browser.storage.session.set({ sourcePanelOpen: true });
        await browser.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
        return "opened";
      })`),
    ]);
    const discovery = JSON.parse(discoveryJson);
    expect(discovery.initial).toEqual(["second.png", "first.png"]);
    expect(discovery.current).toContain("late.png");

    await session.evaluateInTab(
      firstTarget,
      `(() => {
        const rows = [...document.querySelector("#save-in-source-panel").shadowRoot
          .querySelectorAll(".row")];
        const row = rows.find((candidate) => candidate.querySelector(".name")?.textContent === "first.png");
        row?.querySelector(".actions button:nth-child(2)")?.click();
        return Boolean(row);
      })()`,
    );
    expect(await waitForDownloadUrl(`http://localhost:${port}/first.png`)).toMatch(/first\.png$/);

    await evalBackground(`browser.tabs.query({}).then(async (tabs) => {
      const first = tabs.find((tab) => tab.url?.includes(${JSON.stringify(firstMatch)}));
      if (first?.id) await browser.tabs.remove(first.id);
      await browser.tabs.create({ url: ${JSON.stringify(secondUrl)}, active: true });
      return "opened";
    })`);
    await poll(
      async () => {
        try {
          return (await session.evaluateInTab(
            secondTarget,
            "!!document.querySelector('#save-in-source-panel')?.shadowRoot",
          )) === true
            ? true
            : null;
        } catch {
          return null;
        }
      },
      { description: "Firefox Page Sources restored on activated tab" },
    );
  } finally {
    await evalBackground(`Promise.all([
      browser.storage.session.set({ sourcePanelOpen: false }),
      browser.storage.local.set({ sourcePanelEnabled: false }),
      browser.tabs.query({}).then((tabs) => browser.tabs.remove(tabs.filter((tab) =>
        tab.url?.includes(${JSON.stringify(`:${port}/sources-`)})
      ).map((tab) => tab.id).filter((id) => id != null))),
    ]).then(() => api.reset()).then(() => "cleaned")`);
    await closeLocal(server);
  }
});

registerSharedBrowserCases({
  evaluate: evalBackground,
  evaluateOptions: evalOptions,
  waitForDownloads,
  waitForLog,
  downloadDir: () => session.downloadDir,
  browserLabel: "firefox",
  routingContent: "ff routed content",
  symlinkSupported: true,
  reloadOptions: reloadOptionsPage,
});

test("history and the debug log record a self-contained download", async () => {
  const before = JSON.parse(
    await evalBackground(
      `Promise.all([api.history(), api.logs()]).then(([history, log]) => JSON.stringify({
        history: history.length,
        log: log.length,
      }))`,
    ),
  );
  await evalBackground(`api.startDownload({
    content: "firefox history e2e content",
    suggestedFilename: "ff-history-e2e.txt",
    pageUrl: "https://example.com/",
  }).then(() => "started")`);
  await waitForDownloads("ff-history-e2e");

  const records = JSON.parse(
    await evalBackground(
      `Promise.all([api.history(), api.logs()]).then(([history, log]) => JSON.stringify({
        history: history.length,
        matchingHistory: history.filter((entry) => String(entry.finalFullPath).includes("ff-history-e2e")).length,
        matchingRequests: log.slice(${before.log}).filter((entry) =>
          entry.message === "download requested" && JSON.stringify(entry.data).includes("ff-history-e2e")
        ).length,
      }))`,
    ),
  );

  expect(records.history).toBeGreaterThan(before.history);
  expect(records.matchingHistory).toBe(1);
  expect(records.matchingRequests).toBe(1);
});
