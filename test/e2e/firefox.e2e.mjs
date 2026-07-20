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
import { createE2EControlClient, createRecoveringControlTransport } from "./control-client.mjs";
import { CONTROL_PAGE_PATH, CONTROL_READY_EXPRESSION } from "./control-target.mjs";
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
  arrayOf,
  beginResourceScope,
  closeLocal,
  createLazyPageEvaluator,
  decodeBoolean,
  decodeNumber,
  decodeRecord,
  decodeString,
  evaluateJson,
  listenLocal,
  objectOf,
  optional,
  parseJson,
  poll,
  requireValue,
  waitForPageCondition,
} from "./helpers.mjs";

/** @typedef {import("./control-protocol.mjs").DownloadEntry} DownloadEntry */

/** @type {Awaited<ReturnType<typeof firefox.launch>>} */
let session;
let suiteFailed = false;
/** @type {{invalidate: () => void, close: () => void, isSameRealm: (error: unknown) => Promise<boolean>, callFunction: (declaration: string, args?: unknown[], timeoutMs?: number) => Promise<unknown>, waitForFunction: (declaration: string, expected: unknown, timeoutMs?: number) => Promise<unknown>} | undefined} */
let controlRealm;
/** @type {import("./helpers.mjs").E2EResourceScope | undefined} */
let resourceScope;
/** @type {ReturnType<typeof createHarnessSession> | undefined} */
let harness;
const FIRST_INSTALL_TEST = "first install starts with a focused welcome";
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(process.env.E2E_ARTIFACT_DIR)
  : path.resolve("dist", "e2e-artifacts");

/** @param {string} expr @param {number} [timeoutMs] @returns {Promise<unknown>} */
const rawEvalOptions = (expr, timeoutMs) =>
  session.evaluateInTab("src/options/options.html", expr, timeoutMs);
/** @param {string} expr @param {number} [timeoutMs] @returns {Promise<unknown>} */
const evalBackground = (expr, timeoutMs) =>
  controlRealm
    ? controlRealm.callFunction(`() => (${inBackgroundContext(expr)})`, [], timeoutMs)
    : Promise.reject(new Error("Firefox E2E control realm was not initialized"));
const requestOptionsReload = async () => {
  const tabId = optional(decodeNumber)(
    await session.evaluate(
      `browser.tabs.query({}).then((tabs) => tabs.find((tab) =>
        tab.url?.startsWith(browser.runtime.getURL("src/options/options.html")))?.id)`,
    ),
  );
  if (tabId === undefined) {
    await session.evaluate(
      `browser.tabs.create({ url: browser.runtime.getURL("src/options/options.html") })`,
    );
  } else {
    await session.evaluate(`browser.tabs.reload(${JSON.stringify(tabId)})`);
  }
};
const recoverOptionsPage = async () => {
  await requestOptionsReload();
  await poll(
    async () =>
      (await rawEvalOptions(
        `document.readyState === "complete" &&
        Boolean(browser.runtime?.id) &&
        Boolean(document.querySelector("#autocomplete-paths")) &&
        document.querySelector("#paths")?.getAttribute("aria-busy") === "false" &&
        document.querySelector("#filenamePatterns")?.getAttribute("aria-busy") === "false"`,
        // Probe briefly: a stale console actor left by the reload has to fail
        // fast enough to refresh and retry within the poll rather than burning
        // the whole deadline on one 30s RDP timeout.
        2500,
      ))
        ? true
        : null,
    { description: "reloaded Firefox options page", ignoreErrors: true, timeoutMs: 15000 },
  );
};
const recoverControlPage = async () => {
  controlRealm?.invalidate();
  await session.ensureExtensionPage(CONTROL_PAGE_PATH, { active: false, reload: true });
  if (!controlRealm) throw new Error("Firefox E2E control realm was not initialized");
  await controlRealm.waitForFunction(`() => String(${CONTROL_READY_EXPRESSION})`, "true", 15000);
};
const control = createE2EControlClient({
  callFunction: createRecoveringControlTransport({
    callFunction: (functionDeclaration, args, timeoutMs) =>
      controlRealm
        ? controlRealm.callFunction(functionDeclaration, args, timeoutMs)
        : Promise.reject(new Error("Firefox E2E control realm was not initialized")),
    recover: recoverControlPage,
    canRetryOneShot: (error) => controlRealm?.isSameRealm(error) ?? false,
  }),
});
const reloadOptionsPage = async () => {
  // browser.tabs.reload resolves before Firefox replaces the page's BiDi
  // realm. Dispatching waitReady immediately can therefore attach its
  // observer to the document being destroyed; Firefox 140 leaves that call
  // alive until its timeout even though the replacement page is ready. The
  // RDP evaluator detects the stale console actor and follows the target
  // switch, so use the same recovery path for deliberate reloads.
  await recoverOptionsPage();
};
const optionsPage = createLazyPageEvaluator({
  evaluate: rawEvalOptions,
  prepare: recoverOptionsPage,
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
  /** @type {Record<string, unknown>} */
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
    const [inspect, logs, history, local, tabs] = await Promise.all([
      control.inspect(),
      control.logs.get(),
      control.history.get(),
      control.storage.local.get(),
      control.tabs.query(),
    ]);
    report.background = { inspect, logs, history, local, tabs };
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

/** @param {string} filenamePart @param {number} [deadlineMs] @returns {Promise<DownloadEntry[]>} */
const waitForDownloads = async (filenamePart, deadlineMs = 8000) =>
  control.downloads.wait({ filenameIncludes: filenamePart, timeoutMs: deadlineMs });

/** @param {string} url @returns {Promise<string>} */
const waitForDownloadUrl = async (url) => {
  const rows = await control.downloads.wait({ url });
  return path.basename(
    requireValue(rows.at(-1), `No completed download found for ${url}`).filename,
  );
};

/** @param {string} url @returns {Promise<string>} */
const downloadUsingBrowserFilename = async (url) => {
  await control.tabs.create({ url });
  return waitForDownloadUrl(url);
};

/** @param {number} baseline @param {string[]} messages @param {number} [deadlineMs] */
const waitForLog = async (baseline, messages, deadlineMs = 8000) =>
  control.logs.wait({ baseline, messages, timeoutMs: deadlineMs });

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

// Minimal but structurally valid PDF: header, one empty page object, xref, EOF.
const SOURCE_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

const startSourcePanelServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
      res.end(PNG);
      return;
    }
    if (req.url?.endsWith(".pdf")) {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": SOURCE_PDF.length,
      });
      res.end(SOURCE_PDF);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    // The linked doc.pdf and the phase-b-background CSS background image are
    // only adopted by the automatic scan when a test explicitly turns on
    // autoDownloadDocuments/autoDownloadBackgrounds — every other case here
    // leaves both content options off, so they add no candidates.
    // A dedicated /automatic-data-sources page carries an inline data: image so
    // the phase-C scan can adopt it without perturbing the shared page's
    // discovered image set (asserted exactly by the panel discovery test).
    const inlineDataImage = req.url?.includes("data-sources")
      ? `<img id="phase-c-data" src="data:image/png;base64,${PNG.toString("base64")}" alt="inline">`
      : "";
    res.end(`<!doctype html><title>Page Sources e2e</title>
      <img src="/first.png" alt="first"><img src="/second.png" alt="second">
      <a href="/doc.pdf">document</a>
      <div id="phase-b-background" style="width:10px;height:10px;background-image:url('/bg.png')"></div>
      ${inlineDataImage}`);
  });
  const port = await listenLocal(server);
  return { server, port };
};

beforeAll(async () => {
  try {
    session = await firefox.launch();
    controlRealm = session.bidi.createPersistentRealm(CONTROL_PAGE_PATH);
    await recoverControlPage();
    // Native notifications are exercised by one focused test below. Keep the
    // rest of the download-heavy suite from submitting Windows toasts.
    await control.options.set({
      notifyOnSuccess: false,
      notifyOnFailure: false,
      notifyOnRuleMatch: false,
      notifyOnLinkPreferred: false,
    });
    harness = createHarnessSession({
      control,
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
  controlRealm?.close();
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
    suiteFailed = true;
    if (task.result?.state !== "fail") {
      try {
        await captureFailureArtifacts(`${task.name} cleanup`, task.result?.duration);
      } catch (error) {
        process.stderr.write(
          `Unable to capture Firefox cleanup failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
        );
      }
    }
    throw new AggregateError(cleanupErrors, "Firefox E2E case cleanup failed");
  }
});

test("first install starts with a focused welcome", async () => {
  await waitForPageCondition(
    evalOptions,
    `browser.storage.local.get("welcomePendingVersion").then((stored) =>
      document.querySelector("#welcome-dialog")?.open === true &&
      document.activeElement === document.querySelector(".welcome-accept") &&
      stored.welcomePendingVersion === 1)`,
    { description: "Firefox first-install welcome dialog" },
  );
  const welcome = requireValue(
    await evaluateJson(
      evalOptions,
      `browser.storage.local.get("welcomePendingVersion").then((stored) =>
          JSON.stringify({
            open: document.querySelector("#welcome-dialog")?.open === true,
            focused: document.activeElement === document.querySelector(".welcome-accept"),
            pending: stored.welcomePendingVersion,
          }))`,
      objectOf({
        open: decodeBoolean,
        focused: decodeBoolean,
        pending: optional(decodeNumber),
      }),
    ),
    "Firefox first-install welcome dialog was not observed",
  );
  expect(welcome.pending).toBe(1);

  await evalOptions(`document.querySelector(".welcome-accept").click()`);
  await waitForPageCondition(
    evalOptions,
    `browser.storage.local.get("welcomePendingVersion").then((stored) =>
      !document.querySelector("#welcome-dialog") && stored.welcomePendingVersion === undefined)`,
    { description: "Firefox welcome dismissal" },
  );
});

test("background event page initialises cleanly", async () => {
  const state = await control.inspect();

  expect(state.browser).toBe("FIREFOX");
  expect(state.capabilities).toMatchObject({
    tabContextMenus: true,
    downloadFilenameSuggestion: false,
    downloadDeltaFilename: false,
    conflictActionPrompt: false,
    downloadRequestHeaders: true,
    notificationButtons: false,
    shortcutFileExtensions: false,
  });
  expect(state.promptConflictAction).toBe("uniquify");
  // Event pages keep a real DOM (unlike Chrome's service worker)...
  expect(state.hasObjectUrl).toBe(true);
  expect((await control.logs.get()).some((entry) => entry.message === "init failed")).toBe(false);
});

test("structured control restores its missing dedicated target", async () => {
  await session.bidi.closeContext(CONTROL_PAGE_PATH);

  expect(await control.runtime.ready()).toEqual({ type: "OK" });
  expect(await controlRealm?.callFunction(`() => String(${CONTROL_READY_EXPRESSION})`)).toBe(
    "true",
  );
});

test("options page autosaves through Firefox host APIs", async () => {
  const original = await control.options.get("promptOnShift");
  const changed = !original;
  try {
    await waitForPageCondition(
      evalOptions,
      `(() => {
        const checkbox = document.querySelector("#promptOnShift");
        return document.readyState === "complete" && checkbox && !checkbox.disabled;
      })()`,
      { description: "Firefox options controls" },
    );
    // restoreOptions() runs last in the options init and is async, so on a slow
    // runner the checkbox can be enabled before init settles: a lone change then
    // fires before its autosave listener is wired, or the still-in-flight
    // restore resets the box under it. A checkbox autosaves immediately, so once
    // wiring and restore have settled a single dispatch sticks — re-dispatch,
    // pacing on the event-driven storage wait rather than a timer, until it does.
    const dispatchToggle = () =>
      evalOptions(
        `(() => {
          const checkbox = document.querySelector("#promptOnShift");
          checkbox.checked = ${JSON.stringify(changed)};
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`,
      );
    let stored;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dispatchToggle();
      stored = await control.storage.local
        .wait("promptOnShift", changed, 2500)
        .catch(() => undefined);
      if (stored === changed) break;
    }
    const state = { stored, live: await control.options.get("promptOnShift") };
    expect(state).toEqual({ stored: changed, live: changed });
  } finally {
    await control.options.set({ promptOnShift: original });
  }
});

test("event-page reload hydrates persisted options before replying", async () => {
  const original = await control.options.get("promptOnShift");
  const persisted = !original;
  try {
    await control.storage.local.set({ promptOnShift: persisted });
    await session.reloadBackgroundPage();
    expect(await control.options.get("promptOnShift")).toBe(persisted);
  } finally {
    await control.options
      .set({ promptOnShift: original })
      .catch(() => control.storage.local.set({ promptOnShift: original }).catch(() => {}));
  }
});

test("event-page cold start removes a stale Referer session rule", async () => {
  await control.dnr.updateSessionRules({
    removeRuleIds: [66000001],
    addRules: [
      {
        id: 66000001,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "Referer",
              operation: "set",
              value: "https://stale.example/",
            },
          ],
        },
        condition: {
          urlFilter: "|http://127.0.0.1/",
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });
  await session.reloadBackgroundPage();
  const remaining = (await control.dnr.getSessionRules()).map((rule) => rule.id);
  expect(remaining).not.toContain(66_000_001);
});

test("event-page cold start recovers an interrupted in-flight fetch", async () => {
  await runInterruptedTransferRecoveryScenario({
    control,
    evaluate: evalBackground,
    restartBackground: () => session.reloadBackgroundPage(),
    filename: "interrupted-firefox.bin",
  });
});

test("download completes through the real pipeline", async () => {
  await control.background.startDownload({
    content: "firefox e2e content",
    suggestedFilename: "ff-smoke.txt",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("ff-smoke");

  expect(downloads).toHaveLength(1);
  const completed = requireValue(downloads[0], "Firefox smoke download was not captured");
  expect(completed.state).toBe("complete");
  expect(fs.readFileSync(completed.filename, "utf8")).toBe("firefox e2e content");
});

test("private context-menu saves leave no extension history or session state", async () => {
  const privateWindow = await control.windows.create({ incognito: true, url: "about:blank" });
  try {
    await runPrivateContextScenario({
      control,
      waitForDownloads: async (filename) => {
        const privatePath = path.join(session.downloadDir, "e2e", "private", `${filename}.txt`);
        await poll(
          () => (fs.existsSync(privatePath) && fs.statSync(privatePath).size > 0 ? true : null),
          {
            description: "Firefox private download file",
          },
        );
        return [{ state: "complete", filename: privatePath }];
      },
      filename: "private-firefox",
    });
  } finally {
    await control.windows.remove(privateWindow.id);
  }
});

test("real Private Browsing activity stays out of routing, history, and automatic saves until opted in", async () => {
  await runPrivateBrowserActivityScenario({
    control,
    openPrivatePage: async (url) => {
      const opened = await control.windows.create({ incognito: true, url });
      const tab = await control.tabs.wait({ urlIncludes: "/private-browser" });
      const tabId = requireValue(tab.id, "Private Firefox tab has no id");
      const tabUrl = requireValue(tab.url, "Private Firefox tab has no URL");
      return {
        tabId,
        target: `127.0.0.1:${new URL(tabUrl).port}/private-browser`,
        close: async () => {
          await control.windows.remove(opened.id);
        },
      };
    },
    evaluatePrivatePage: (target, expression, timeoutMs) =>
      session.evaluateInTab(target, expression, timeoutMs),
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
    control,
    downloadUsingBrowserFilename,
    waitForDownloadUrl,
  });
});

test("success notifications are created by the real download listener", async () => {
  try {
    await control.background.notificationCalls("reset");
    await Promise.all(
      Object.keys(await control.notifications.getAll()).map((id) =>
        control.notifications.clear(id),
      ),
    );
    await control.options.set({ notifyOnSuccess: true, notifyDuration: 0 });
    const beforeLog = (await control.logs.get()).length;

    await control.background.startDownload({
      content: "firefox notification content",
      suggestedFilename: "ff-notification-e2e.txt",
      pageUrl: "https://example.com/",
    });
    const downloads = await waitForDownloads("ff-notification-e2e");
    const download = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Firefox notification download did not complete",
    );
    expect(download.id).toEqual(expect.any(Number));
    const notificationId = String(download.id);

    const notification = await control.background.waitForNotification(notificationId);
    if (!notification) throw new Error("Success notification call was not captured");
    expect(notification.message).toContain("ff-notification-e2e");
    const failures = (await control.logs.get())
      .slice(beforeLog)
      .filter((entry) => entry.message === "notification create failed");
    expect(failures).toEqual([]);
  } finally {
    await Promise.all(
      Object.keys(await control.notifications.getAll()).map((id) =>
        control.notifications.clear(id),
      ),
    );
    await control.storage.local.set({ notifyOnSuccess: false });
    await control.storage.local.remove("notifyDuration");
    await control.runtime.reset();
  }
});

test("options reset re-initialises", async () => {
  expect(await control.runtime.reset()).toEqual({
    type: "OK",
    body: { instanceId: expect.any(String), generation: expect.any(Number) },
  });
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
  const previous = {
    setRefererHeader: await control.options.get("setRefererHeader"),
    setRefererHeaderFilter: await control.options.get("setRefererHeaderFilter"),
  };

  try {
    await control.options.set({
      setRefererHeader: true,
      setRefererHeaderFilter: "*://127.0.0.1/*",
    });
    await control.background.startDownload({
      url,
      pageUrl: referer,
      path: "e2e/referer-protected-firefox-:mimeext:-:sha256:.txt",
      suggestedFilename: "referer-probe-firefox.txt",
    });
    const rows = await waitForDownloads("referer-protected-firefox");
    const done = requireValue(
      rows.find((row) => row.state === "complete"),
      "Referer-protected Firefox download did not complete",
    );
    expect(receivedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
    expect(receivedRequests.every(({ referer: observed }) => observed === referer)).toBe(true);
    expect(done.filename).toContain(`referer-protected-firefox-webp-${expectedHash}`);
    expect(fs.readFileSync(done.filename, "utf8")).toBe(body);
    const remainingRules = (await control.dnr.getSessionRules()).map((rule) => rule.id);
    expect(remainingRules).not.toContain(66_000_001);
  } finally {
    try {
      await control.options.set(previous);
    } finally {
      await closeLocal(server);
    }
  }
});

test("message-driven downloads work and never inherit a stale route", async () => {
  // Establish the stale-state precondition locally so this regression remains
  // meaningful when the test is isolated or reordered.
  const staleRoute = "filename: routeme\ninto: stale-message/renamed-:filename:";
  await control.options.set({ filenamePatterns: staleRoute });

  const response = await control.background.downloadMessage("ff message download", {
    pageUrl: "https://example.com/",
    srcUrl: "https://example.com/src.png",
    suggestedFilename: "ff-msg-download.txt",
  });
  expect(response.body.status).toBe("OK");
  const downloads = await waitForDownloads("ff-msg-download");
  expect(downloads).toHaveLength(1);
  expect(downloads.map((x) => x.state)).toEqual(["complete"]);
  const completed = requireValue(downloads[0], "Firefox message download was not captured");
  expect(completed.filename).toMatch(/ff-msg-download\.txt$/);
  expect(completed.filename).not.toMatch(/stale-message/);
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
    control,
    sendExternal: (message) =>
      session.rdp
        .evaluate(
          callerConsole,
          `browser.runtime.sendMessage(
            "{72d92df5-2aa0-4b06-b807-aa21767545cd}",
            ${JSON.stringify(message)}
          ).then((response) => JSON.stringify(response))`,
        )
        .then((value) => parseJson(value, decodeRecord)),
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
    await control.options.set({
      trackBrowserDownloads: true,
      routeBrowserDownloadsFirefox: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      filenamePatterns:
        "mime: ^application/octet-stream$\nreferrerdomain: ^127\\.0\\.0\\.1$\ninto: browser-routed/:filename:",
    });
    const created = await control.tabs.create({ url: pageUrl });
    await control.tabs.wait(
      created.id === undefined ? { urlIncludes: target } : { id: created.id },
    );
    await session.evaluateInTab(target, `document.querySelector("#native").click()`);

    const rows = await waitForDownloads("browser-routed");
    expect(rows.some((row) => row.state === "complete")).toBe(true);
    expect(rows.some((row) => row.filename.includes("browser-routed"))).toBe(true);
    const observed = await control.history.wait({ context: "browser", status: "complete" });
    expect(observed.at(-1)).toMatchObject({ status: "complete", info: { context: "browser" } });
  } finally {
    heldNativeResponse?.destroy();
    await control.options.set({
      trackBrowserDownloads: false,
      routeBrowserDownloadsFirefox: false,
      browserDownloadFilter: "",
      filenamePatterns: "",
    });
    await closeLocal(server);
  }
});

test("click-to-save rejects synthetic input and handles trusted single and double clicks", async () => {
  const { server, port } = await startPageServer();
  const pageUrl = `http://127.0.0.1:${port}/`;
  const targetUrl = `127.0.0.1:${port}`;
  const previousContentClickToSave = await control.options.get("contentClickToSave");
  const previousContentClickToSaveCombo = await control.options.get("contentClickToSaveCombo");
  const previousContentClickToSaveBindings = await control.options.get(
    "contentClickToSaveBindings",
  );
  const previousFilenamePatterns = (await control.storage.local.get("filenamePatterns"))
    .filenamePatterns;

  try {
    // Enable click-to-save and reinitialise so the content script picks it up
    await control.options.set({
      contentClickToSave: true,
      contentClickToSaveBindings: "",
      contentClickToSaveCombo: 18,
    });

    const created = await control.tabs.create({ url: pageUrl });
    if (created.id !== undefined) await control.tabs.wait({ id: created.id });

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

    const downloads = (await control.downloads.search()).filter(
      (item) => item.url === `${pageUrl}pic.png`,
    );
    expect(downloads).toHaveLength(0);

    const fixtureTab = (await control.tabs.query()).find((candidate) =>
      candidate.url?.includes(targetUrl),
    );
    const fixtureTabId = requireValue(fixtureTab?.id, "click-to-save fixture tab missing");
    await control.tabs.update(fixtureTabId, { active: true });
    const point = parseJson(
      await session.evaluateInTab(
        targetUrl,
        `(() => {
          const rect = document.getElementById("img").getBoundingClientRect();
          return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        })()`,
      ),
      objectOf({ x: decodeNumber, y: decodeNumber }),
    );
    await session.bidi.altClick(targetUrl, point.x, point.y);

    const trustedDownloads = await waitForDownloads("pic.png");
    expect(trustedDownloads.some((item) => item.state === "complete")).toBe(true);
    const trusted = requireValue(trustedDownloads.at(-1), "Trusted Firefox download was missing");
    expect(fs.readFileSync(trusted.filename)).toEqual(PNG);

    const doubleClickConfig = {
      contentClickToSaveBindings: JSON.stringify({
        version: 1,
        bindings: [{ gesture: "double-left-click", combo: "" }],
      }),
      filenamePatterns:
        "context: ^click$\ngesture: ^double-left-click$\ninto: e2e/double-click/:filename:",
    };
    const appliedDoubleClick = await control.runtime.send({
      type: "APPLY_CONFIG",
      body: { config: doubleClickConfig },
    });
    expect(appliedDoubleClick.body.applied).toMatchObject(doubleClickConfig);
    await session.evaluateInTab(
      targetUrl,
      `(() => {
        window.__saveInDoubleClickEvents = [];
        for (const type of ["mousedown", "click", "dblclick"]) {
          window.addEventListener(type, (event) => {
            window.__saveInDoubleClickEvents.push({ type, detail: event.detail, button: event.button });
          }, true);
        }
        return true;
      })()`,
    );
    await session.bidi.doubleClick(targetUrl, point.x, point.y);
    const doubleClickEvents = parseJson(
      await session.evaluateInTab(targetUrl, "JSON.stringify(window.__saveInDoubleClickEvents)"),
      arrayOf(objectOf({ type: decodeString, detail: decodeNumber, button: decodeNumber })),
    );
    expect(doubleClickEvents).toEqual([
      { type: "mousedown", detail: 1, button: 0 },
      { type: "click", detail: 1, button: 0 },
    ]);
    const doubleClickDownloads = await waitForDownloads("double-click");
    expect(doubleClickDownloads).toHaveLength(1);
    expect(doubleClickDownloads[0]?.state).toBe("complete");
    expect(fs.readFileSync(requireValue(doubleClickDownloads[0]?.filename, "path"))).toEqual(PNG);
  } finally {
    try {
      await control.options.set({
        contentClickToSave: previousContentClickToSave,
        contentClickToSaveBindings: previousContentClickToSaveBindings,
        contentClickToSaveCombo: previousContentClickToSaveCombo,
        filenamePatterns:
          typeof previousFilenamePatterns === "string" ? previousFilenamePatterns : "",
      });
      const fixtureIds = (await control.tabs.query())
        .filter((tab) => tab.url?.includes(targetUrl))
        .flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
      if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    } finally {
      await closeLocal(server);
    }
  }
});

test("automatic Page Sources routes initial and live matches and enforces the visit limit", async () => {
  const { server, port } = await startSourcePanelServer();
  const target = `localhost:${port}/automatic-sources`;
  const pageUrl = `http://${target}`;
  const previous = await control.storage.local.get([
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
  ]);
  const automaticKeys = [
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
  ];
  const missingAutomaticKeys = automaticKeys.filter((key) => !(key in previous));

  try {
    await control.options.set({
      autoDownloadEnabled: true,
      autoDownloadLive: true,
      autoDownloadMaxPerPage: 3,
      filenamePatterns: `url: .*
into: e2e/ordinary-should-not-match/

context: ^auto$
pageurl: ^http://localhost:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: \\.png$
into: e2e/automatic-firefox/:filename:`,
    });
    const created = await control.tabs.create({ url: pageUrl });
    await control.tabs.wait(
      created.id === undefined ? { urlIncludes: target } : { id: created.id },
    );
    const completed = await control.downloads.wait({
      filenameIncludes: "automatic-firefox",
      minimumComplete: 2,
      timeoutMs: 10000,
    });
    expect(completed.filter((row) => row.state === "complete")).toHaveLength(2);
    expect(completed.every((row) => !row.filename.includes("ordinary-should-not-match"))).toBe(
      true,
    );

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
    const rows = (await control.downloads.search()).filter(
      (item) => item.url === `http://localhost:${port}/over-limit.png`,
    );
    expect(rows).toHaveLength(0);
  } finally {
    await Promise.all([
      control.storage.local.set(previous),
      control.storage.local.remove(missingAutomaticKeys),
    ]);
    const fixtureIds = (await control.tabs.query())
      .filter((tab) => tab.url?.includes(target))
      .map((tab) => tab.id)
      .filter((id) => id !== undefined);
    if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    await control.runtime.reset();
    await closeLocal(server);
  }
});

test("automatic scan phase B adopts a linked document and a background image only when their options are on", async () => {
  const { server, port } = await startSourcePanelServer();
  const target = `localhost:${port}/automatic-sources`;
  const pageUrl = `http://${target}`;
  const automaticKeys = [
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadDocuments",
    "autoDownloadBackgrounds",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
  ];
  const previous = await control.storage.local.get(automaticKeys);
  const missingAutomaticKeys = automaticKeys.filter((key) => !(key in previous));

  try {
    await control.options.set({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      autoDownloadDocuments: true,
      autoDownloadBackgrounds: true,
      autoDownloadMaxPerPage: 3,
      filenamePatterns: `context: ^auto$
pageurl: ^http://localhost:${port}/automatic-sources$
sourcekind: ^document$
sourceurl: doc\\.pdf$
into: e2e/automatic-phase-b-firefox/:filename:

context: ^auto$
pageurl: ^http://localhost:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: bg\\.png$
into: e2e/automatic-phase-b-firefox/:filename:`,
    });
    const created = await control.tabs.create({ url: pageUrl });
    await control.tabs.wait(
      created.id === undefined ? { urlIncludes: target } : { id: created.id },
    );
    const completed = await control.downloads.wait({
      filenameIncludes: "automatic-phase-b-firefox",
      minimumComplete: 2,
      timeoutMs: 10000,
    });
    expect(completed.filter((row) => row.state === "complete")).toHaveLength(2);
    expect(completed.some((row) => row.filename.endsWith("doc.pdf"))).toBe(true);
    expect(completed.some((row) => row.filename.endsWith("bg.png"))).toBe(true);
  } finally {
    await Promise.all([
      control.storage.local.set(previous),
      control.storage.local.remove(missingAutomaticKeys),
    ]);
    const fixtureIds = (await control.tabs.query())
      .filter((tab) => tab.url?.includes(target))
      .map((tab) => tab.id)
      .filter((id) => id !== undefined);
    if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    await control.runtime.reset();
    await closeLocal(server);
  }
});

test("automatic scan phase C adopts an inline data: image and names it by its parsed mediatype", async () => {
  const { server, port } = await startSourcePanelServer();
  const target = `localhost:${port}/automatic-data-sources`;
  const pageUrl = `http://${target}`;
  const automaticKeys = [
    "autoDownloadEnabled",
    "autoDownloadLive",
    "autoDownloadDataUrls",
    "autoDownloadMaxPerPage",
    "filenamePatterns",
  ];
  const previous = await control.storage.local.get(automaticKeys);
  const missingAutomaticKeys = automaticKeys.filter((key) => !(key in previous));

  try {
    await control.options.set({
      autoDownloadEnabled: true,
      autoDownloadLive: false,
      autoDownloadDataUrls: true,
      autoDownloadMaxPerPage: 3,
      // The inline data:image/png source has no path, so :mimeext: resolves from
      // the mediatype the background parses out of the data: URL header.
      filenamePatterns: `context: ^auto$
pageurl: ^http://localhost:${port}/automatic-data-sources$
sourcekind: ^image$
sourceurl: ^data:image/png
into: e2e/automatic-phase-c-firefox/inline.:mimeext:`,
    });
    const created = await control.tabs.create({ url: pageUrl });
    await control.tabs.wait(
      created.id === undefined ? { urlIncludes: target } : { id: created.id },
    );
    const completed = await control.downloads.wait({
      filenameIncludes: "automatic-phase-c-firefox",
      minimumComplete: 1,
      timeoutMs: 10000,
    });
    expect(completed.filter((row) => row.state === "complete")).toHaveLength(1);
    expect(completed.some((row) => row.filename.endsWith("inline.png"))).toBe(true);
  } finally {
    await Promise.all([
      control.storage.local.set(previous),
      control.storage.local.remove(missingAutomaticKeys),
    ]);
    const fixtureIds = (await control.tabs.query())
      .filter((tab) => tab.url?.includes(target))
      .map((tab) => tab.id)
      .filter((id) => id !== undefined);
    if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    await control.runtime.reset();
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
    await control.storage.local.set({
      sourcePanelEnabled: true,
      sourcePanelLive: true,
      sourcePanelPreviews: false,
      sourcePanelBackgrounds: false,
      sourcePanelResourceHints: false,
      sourcePanelLinks: false,
    });
    await control.runtime.reset();
    const created = await control.tabs.create({ url: firstUrl });
    await control.tabs.wait(
      created.id === undefined ? { urlIncludes: firstMatch } : { id: created.id },
    );
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
      (async () => {
        const tab = (await control.tabs.query()).find((candidate) =>
          candidate.url?.includes(firstMatch),
        );
        if (tab?.id === undefined) throw new Error("Page Sources fixture tab missing");
        await control.storage.session.set({ sourcePanelOpen: true });
        await control.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
      })(),
    ]);
    const discovery = parseJson(
      discoveryJson,
      objectOf({ initial: arrayOf(decodeString), current: arrayOf(decodeString) }),
    );
    expect(discovery.initial).toEqual(["second.png", "first.png"]);
    expect(discovery.current).toContain("late.png");

    await session.evaluateInTab(
      firstTarget,
      `(() => {
        const rows = [...document.querySelector("#save-in-source-panel").shadowRoot
          .querySelectorAll(".row")];
        const row = rows.find((candidate) => candidate.querySelector(".name")?.textContent === "first.png");
        row?.querySelector(".actions .primary-action")?.click();
        return Boolean(row);
      })()`,
    );
    expect(await waitForDownloadUrl(`http://localhost:${port}/first.png`)).toMatch(/first\.png$/);

    const first = (await control.tabs.query()).find((tab) => tab.url?.includes(firstMatch));
    if (first?.id !== undefined) await control.tabs.remove(first.id);
    const second = await control.tabs.create({ url: secondUrl, active: true });
    await control.tabs.wait(
      second.id === undefined ? { urlIncludes: secondMatch } : { id: second.id },
    );
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
    await Promise.all([
      control.storage.session.set({ sourcePanelOpen: false }),
      control.storage.local.set({ sourcePanelEnabled: false }),
    ]);
    const fixtureIds = (await control.tabs.query())
      .filter((tab) => tab.url?.includes(`:${port}/sources-`))
      .map((tab) => tab.id)
      .filter((id) => id !== undefined);
    if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    await control.runtime.reset();
    await closeLocal(server);
  }
});

registerSharedBrowserCases({
  control,
  evaluate: evalBackground,
  evaluateOptions: evalOptions,
  evaluatePage: (target, expression) => session.evaluateInTab(target, expression),
  waitForDownloads,
  waitForLog,
  downloadDir: () => session.downloadDir,
  browserLabel: "firefox",
  browserProcess: () => session?.proc,
  routingContent: "ff routed content",
  symlinkSupported: true,
  reloadOptions: reloadOptionsPage,
});

test("history and the debug log record a self-contained download", async () => {
  const [beforeHistory, beforeLog] = await Promise.all([control.history.get(), control.logs.get()]);
  await control.background.startDownload({
    content: "firefox history e2e content",
    suggestedFilename: "ff-history-e2e.txt",
    pageUrl: "https://example.com/",
  });
  await waitForDownloads("ff-history-e2e");

  const [history, log] = await Promise.all([control.history.get(), control.logs.get()]);
  const matchingHistory = history.filter((entry) =>
    String(entry.finalFullPath).includes("ff-history-e2e"),
  );
  const matchingRequests = log
    .slice(beforeLog.length)
    .filter(
      (entry) =>
        entry.message === "download requested" &&
        JSON.stringify(entry.data).includes("ff-history-e2e"),
    );

  expect(history.length).toBeGreaterThan(beforeHistory.length);
  expect(matchingHistory).toHaveLength(1);
  expect(matchingRequests).toHaveLength(1);
});
