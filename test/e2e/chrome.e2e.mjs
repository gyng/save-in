// Chrome MV3 end-to-end suite: launches an isolated Chrome, loads the
// staged unpacked build over CDP, and drives the real extension. Tests in
// this file are sequential but restore a steady-state baseline after each case.

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import cdp from "../../scripts/lib/cdp.js";
import chrome from "../../scripts/lib/chrome.js";
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
  nullable,
  objectOf,
  optional,
  parseJson,
  poll,
  requireValue,
  waitForPageCondition,
} from "./helpers.mjs";

/** @typedef {import("./control-protocol.mjs").DownloadEntry} DownloadEntry */

const PROFILE = path.join(chrome.ROOT, "dist", "e2e-profile");
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(chrome.ROOT, process.env.E2E_ARTIFACT_DIR)
  : path.join(chrome.ROOT, "dist", "e2e-artifacts");

/** @type {import("node:child_process").ChildProcess | undefined} */
let proc;
let extensionId = "";
let PORT = 0;
let DOWNLOADS = "";
let PROFILE_DIR = "";
let browserLogPath = "";
let browserPath = "";
let browserVersion = "";
let suiteFailed = false;
let incognitoAccessEnabled = false;
/** @type {ReturnType<typeof cdp.createPersistentTargetSession> | undefined} */
let controlTarget;
/** @type {import("./helpers.mjs").E2EResourceScope | undefined} */
let resourceScope;
/** @type {ReturnType<typeof createHarnessSession> | undefined} */
let harness;
const FIRST_INSTALL_TEST = "first install starts with a focused welcome";

/** @param {string} expr @param {number} [timeoutMs] */
const rawEvalOptions = (expr, timeoutMs) => cdp.evalInTarget(PORT, "options.html", expr, timeoutMs);
const reloadOptionsPage = async () => {
  // Repeated CDP attachments can leave an extension renderer listed but
  // unable to answer Runtime or Page commands. Closing it through the browser
  // target and creating a fresh Options page recovers that state; Page.reload
  // cannot, because it still depends on the wedged renderer.
  await cdp.replaceTab(
    PORT,
    "options.html",
    `chrome-extension://${extensionId}/src/options/options.html`,
  );
  await poll(
    async () =>
      (await rawEvalOptions(
        `document.readyState === "complete" &&
        Boolean(chrome.runtime?.id) &&
        Boolean(document.querySelector("#autocomplete-paths")) &&
        document.querySelector("#paths")?.getAttribute("aria-busy") === "false" &&
        document.querySelector("#filenamePatterns")?.getAttribute("aria-busy") === "false"`,
        2500,
      ))
        ? true
        : null,
    {
      description: "reloaded Chrome options page",
      ignoreErrors: true,
      timeoutMs: 15000,
    },
  );
};
const recoverControlPage = async () => {
  controlTarget?.invalidate();
  await cdp.replaceTab(
    PORT,
    CONTROL_PAGE_PATH,
    `chrome-extension://${extensionId}/${CONTROL_PAGE_PATH}`,
    { background: true },
  );
  await cdp.waitForTargetExpression(PORT, CONTROL_PAGE_PATH, CONTROL_READY_EXPRESSION, true);
};
const control = createE2EControlClient({
  callFunction: createRecoveringControlTransport({
    callFunction: (functionDeclaration, args, timeoutMs) =>
      controlTarget
        ? controlTarget.callFunction(functionDeclaration, args, timeoutMs)
        : Promise.reject(new Error("Chrome E2E control target was not initialized")),
    recover: recoverControlPage,
    canRetryOneShot: (error) => controlTarget?.isSameRealm(error) ?? false,
  }),
});
const optionsPage = createLazyPageEvaluator({
  evaluate: rawEvalOptions,
  prepare: reloadOptionsPage,
});
const evalOptions = optionsPage.evaluate;
// The options page injects its search box and fills the header version link
// during async init, and the tab order is unstable until both land: a test that
// touches the page too early races it — a null #option-search, or an empty
// #version-label whose zero size drops it from the tab order so the first Tab
// falls through to a nav disclosure summary. Wait for both, the late-wired
// pieces, as the "fully interactive" signal before interacting.
const waitForOptionsInteractive = () =>
  waitForPageCondition(
    evalOptions,
    `document.readyState === "complete" &&
     !document.querySelector("#welcome-dialog") &&
     Boolean(document.querySelector("#option-search")) &&
     Boolean(document.querySelector("#version-label")?.textContent)`,
    { description: "options page interactive" },
  );
// App control travels through production runtime messages from an extension
// page. Raw worker evaluation remains only for worker-specific assertions.
/** @param {string} expr @returns {Promise<unknown>} */
const evalSW = (expr) =>
  controlTarget
    ? controlTarget.evaluate(inBackgroundContext(expr))
    : Promise.reject(new Error("Chrome E2E control target was not initialized"));
/** @param {string} expr @returns {Promise<unknown>} */
const evalWorker = (expr) =>
  cdp.evalInServiceWorker(PORT, extensionId, expr, {
    wake: () =>
      controlTarget
        ? controlTarget.evaluate(
            "new Promise(resolve => chrome.runtime.sendMessage({type: 'WAKE_WARM'}, () => resolve('ok')))",
          )
        : Promise.reject(new Error("Chrome E2E control target was not initialized")),
  });
/** @param {string} key @param {unknown} expected @param {number} [timeoutMs] */
const localStorageValue = (key, expected, timeoutMs = 5000) => `new Promise((resolve, reject) => {
  const key = ${JSON.stringify(key)};
  const expected = ${JSON.stringify(expected)};
  const timeout = AbortSignal.timeout(${timeoutMs});
  let settled = false;
  const finish = (callback) => {
    if (settled) return;
    settled = true;
    chrome.storage.onChanged.removeListener(onChanged);
    timeout.removeEventListener("abort", onTimeout);
    callback();
  };
  const onChanged = (changes, area) => {
    if (area === "local" && Object.is(changes[key]?.newValue, expected)) {
      finish(() => resolve(expected));
    }
  };
  const onTimeout = () => finish(() => reject(new Error("Timed out waiting for storage key: " + key)));
  chrome.storage.onChanged.addListener(onChanged);
  timeout.addEventListener("abort", onTimeout, { once: true });
  chrome.storage.local.get(key).then((stored) => {
    if (Object.is(stored[key], expected)) finish(() => resolve(expected));
  }, (error) => finish(() => reject(error)));
})`;
/** @param {string} name */
const artifactName = (name) =>
  name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();

/** @param {string} testName @param {number | undefined} durationMs */
const captureFailureArtifacts = async (testName, durationMs) => {
  const prefix = path.join(ARTIFACTS, `chrome-failure-${artifactName(testName)}`);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  /** @type {Record<string, unknown>} */
  const report = {
    testName,
    durationMs,
    capturedAt: new Date().toISOString(),
    runId: process.env.E2E_RUN_ID,
    browser: { executable: browserPath, version: browserVersion },
  };
  try {
    report.targets = await cdp.listTargets(PORT);
    report.options = await evaluateJson(
      evalOptions,
      `JSON.stringify({
        url: location.href,
        title: document.title,
        active: document.activeElement?.outerHTML,
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      })`,
      decodeRecord,
    );
    fs.writeFileSync(
      `${prefix}.html`,
      decodeString(await evalOptions(`document.documentElement.outerHTML`)),
    );
    const [activeTab] = await control.tabs.query({ active: true, currentWindow: true });
    const activeUrl = activeTab?.url || "";
    report.activeUrl = activeUrl;
    if (activeUrl) {
      fs.writeFileSync(
        `${prefix}-active.png`,
        Buffer.from(await cdp.captureScreenshot(PORT, activeUrl), "base64"),
      );
    }
    fs.writeFileSync(
      `${prefix}.png`,
      Buffer.from(await cdp.captureScreenshot(PORT, "options.html"), "base64"),
    );
  } catch (error) {
    report.pageCaptureError = String(error);
  }
  try {
    const [inspect, logs, history, local, sessionState] = await Promise.all([
      control.inspect(),
      control.logs.get(),
      control.history.get(),
      control.storage.local.get(),
      control.storage.session.get(),
    ]);
    report.background = { inspect, logs, history, local, session: sessionState };
  } catch (error) {
    report.backgroundCaptureError = String(error);
  }
  report.browserLogTail = browserLogPath ? chrome.logTail(browserLogPath) : "";
  fs.writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2));
};

const SOURCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// Minimal but structurally valid PDF: header, one empty page object, xref, EOF.
const SOURCE_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

const startSourcePanelServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": SOURCE_PNG.length });
      res.end(SOURCE_PNG);
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
      ? `<img id="phase-c-data" src="data:image/png;base64,${SOURCE_PNG.toString("base64")}" alt="inline">`
      : "";
    res.end(`<!doctype html><title>Page Sources e2e</title>
      <img src="/first.png" alt="first"><img src="/second.png" alt="second">
      <a href="/doc.pdf">document</a>
      <div id="phase-b-background" style="width:10px;height:10px;background-image:url('/bg.png')"></div>
      ${inlineDataImage}`);
  });
  return { server, port: await listenLocal(server) };
};

/** @param {string} regex @param {number} [deadlineMs] @returns {Promise<DownloadEntry[]>} */
const waitForDownloads = async (regex, deadlineMs = 8000) =>
  control.downloads.wait({ filenameRegex: regex, timeoutMs: deadlineMs });

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

const ensureIncognitoAccess = async () => {
  if (incognitoAccessEnabled) return;
  // Chrome's CDP loader owns this ephemeral install, including its Incognito
  // grant. Reloading it closes the old extension-page control target.
  extensionId = await cdp.loadUnpacked(
    PORT,
    path.resolve(process.env.EXT_DIR || "dist/bundled-pkg"),
    { enableInIncognito: true },
  );
  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  await poll(
    async () =>
      (await evalOptions(
        `document.readyState === "complete" && chrome.runtime.id === ${JSON.stringify(extensionId)}`,
      )) === true
        ? true
        : null,
    { description: "Chrome extension reload after Incognito access change", ignoreErrors: true },
  );
  await control.runtime.ready();
  incognitoAccessEnabled = true;
};

beforeAll(async () => {
  try {
    const launched = await chrome.launch({
      profileDir: PROFILE,
      fresh: true,
    });
    ({
      proc,
      extensionId,
      port: PORT,
      profileDir: PROFILE_DIR,
      logPath: browserLogPath,
      browserPath,
      browserVersion,
    } = launched);
    DOWNLOADS = launched.downloadDir || path.join(PROFILE_DIR, "downloads");
    controlTarget = cdp.createPersistentTargetSession(PORT, CONTROL_PAGE_PATH);
    await poll(
      async () => {
        const state = await evaluateJson(
          rawEvalOptions,
          `JSON.stringify({
            ready: document.readyState,
            extensionId: globalThis.chrome?.runtime?.id,
            hasStorage: Boolean(globalThis.chrome?.storage?.local),
          })`,
          objectOf({
            ready: decodeString,
            extensionId: optional(decodeString),
            hasStorage: decodeBoolean,
          }),
        );
        if (state.ready !== "complete") return null;
        if (state.extensionId !== extensionId || !state.hasStorage) {
          throw new Error(
            `Extension APIs unavailable in options target: ${JSON.stringify({ expectedId: extensionId, ...state })}`,
          );
        }
        return true;
      },
      { description: "options page and extension APIs", ignoreErrors: true },
    );
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
      downloadDir: () => DOWNLOADS,
    });
  } catch (error) {
    suiteFailed = true;
    throw error;
  }
});

beforeEach(async ({ task }) => {
  resourceScope = beginResourceScope();
  if (task.name !== FIRST_INSTALL_TEST) optionsPage.invalidate();
  if (!harness) throw new Error("Chrome E2E harness was not initialized");
  await harness.beginCase();
});

afterAll(async () => {
  /** @type {unknown[]} */
  const failures = [];
  controlTarget?.close();
  try {
    await chrome.killTree(proc);
  } catch (error) {
    failures.push(error);
  }
  try {
    await chrome.removeProfile(PROFILE_DIR);
  } catch (error) {
    failures.push(error);
  }
  if (!suiteFailed && failures.length === 0 && browserLogPath) {
    fs.rmSync(browserLogPath, { force: true });
  }
  if (failures.length) throw new AggregateError(failures, "Chrome E2E cleanup failed");
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
        `Unable to capture Chrome failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
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
          `Unable to capture Chrome cleanup failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
        );
      }
    }
    throw new AggregateError(cleanupErrors, "Chrome E2E case cleanup failed");
  }
});

test("first install starts with a focused welcome", async () => {
  await waitForPageCondition(
    evalOptions,
    'document.querySelector("#welcome-dialog")?.open === true',
    { description: "first-install welcome dialog" },
  );
  const welcome = requireValue(
    await evaluateJson(
      evalOptions,
      `JSON.stringify({
          open: document.querySelector("#welcome-dialog")?.open === true,
          title: document.querySelector("#welcome-title")?.textContent,
          steps: [...document.querySelectorAll(".welcome-steps li")].map((item) => item.textContent),
          status: document.querySelector("#lastSavedAt")?.textContent,
        })`,
      objectOf({
        open: decodeBoolean,
        title: optional(decodeString),
        steps: arrayOf(decodeString),
        status: optional(decodeString),
      }),
    ),
    "First-install welcome dialog was not observed",
  );
  expect(welcome).toMatchObject({
    title: "Welcome to Save In",
    status: "Just now",
  });
  expect(welcome.steps).toHaveLength(3);

  await evalOptions(`document.querySelector(".welcome-permissions").click()`);
  await waitForPageCondition(
    evalOptions,
    `document.querySelector("#about-dialog")?.open === true &&
      document.querySelector("#welcome-dialog")?.open === true`,
    { description: "permission explanation over welcome" },
  );
  const permissions = requireValue(
    await evaluateJson(
      evalOptions,
      `chrome.storage.local.get("welcomePendingVersion").then((stored) =>
          JSON.stringify({
            aboutOpen: document.querySelector("#about-dialog")?.open === true,
            welcomeOpen: document.querySelector("#welcome-dialog")?.open === true,
            pending: stored.welcomePendingVersion,
          }))`,
      objectOf({
        aboutOpen: decodeBoolean,
        welcomeOpen: decodeBoolean,
        pending: optional(decodeNumber),
      }),
    ),
    "Permission explanation was not observed",
  );
  expect(permissions.pending).toBe(1);
  await evalOptions(`document.querySelector("#about-dialog .about-close").click()`);
  await waitForPageCondition(
    evalOptions,
    `document.querySelector("#welcome-dialog")?.open === true &&
      document.activeElement === document.querySelector(".welcome-permissions")`,
    { description: "welcome focus after permission explanation" },
  );

  await evalOptions(`document.querySelector(".welcome-accept").click()`);
  await waitForPageCondition(
    evalOptions,
    `browser.storage.local.get("welcomePendingVersion").then((stored) =>
      !document.querySelector("#welcome-dialog") && stored.welcomePendingVersion === undefined)`,
    { description: "welcome dismissal" },
  );
});

test("option search shows detailed locations and navigates indexed actions", async () => {
  await evalOptions(`document.querySelector(".welcome-accept")?.click()`);
  await waitForOptionsInteractive();
  const result = await evaluateJson(
    evalOptions,
    `JSON.stringify((() => {
      const input = document.querySelector("#option-search");
      input.value = "test webhook";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const option = document.querySelector("#option-search-results [role=option]");
      const location = option?.querySelector(".option-search-result-location");
      return {
        label: option?.querySelector(".option-search-result-label")?.textContent,
        location: location?.textContent,
        fullLocation: location?.title,
        inputWidth: input.getBoundingClientRect().width,
        resultsWidth: document.querySelector("#option-search-results").getBoundingClientRect().width,
      };
    })())`,
    objectOf({
      label: optional(decodeString),
      location: optional(decodeString),
      fullLocation: optional(decodeString),
      inputWidth: decodeNumber,
      resultsWidth: decodeNumber,
    }),
  );
  expect(result).toMatchObject({
    label: "Send test",
    location: "Advanced › External integrations › Webhooks",
    fullLocation: "Advanced › External integrations › Webhooks",
  });
  expect(result.resultsWidth).toBeGreaterThan(result.inputWidth);

  await evalOptions(`document.querySelector("#option-search-results [role=option]").click()`);
  await waitForPageCondition(
    evalOptions,
    `document.activeElement === document.querySelector("#webhookUrl") &&
      document.querySelector('[role=tab][aria-selected="true"]')?.textContent === "Advanced"`,
    { description: "search action navigation" },
  );
});

test("service worker initialises cleanly", async () => {
  const state = await control.inspect();

  expect(state.browser).toBe("CHROME");
  // Chrome gained tab-strip menus in 150; 123-149 stay supported and omit
  // them. Checking the detector against the version the runner actually
  // launched keeps both branches honest without restating its ContextType
  // probe, which would only compare the harness to itself.
  const chromeMajor = Number(/(\d+)\.\d/.exec(browserVersion)?.[1]);
  expect(Number.isSafeInteger(chromeMajor)).toBe(true);
  expect(state.capabilities.tabContextMenus).toBe(chromeMajor >= 150);
  expect(state.capabilities).toMatchObject({
    downloadFilenameSuggestion: true,
    downloadDeltaFilename: true,
    conflictActionPrompt: true,
    downloadRequestHeaders: false,
    notificationButtons: true,
    shortcutFileExtensions: true,
  });
  expect(state.promptConflictAction).toBe("prompt");
  // Reported by the real service worker, where the MV3 fallbacks exist because
  // there is no DOM to make an object URL with.
  expect(state.hasObjectUrl).toBe(false);
  expect((await control.logs.get()).some((entry) => entry.message === "init failed")).toBe(false);
});

test("structured control coalesces recovery for its missing dedicated target", async () => {
  await cdp.replaceTab(PORT, CONTROL_PAGE_PATH, "about:blank");

  const [ready, stored] = await Promise.all([
    control.runtime.ready(),
    control.storage.local.get("contentClickToSave"),
  ]);
  expect(ready).toEqual({ type: "OK" });
  expect(stored).toBeTypeOf("object");
  expect(await cdp.evalInTarget(PORT, CONTROL_PAGE_PATH, CONTROL_READY_EXPRESSION)).toBe(true);
});

test("options can select a generated locale and return to the browser default", async () => {
  const choices = await evaluateJson(
    evalOptions,
    `JSON.stringify([...document.querySelectorAll("#uiLocale option")].map((option) => option.value))`,
    arrayOf(decodeString),
  );
  expect(choices).toEqual(expect.arrayContaining(["", "en", "de"]));

  /** @param {string} locale @param {string} description */
  const selectLocale = async (locale, description) => {
    const marker = `${locale}-${Date.now()}-${Math.random()}`;
    await evalOptions(`(() => {
      globalThis.__saveInE2eLocaleMarker = ${JSON.stringify(marker)};
      const select = document.querySelector("#uiLocale");
      select.value = ${JSON.stringify(locale)};
      select.dispatchEvent(new InputEvent("input", { bubbles: true }));
    })()`);
    await poll(
      async () => {
        const state = await evaluateJson(
          evalOptions,
          `Promise.all([
            chrome.storage.local.get("uiLocale"),
            Promise.resolve({
              selected: document.querySelector("#uiLocale")?.value,
              marker: globalThis.__saveInE2eLocaleMarker ?? null,
            }),
          ]).then(([stored, page]) => JSON.stringify({ stored: stored.uiLocale, ...page }))`,
          objectOf({
            stored: decodeString,
            selected: optional(decodeString),
            marker: nullable(decodeString),
          }),
        );
        return state.stored === locale && state.selected === locale && state.marker !== marker
          ? true
          : null;
      },
      { description, ignoreErrors: true },
    );
  };

  await selectLocale("de", "generated locale selection reload");
  await selectLocale("en", "explicit English selection reload");
  await selectLocale("", "browser-default locale restore");
  await control.storage.local.remove("uiLocale");
  await waitForPageCondition(
    evalOptions,
    `chrome.storage.local.get("uiLocale").then((stored) =>
      !Object.hasOwn(stored, "uiLocale") && document.querySelector("#uiLocale")?.value === "")`,
    { description: "browser-default locale storage cleanup" },
  );
  await control.runtime.reset();
});

test("options page works under MV3 CSP with live first-party autocomplete", async () => {
  await waitForOptionsInteractive();
  await evalOptions(`document.querySelector("#paths-mode-text")?.click()`);
  await waitForPageCondition(
    evalOptions,
    `Boolean(document.querySelector("#paths") && !document.querySelector("#paths").hidden)`,
    { description: "paths text editor activation" },
  );
  await evalOptions(`(() => {
    const ta = document.querySelector("#paths");
    ta.focus();
    ta.value = ":d";
    ta.selectionStart = ta.selectionEnd = 2;
    ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
  })()`);
  await waitForPageCondition(
    evalOptions,
    `(() => {
      const dd = document.querySelector("#autocomplete-paths");
      return Boolean(dd && dd.style.display !== "none" && dd.textContent?.includes(":date:"));
    })()`,
    { description: "path variable autocomplete suggestions" },
  );
  const suggestions = (
    await evaluateJson(
      evalOptions,
      `(() => {
          const dd = document.querySelector("#autocomplete-paths");
          return JSON.stringify({
            open: Boolean(dd && dd.style.display !== "none"),
            text: dd?.textContent || "",
          });
        })()`,
      objectOf({ open: decodeBoolean, text: decodeString }),
    )
  ).text;
  const result = await evaluateJson(
    evalOptions,
    `(async () => {
      const ta = document.querySelector("#paths");
      ta.value = "";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return JSON.stringify({
        form: !!ta,
        hostPermissionGranted: await chrome.permissions.contains({ origins: ["<all_urls>"] }),
        permissionBannerHidden: document.querySelector("#host-permission-banner")?.hidden === true,
        refererHidden: document.querySelector("#setRefererHeader")?.closest("label")?.hidden === true,
        nativeBrowserRoutingHidden:
          document.querySelector("#routeBrowserDownloads")?.closest(".filename-suggestion-only")?.hidden === true,
        experimentalFirefoxRoutingHidden:
          document.querySelector("#routeBrowserDownloadsFirefox")?.closest(".firefox-reroute-only")?.hidden === true,
      });
    })()`,
    objectOf({
      form: decodeBoolean,
      hostPermissionGranted: decodeBoolean,
      permissionBannerHidden: decodeBoolean,
      refererHidden: decodeBoolean,
      nativeBrowserRoutingHidden: decodeBoolean,
      experimentalFirefoxRoutingHidden: decodeBoolean,
    }),
  );

  expect(result.form).toBe(true);
  expect(suggestions).toContain(":date:");
  expect(result.hostPermissionGranted).toBe(true);
  expect(result.permissionBannerHidden).toBe(true);
  expect(result.refererHidden).toBe(false);
  expect(result.nativeBrowserRoutingHidden).toBe(false);
  expect(result.experimentalFirefoxRoutingHidden).toBe(true);
});

test("options page keeps keyboard focus and core layout accessible", async () => {
  // Tab into a fully wired page, or the first stop can be a transient element
  // (a nav disclosure summary before the header link and search settle).
  await evalOptions(`document.querySelector(".welcome-accept")?.click(); true`);
  await waitForOptionsInteractive();
  await evalOptions(`(() => {
    document.activeElement?.blur();
    document.body.focus();
  })()`);
  await cdp.dispatchInput(PORT, "options.html", [
    {
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    },
    {
      method: "Input.dispatchKeyEvent",
      params: { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    },
  ]);

  // dispatchInput resolves when the CDP command is acknowledged, not when the
  // browser has processed the key and moved focus, and the options layout is
  // still reflowing during init. Read too soon on a slow runner and focus is
  // still BODY or the page is mid-reflow (a transient horizontal overflow).
  // Wait for both to settle before measuring, so the assertions see the settled
  // state; a layout that never settles still fails, here with its overflow named.
  await evalOptions(`new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(5000);
    const check = () => {
      const focusMoved = document.activeElement && document.activeElement !== document.body;
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      if (focusMoved && overflow <= 1) resolve(true);
      else if (timeout.aborted) {
        reject(new Error("options page did not settle after Tab: " +
          JSON.stringify({ focusMoved: Boolean(focusMoved), overflow })));
      } else requestAnimationFrame(check);
    };
    check();
  })`);

  const result = await evaluateJson(
    evalOptions,
    `JSON.stringify((() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      const active = document.activeElement;
      return {
        duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        unnamedButtons: [...document.querySelectorAll("button")]
          .filter(visible)
          .filter((button) => !(button.textContent?.trim() || button.getAttribute("aria-label") || button.title))
          .map((button) => button.outerHTML),
        active: {
          tag: active?.tagName,
          name: active?.textContent?.trim() || active?.getAttribute?.("aria-label") || active?.id,
          focusVisible: active?.matches?.(":focus-visible") || false,
          inViewport: active ? active.getBoundingClientRect().left >= 0 && active.getBoundingClientRect().right <= innerWidth : false,
        },
      };
    })())`,
    objectOf({
      duplicateIds: arrayOf(decodeString),
      horizontalOverflow: decodeNumber,
      unnamedButtons: arrayOf(decodeString),
      active: objectOf({
        tag: optional(decodeString),
        name: optional(decodeString),
        focusVisible: decodeBoolean,
        inViewport: decodeBoolean,
      }),
    }),
  );

  expect(result.duplicateIds).toEqual([]);
  expect(result.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(result.unnamedButtons).toEqual([]);
  expect(result.active.tag).toMatch(/^(A|BUTTON|INPUT|SELECT|SUMMARY|TEXTAREA)$/);
  expect(result.active.name).toBeTruthy();
  expect(result.active.focusVisible).toBe(true);
  expect(result.active.inViewport).toBe(true);

  try {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 768, height: 700 },
      { width: 480, height: 800 },
    ]) {
      await cdp.setViewport(PORT, "options.html", viewport.width, viewport.height);
      const overflow = decodeNumber(
        await evalOptions(
          `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
        ),
      );
      expect(overflow, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
    }
  } finally {
    await cdp.setViewport(PORT, "options.html", 1280, 800);
  }
});

test("WAKE_WARM prewarm round-trips", async () => {
  expect(await control.runtime.ready()).toEqual({ type: "OK" });
});

test("cold-start messages wait for persisted options", async () => {
  try {
    await control.options.set({ promptOnShift: false });
    expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);

    expect(await control.options.get("promptOnShift")).toBe(false);
  } finally {
    await control.options.set({ promptOnShift: true });
  }
});

test("cold start removes a stale Referer session rule", async () => {
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
  expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);
  await control.options.all();
  const remaining = (await control.dnr.getSessionRules()).map((rule) => rule.id);
  expect(remaining).not.toContain(66_000_001);
});

test("cold start recovers an interrupted in-flight fetch", async () => {
  await runInterruptedTransferRecoveryScenario({
    control,
    evaluate: evalSW,
    restartBackground: async () => {
      expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);
      await control.options.all();
    },
    filename: "interrupted-chrome.bin",
  });
});

test("options-save reset message round-trips", async () => {
  expect(await control.runtime.reset()).toEqual({
    type: "OK",
    body: { instanceId: expect.any(String), generation: expect.any(Number) },
  });
});

test("download completes through the real pipeline with session tracking", async () => {
  await control.background.startDownload({
    content: "e2e smoke test content",
    suggestedFilename: "smoke.txt",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("smoke");
  const completed = requireValue(
    downloads.find((download) => download.state === "complete"),
    "Smoke download did not complete",
  );
  await control.downloads.waitReleased(completed.id);

  const [matchingDownloads, sessionState, history] = await Promise.all([
    control.downloads.search({ filenameRegex: "smoke" }),
    control.storage.session.get(),
    control.history.get(),
  ]);
  const downloadState = matchingDownloads[0]?.state;
  const trackedDownloads = decodeRecord(sessionState.siDownloads ?? {});
  const adopted = Object.entries(trackedDownloads)
    .filter(([, record]) => decodeRecord(record).adopted === true)
    .map(([id]) => id);
  const pending = decodeNumber(sessionState.siPendingDownloads ?? 0);
  const finalFilenames = decodeRecord(
    decodeRecord(sessionState.siFinalFilenames ?? {}).names ?? {},
  );
  const entry = history.filter((row) => row.finalFullPath?.includes("smoke")).at(-1);

  expect(downloadState).toBe("complete");
  // Adoption is cleared after completion (the record itself lingers in
  // siDownloads for history/retry correlation); the pending counter is balanced
  // back to 0 and the per-URL filename entry was cleaned up (it only lingers
  // across a real service-worker restart, where the cleanup never runs)
  expect(adopted).toEqual([]);
  expect(pending).toBe(0);
  expect(finalFilenames).toEqual({});
  // the history entry recorded completion, the download id, and the file size
  expect(entry?.status).toBe("complete");
  expect(entry?.downloadId).toEqual(expect.any(Number));
  expect(entry?.fileSize).toBe("e2e smoke test content".length);

  const file = path.join(DOWNLOADS, "e2e", "smoke.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("e2e smoke test content");
});

test("private context-menu saves isolate Last used to the private session", async () => {
  await ensureIncognitoAccess();
  const privateWindow = await control.windows.create({ incognito: true, url: "about:blank" });
  try {
    await runPrivateContextScenario({
      control,
      waitForDownloads,
      filename: "private-chrome",
      privateWindowId: privateWindow.id,
    });
  } finally {
    await control.windows.remove(privateWindow.id);
    await control.storage.session.wait("siPrivateLastUsed", undefined);
  }
});

test("private activity persistence uses normal local state without leaving Incognito", async () => {
  await ensureIncognitoAccess();
  const privateWindow = await control.windows.create({ incognito: true, url: "about:blank" });
  try {
    await runPrivateContextScenario({
      control,
      waitForDownloads,
      filename: "private-persisted-chrome",
      privateWindowId: privateWindow.id,
      persistActivity: true,
    });
  } finally {
    await control.windows.remove(privateWindow.id);
  }
});

test("real Incognito activity stays out of routing, history, and automatic saves until opted in", async () => {
  await ensureIncognitoAccess();

  await runPrivateBrowserActivityScenario({
    control,
    openPrivatePage: async (url) => {
      const opened = await control.windows.create({ incognito: true, url });
      const [createdTab] = await control.tabs.query({ windowId: opened.id });
      const createdTabId = requireValue(createdTab?.id, "Private Chrome tab has no id");
      const tab = await control.tabs.wait({ id: createdTabId });
      const tabId = requireValue(tab.id, "Private Chrome tab has no id");
      const tabUrl = requireValue(tab.url, "Private Chrome tab has no URL");
      const target = `127.0.0.1:${new URL(tabUrl).port}/private-browser`;
      return {
        tabId,
        target,
        close: async () => {
          await control.windows.remove(opened.id);
        },
      };
    },
    evaluatePrivatePage: (target, expression) => cdp.evalInTarget(PORT, target, expression),
    waitForFile: async (relativePath) => {
      const fullPath = path.join(DOWNLOADS, relativePath);
      await poll(
        () => (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0 ? fullPath : null),
        {
          description: `Chrome private file ${relativePath}`,
        },
      );
      return fullPath;
    },
    filenamePrefix: "private-chrome-real",
  });
});

test("Save In filenames match live Chrome Content-Disposition behavior", async () => {
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
      content: "notification e2e content",
      suggestedFilename: "notification-e2e.txt",
      pageUrl: "https://example.com/",
    });
    const downloads = await waitForDownloads("notification-e2e");
    const download = requireValue(
      downloads.find((row) => row.state === "complete"),
      "Notification download did not complete",
    );
    expect(download.id).toEqual(expect.any(Number));
    const notificationId = String(download.id);

    const notification = await control.background.waitForNotification(notificationId);
    if (!notification) throw new Error("Success notification call was not captured");
    expect(notification.message).toContain("notification-e2e");
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

test("lastUsedPath survives re-initialisation", async () => {
  await control.storage.local.set({ lastUsedPath: "e2e/persisted" });
  await control.runtime.reset();
  const lastUsed = decodeString((await control.storage.local.get("lastUsedPath")).lastUsedPath);
  expect(lastUsed).toBe("e2e/persisted");
});

test("cold-start private handoff guard cannot become ordinary Chrome History", async () => {
  const filename = "private-handoff-guard.bin";
  const server = http.createServer((req, res) => {
    if (req.url === `/${filename}`) {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      res.end("anonymous private handoff guard");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<a id="guarded" href="/${filename}">download</a>`);
  });
  const port = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${port}/`;
  const target = `127.0.0.1:${port}`;
  const beforeHistory = await control.history.get();

  try {
    await control.options.set({
      trackBrowserDownloads: true,
      routeBrowserDownloads: false,
      browserDownloadFilter: "*://127.0.0.1/*",
    });
    await control.storage.session.set({ siPrivatePendingDownloads: 1 });
    expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);
    await control.options.all();

    await cdp.openTab(PORT, pageUrl);
    await waitForPageCondition(
      (expression, timeoutMs) => cdp.evalInTarget(PORT, target, expression, timeoutMs),
      "Boolean(document.querySelector('#guarded'))",
      { description: "guarded ordinary download page" },
    );
    await cdp.evalInTarget(PORT, target, "document.querySelector('#guarded').click(); true");

    const [download] = await waitForDownloads(filename);
    expect(download?.state).toBe("complete");
    const [afterHistory, session] = await Promise.all([
      control.history.get(),
      control.storage.session.get(),
    ]);
    expect(afterHistory).toEqual(beforeHistory);
    expect(session.siPrivatePendingDownloads).toBe(1);
    expect(decodeRecord(session.siDownloads ?? {})[String(download?.id)]).toBeUndefined();
  } finally {
    await control.options.set({
      trackBrowserDownloads: false,
      routeBrowserDownloads: false,
      browserDownloadFilter: "",
    });
    await control.storage.session.remove(["siPrivatePendingDownloads", "siNotificationRecovery"]);
    await closeLocal(server);
  }
});

test("ordinary browser downloads can be routed and tracked without adoption", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/native.bin") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="native.bin"',
      });
      res.end("ordinary browser download");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<a id="native" href="/native.bin">download</a>');
  });
  const port = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${port}/`;
  const target = `127.0.0.1:${port}`;

  try {
    await control.options.set({
      trackBrowserDownloads: true,
      routeBrowserDownloads: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      filenamePatterns:
        "mime: ^application/octet-stream$\nreferrerdomain: ^127\\.0\\.0\\.1$\ninto: browser-routed/:filename:",
    });
    await cdp.openTab(PORT, pageUrl);
    await poll(
      async () =>
        (await cdp.evalInTarget(PORT, target, "!!document.querySelector('#native')")) === true,
      { description: "ordinary download page", ignoreErrors: true },
    );
    await cdp.evalInTarget(PORT, target, "document.querySelector('#native').click(); true");

    const rows = await waitForDownloads("browser-routed.*native\\.bin");
    expect(rows.some((row) => row.state === "complete")).toBe(true);
    const observed = await control.history.wait({ context: "browser", status: "complete" });
    expect(observed.at(-1)).toMatchObject({
      status: "complete",
      finalFullPath: expect.stringContaining("browser-routed"),
      info: { context: "browser" },
    });
  } finally {
    await control.options.set({
      trackBrowserDownloads: false,
      routeBrowserDownloads: false,
      browserDownloadFilter: "",
      filenamePatterns: "",
    });
    await closeLocal(server);
  }
});

test("paths textarea renders a live menu-tree preview", async () => {
  const preview = decodeString(
    await evalOptions(`new Promise((resolve, reject) => {
      const ta = document.querySelector("#paths");
      const preview = document.querySelector("#menu-preview-tree");
      const timeout = AbortSignal.timeout(8000);
      let observer;
      const finish = (callback) => {
        observer?.disconnect();
        timeout.removeEventListener("abort", onTimeout);
        window.removeEventListener("error", onError);
        callback();
      };
      const check = () => {
        const text = preview?.textContent || "";
        if (text.includes("Dogs!") && text.includes("corgi")) {
          finish(() => resolve(text));
        }
      };
      const onTimeout = () => finish(() => reject(new Error(
        "Timed out waiting for live menu-tree preview: " + (preview?.textContent || "<empty>")
      )));
      const onError = (event) => finish(() => reject(event.error || new Error(event.message)));
      observer = new MutationObserver(check);
      observer.observe(preview, { childList: true, subtree: true, characterData: true });
      timeout.addEventListener("abort", onTimeout, { once: true });
      window.addEventListener("error", onError, { once: true });
      ta.value = "dogs // (alias: Dogs!)\\n>corgi\\n---\\ncats";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      check();
    })`),
  );

  expect(preview).toContain("Dogs!");
  expect(preview).toContain("corgi");
});

test("the paths editor applies changes while drafts stay local", async () => {
  const result = await evaluateJson(
    evalOptions,
    `(async () => {
      const ta = document.querySelector("#paths");
      const apply = document.querySelector('[data-apply="paths"]');
      const waitForEnabled = (button, label) => {
        if (!button.disabled) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timeout = AbortSignal.timeout(3000);
          const observer = new MutationObserver(() => {
            if (!button.disabled) finish(resolve);
          });
          const finish = (callback) => {
            observer.disconnect();
            timeout.removeEventListener("abort", onTimeout);
            callback();
          };
          const onTimeout = () => finish(() => reject(new Error(label + " timeout")));
          timeout.addEventListener("abort", onTimeout, { once: true });
          observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
          if (!button.disabled) finish(resolve);
        });
      };

      ta.value = "baseline";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await waitForEnabled(apply, "paths validation");
      const baselineStored = ${localStorageValue("paths", "baseline", 3000)};
      apply.click();
      await baselineStored;

      ta.value = "baseline\\nunsaved";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await waitForEnabled(apply, "draft validation");
      const storedDraft = await browser.storage.local.get("paths");

      return JSON.stringify({ value: ta.value, storedPaths: storedDraft.paths });
    })()`,
    objectOf({ value: decodeString, storedPaths: decodeString }),
  );

  expect(result.value).toBe("baseline\nunsaved");
  expect(result.storedPaths).toBe("baseline");
});

test("changing paths is visible after background reinitialisation", async () => {
  await control.options.set({ paths: "alpha\nbeta\ngamma\ndelta\nepsilon" });
  expect((await control.options.get("paths")).split("\n")).toHaveLength(5);
});

test(":counter: advances once per download and persists in storage", async () => {
  await control.storage.local.set({ "save-in-counter": 0 });
  await control.options.set({
    filenamePatterns: "filename: countme\ninto: counters/:counter:-:filename:",
  });
  for (let i = 0; i < 2; i += 1) {
    await control.background.startDownload({
      content: `counted-${i}`,
      suggestedFilename: "countme.txt",
      pageUrl: "https://example.com/",
    });
    const rows = await waitForDownloads(`${i + 1}-countme`);
    expect(rows.some((x) => x.state === "complete")).toBe(true);
  }
  const finalCount = decodeNumber(
    (await control.storage.local.get("save-in-counter"))["save-in-counter"],
  );
  // two downloads -> counter advanced exactly twice
  expect(finalCount).toBe(2);
  // and each download's :counter: resolved to its own value
  expect(fs.existsSync(path.join(DOWNLOADS, "e2e", "counters", "1-countme.txt"))).toBe(true);
  expect(fs.existsSync(path.join(DOWNLOADS, "e2e", "counters", "2-countme.txt"))).toBe(true);
});

test("APPLY_CONFIG validates and persists a partial config (#89)", async () => {
  const body = await control.background.applyConfig({
    truncateLength: 99,
    notifyOnSuccess: false,
    bogusKey: 1,
  });
  const stored = await control.storage.local.get(["truncateLength", "notifyOnSuccess"]);

  expect(body.applied).toEqual({ truncateLength: 99, notifyOnSuccess: false });
  expect(body.rejected).toEqual([{ name: "bogusKey", reason: "unknown option" }]);
  // persisted to storage.local, and the unknown key was not written
  expect(stored.truncateLength).toBe(99);
  expect(stored.notifyOnSuccess).toBe(false);
});

test("message-driven downloads work and never inherit a stale route", async () => {
  // Explicit precondition: a routing rule matching "routeme" is active, and
  // the previous download's routed state is the "last" state a naive merge
  // would inherit. The message download must NOT be renamed/rerouted by it.
  await control.options.set({
    filenamePatterns: "filename: routeme\ninto: routed/renamed-:filename:",
  });

  // v1 handshake: PING negotiates the version + capabilities end-to-end
  const pong = await evaluateJson(
    evalOptions,
    `new Promise((res) => chrome.runtime.sendMessage({ type: "PING" }, (r) => res(JSON.stringify(r))))`,
    objectOf({
      type: decodeString,
      body: objectOf({ version: decodeNumber, capabilities: arrayOf(decodeString) }),
    }),
  );
  expect(pong.type).toBe("PONG");
  expect(pong.body.version).toBe(1);
  expect(pong.body.capabilities).toContain("download");

  const ack = await evalOptions(`new Promise((res) => chrome.runtime.sendMessage({
    type: "DOWNLOAD",
    body: {
      url: "data:text/plain,message%20download",
      info: {
        pageUrl: "https://example.com/",
        srcUrl: "data:text/plain,message%20download",
        suggestedFilename: "msg-download.txt",
      },
    },
  }, (r) => res(JSON.stringify(r))))`);
  // v1 external API: status:"OK" is unchanged for back-compat; version/url added
  expect(parseJson(ack, decodeRecord)).toEqual({
    type: "DOWNLOAD",
    body: { status: "OK", version: 1, url: "data:text/plain,message%20download" },
  });

  const rows = await waitForDownloads("msg-download");
  expect(rows).toHaveLength(1);
  const download = requireValue(rows[0], "Message download was not captured");
  expect(download.state).toBe("complete");
  // The download kept its own filename and did NOT land under the rule's
  // routed/renamed- destination
  expect(download.filename).toMatch(/msg-download\.txt$/);
  expect(download.filename).not.toMatch(/routed/);
});

test("a separately installed extension negotiates, authorizes, and routes a download", async () => {
  const callerDir = path.resolve("test", "e2e", "fixtures", "external-caller");
  const callerId = await cdp.loadUnpacked(PORT, callerDir);
  const callerUrl = `chrome-extension://${callerId}/control.html`;
  await cdp.openTab(PORT, callerUrl);
  await poll(
    async () =>
      (await cdp.evalInTarget(PORT, callerId, "document.readyState === 'complete'")) === true
        ? true
        : null,
    { description: "external caller extension page", ignoreErrors: true },
  );

  await runExternalExtensionScenario({
    control,
    sendExternal: (message) =>
      cdp
        .evalInTarget(
          PORT,
          callerId,
          `chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, ${JSON.stringify(message)})
            .then((response) => JSON.stringify(response))`,
        )
        .then((value) => parseJson(value, decodeRecord)),
    callerId,
    waitForDownloads,
    filename: "external-chrome.bin",
  });
});

test("fetchViaFetch downloads via an offscreen document (Chrome MV3)", async () => {
  await control.options.set({ filenamePatterns: "", fetchViaFetch: true });
  await control.background.startDownload({
    url: "data:text/plain,via%20fetch%20content",
    suggestedFilename: "viafetch.txt",
    pageUrl: "https://example.com/",
  });
  expect((await waitForDownloads("viafetch")).map((x) => x.state)).toEqual(["complete"]);
  const hasOffscreen = await control.offscreen.hasDocument();
  await control.options.set({ fetchViaFetch: false });
  // the service worker used an offscreen document for the blob object URL
  expect(hasOffscreen).toBe(true);

  const file = path.join(DOWNLOADS, "e2e", "viafetch.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("via fetch content");
});

test("Referer-protected downloads use a scoped DNR offscreen fetch", async () => {
  /** @type {Array<{method: string, referer: string}>} */
  const receivedRequests = [];
  const expectedReferer = "http://gallery.example/artwork/66";
  const body = "chrome referer protected content";
  const expectedHash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  const server = http.createServer((req, res) => {
    receivedRequests.push({ method: req.method || "", referer: req.headers.referer || "" });
    if (req.headers.referer !== expectedReferer) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("missing referer");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/webp" });
    res.end(body);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/referer-protected.txt`;
  const previous = {
    setRefererHeader: await control.options.get("setRefererHeader"),
    setRefererHeaderFilter: await control.options.get("setRefererHeaderFilter"),
  };
  try {
    await control.options.set({
      setRefererHeader: true,
      setRefererHeaderFilter: "*://127.0.0.1/*",
      fetchViaFetch: false,
    });
    await control.background.startDownload({
      url,
      pageUrl: expectedReferer,
      path: "e2e/referer-protected-chrome-:mimeext:-:sha256:.txt",
      suggestedFilename: "referer-protected-chrome.txt",
    });
    const rows = await waitForDownloads("referer-protected-chrome");
    const done = requireValue(
      rows.find((row) => row.state === "complete"),
      "Referer-protected Chrome download did not complete",
    );
    expect(receivedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
    expect(receivedRequests.every(({ referer }) => referer === expectedReferer)).toBe(true);
    expect(done.filename).toContain(`referer-protected-chrome-webp-${expectedHash}`);
    expect(fs.readFileSync(done.filename, "utf8")).toBe(body);
    const remainingRules = (await control.dnr.getSessionRules()).map((rule) => rule.id);
    expect(remainingRules).not.toContain(66_000_001);
  } finally {
    await control.options.set({ ...previous, fetchViaFetch: false });
    await closeLocal(server);
  }
});

test("distinct Referer-protected fetches overlap while keeping exact headers", async () => {
  /** @type {Array<{path: string, method: string, referer: string}>} */
  const requests = [];
  const fixtures = [
    { name: "referer-concurrent-a", referer: "https://gallery.example/a" },
    { name: "referer-concurrent-b", referer: "https://gallery.example/b" },
  ];
  /** @type {Array<() => void>} */
  const heldHeadResponses = [];
  let holdHeadResponses = true;
  let concurrentHeadsObserved = false;
  let markConcurrentHeadsObserved = () => {};
  /** @type {Promise<void>} */
  const concurrentHeads = new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(8000);
    /** @param {() => void} complete */
    const finish = (complete) => {
      timeout.removeEventListener("abort", onTimeout);
      complete();
    };
    const onTimeout = () =>
      finish(() => reject(new Error("Distinct Referer-protected HEAD requests did not overlap")));
    markConcurrentHeadsObserved = () => finish(resolve);
    timeout.addEventListener("abort", onTimeout, { once: true });
  });
  const releaseHeldHeads = () => {
    for (const respond of heldHeadResponses.splice(0)) respond();
  };
  const server = http.createServer((req, res) => {
    requests.push({
      path: req.url || "",
      method: req.method || "",
      referer: req.headers.referer || "",
    });
    const respond = () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : `body:${req.url}`);
    };
    if (holdHeadResponses && req.method === "HEAD") {
      heldHeadResponses.push(respond);
      if (heldHeadResponses.length === fixtures.length) {
        concurrentHeadsObserved = true;
        holdHeadResponses = false;
        markConcurrentHeadsObserved();
        releaseHeldHeads();
      }
      return;
    }
    respond();
  });
  const port = await listenLocal(server);
  const previous = {
    setRefererHeader: await control.options.get("setRefererHeader"),
    setRefererHeaderFilter: await control.options.get("setRefererHeaderFilter"),
  };
  /** @type {Promise<unknown> | undefined} */
  let launches;

  try {
    await control.options.set({
      setRefererHeader: true,
      setRefererHeaderFilter: "*://127.0.0.1/*",
      fetchViaFetch: false,
    });
    launches = Promise.all(
      fixtures.map((fixture) =>
        control.background.startDownload({
          url: `http://127.0.0.1:${port}/${fixture.name}.txt`,
          pageUrl: fixture.referer,
          path: `e2e/${fixture.name}-:mimeext:.txt`,
          suggestedFilename: `${fixture.name}.txt`,
        }),
      ),
    );
    await concurrentHeads;
    await launches;
    await Promise.all(fixtures.map(({ name }) => waitForDownloads(name)));

    expect(concurrentHeadsObserved).toBe(true);
    for (const fixture of fixtures) {
      const matching = requests.filter(({ path: requestPath }) =>
        requestPath.includes(fixture.name),
      );
      expect(matching.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
      expect(matching.every(({ referer }) => referer === fixture.referer)).toBe(true);
    }
    const remainingRules = (await control.dnr.getSessionRules()).map((rule) => rule.id);
    for (let id = 66_000_001; id < 66_000_007; id += 1) {
      expect(remainingRules).not.toContain(id);
    }
  } finally {
    holdHeadResponses = false;
    releaseHeldHeads();
    await launches?.catch(() => {});
    await control.options.set({ ...previous, fetchViaFetch: false });
    await closeLocal(server);
  }
});

test("extension fetch credentials are preserved across cross-origin redirects", async () => {
  /** @type {string[]} */
  const protectedRequests = [];
  /** @type {string[]} */
  const redirectRequests = [];
  const destinationServer = http.createServer((req, res) => {
    if (req.url === "/protected.bin") {
      const cookie = req.headers.cookie || "";
      protectedRequests.push(cookie);
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(cookie.includes("save_in_auth=granted") ? "authenticated" : "anonymous");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Set-Cookie": "save_in_auth=granted; Path=/protected.bin",
    });
    res.end("<!doctype html><title>credential fixture</title>");
  });
  const destinationPort = await listenLocal(destinationServer);
  const redirectServer = http.createServer((req, res) => {
    redirectRequests.push(req.headers.cookie || "");
    res.writeHead(302, {
      Location: `http://127.0.0.1:${destinationPort}/protected.bin`,
    });
    res.end();
  });
  const redirectPort = await listenLocal(redirectServer);
  const pageUrl = `http://127.0.0.1:${destinationPort}/protected.bin/setup`;
  const targetUrl = `127.0.0.1:${destinationPort}`;

  try {
    await cdp.openTab(PORT, pageUrl);
    await poll(
      async () =>
        (await cdp.evalInTarget(PORT, targetUrl, "document.cookie"))?.includes(
          "save_in_auth=granted",
        )
          ? true
          : null,
      { description: "credential fixture cookie", ignoreErrors: true },
    );

    await control.options.set({ fetchViaFetch: true, includeFetchCredentials: false });
    await control.background.startDownload({
      url: `http://127.0.0.1:${redirectPort}/credentials-omitted.bin`,
      suggestedFilename: "credentials-omitted.bin",
      pageUrl,
    });
    await waitForDownloads("credentials-omitted", 10000);

    await control.options.set({ fetchViaFetch: true, includeFetchCredentials: true });
    await control.background.startDownload({
      url: `http://127.0.0.1:${redirectPort}/credentials-included.bin`,
      suggestedFilename: "credentials-included.bin",
      pageUrl,
    });
    await waitForDownloads("credentials-included", 10000);

    expect(fs.readFileSync(path.join(DOWNLOADS, "e2e", "credentials-omitted.bin"), "utf8")).toBe(
      "anonymous",
    );
    expect(fs.readFileSync(path.join(DOWNLOADS, "e2e", "credentials-included.bin"), "utf8")).toBe(
      "authenticated",
    );
    expect(redirectRequests).toEqual(["", ""]);
    expect(protectedRequests).toEqual(["", expect.stringContaining("save_in_auth=granted")]);
  } finally {
    await control.options.set({ fetchViaFetch: false, includeFetchCredentials: false });
    await Promise.all([closeLocal(redirectServer), closeLocal(destinationServer)]);
  }
});

test(":sha256: and :sha256full: hash and save from a single fetch (Chrome MV3)", async () => {
  // The file is routed by its own short and full content hashes. That hash requires the bytes,
  // so the offscreen document fetches once, digests, and the save reuses that
  // same fetch's blob URL — the server must be hit exactly once, not twice.
  const body = "share this fetch once";
  const expectedHash = crypto.createHash("sha256").update(body).digest("hex");
  const expectedShortHash = expectedHash.slice(0, 12);
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  });
  const serverPort = await listenLocal(server);

  try {
    await control.options.set({ filenamePatterns: "" });
    await control.background.startDownload({
      path: "e2e/:sha256:/:sha256full:",
      url: `http://127.0.0.1:${serverPort}/hashme.bin`,
      suggestedFilename: "hashme.bin",
      pageUrl: `http://127.0.0.1:${serverPort}/`,
    });

    const rows = await waitForDownloads(expectedHash, 10000);
    const done = requireValue(
      rows.find((row) => row.state === "complete"),
      "Hashed Chrome download did not complete",
    );

    // Both content-hash forms appear in the saved path and the bytes are intact...
    expect(done.filename).toContain(expectedShortHash);
    expect(done.filename).toContain(expectedHash);
    expect(fs.readFileSync(done.filename, "utf8")).toBe(body);
    // ...and the origin server was fetched exactly once: the hash fetch's bytes
    // were reused for the save instead of downloading the file a second time
    expect(hits).toBe(1);
  } finally {
    await closeLocal(server);
  }
});

test("a bundled direct save delivers the configured webhook payload once", async () => {
  const keys = [
    "webhookEnabled",
    "webhookUrl",
    "webhookOnStart",
    "webhookOnComplete",
    "webhookIncludePageUrl",
    "webhookIncludePageTitle",
    "webhookIncludeSelectionText",
  ];
  const previous = await control.storage.local.get(keys);
  const missing = keys.filter((key) => !(key in previous));

  try {
    // The save event is this case's subject: it is the only one that carries the
    // page data asserted below. Name both toggles rather than lean on their
    // defaults — a save now reports at start and at completion independently, so
    // leaving the outcome on would deliver a second call and defeat the "once".
    await control.options.set({
      webhookEnabled: true,
      webhookUrl: "https://webhook.invalid/save?token=secret",
      webhookOnStart: true,
      webhookOnComplete: false,
      webhookIncludePageUrl: true,
      webhookIncludePageTitle: false,
      webhookIncludeSelectionText: false,
    });
    await evalWorker(`(() => {
      globalThis.__saveInE2EOriginalFetch = globalThis.fetch;
      globalThis.__saveInE2EWebhookCalls = [];
      globalThis.fetch = async (input, init = {}) => {
        globalThis.__saveInE2EWebhookCalls.push({
          input: String(input),
          method: init.method,
          headers: init.headers,
          body: init.body,
          credentials: init.credentials,
          cache: init.cache,
          redirect: init.redirect,
          referrerPolicy: init.referrerPolicy,
        });
        return { ok: true, status: 204 };
      };
      return true;
    })()`);
    await control.background.startDownload({
      content: "webhook e2e content",
      suggestedFilename: "webhook-e2e.txt",
      pageUrl: "https://page.example/webhook-source",
    });
    await waitForDownloads("webhook-e2e");
    const calls = requireValue(
      await poll(
        async () => {
          const rows = await evaluateJson(
            evalWorker,
            `JSON.stringify(globalThis.__saveInE2EWebhookCalls || [])`,
            arrayOf(
              objectOf({
                input: decodeString,
                method: optional(decodeString),
                body: decodeString,
                credentials: optional(decodeString),
                cache: optional(decodeString),
                redirect: optional(decodeString),
                referrerPolicy: optional(decodeString),
              }),
            ),
          );
          return rows.length === 1 ? rows : null;
        },
        { description: "webhook delivery" },
      ),
      "Webhook delivery was not observed",
    );
    const call = requireValue(calls[0], "Webhook call was not captured");
    expect(call).toMatchObject({
      input: "https://webhook.invalid/save?token=secret",
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(parseJson(call.body, decodeRecord)).toMatchObject({
      version: 1,
      event: "save",
      url: "https://page.example/webhook-source",
      pageUrl: "https://page.example/webhook-source",
    });
  } finally {
    await evalWorker(`(() => {
      if (globalThis.__saveInE2EOriginalFetch) globalThis.fetch = globalThis.__saveInE2EOriginalFetch;
      delete globalThis.__saveInE2EOriginalFetch;
      delete globalThis.__saveInE2EWebhookCalls;
      return true;
    })()`).catch(() => {});
    await Promise.all([control.storage.local.set(previous), control.storage.local.remove(missing)]);
    await control.runtime.reset();
  }
});

test("options page autosave persists to storage and survives a restart", async () => {
  // "promptOnShift" is a safe toggle: it never opens a Save As dialog that
  // would stall later downloads, unlike "prompt"
  try {
    await evalOptions(`(async () => {
      const cb = document.querySelector("#promptOnShift");
      const stored = ${localStorageValue("promptOnShift", false)};
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      await stored;
      return "toggled";
    })()`);

    // Persisted to storage.local (not just the in-memory option)...
    const stored = await control.storage.local.get("promptOnShift");
    expect(stored.promptOnShift).toBe(false);

    // ...and survives a simulated service-worker restart
    await control.runtime.reset();
    expect(await control.options.get("promptOnShift")).toBe(false);
  } finally {
    await evalOptions(`(async () => {
      const cb = document.querySelector("#promptOnShift");
      const stored = ${localStorageValue("promptOnShift", true)};
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      await stored;
      return "restored";
    })()`);
    await control.runtime.reset();
  }
});

test("removing option keys restores live defaults before reset acknowledgement", async () => {
  try {
    await control.options.set({ promptOnShift: false });

    const result = await evaluateJson(
      evalOptions,
      `(async () => {
        await chrome.storage.local.remove("promptOnShift");
        const response = await chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" });
        return JSON.stringify({ response, stored: await chrome.storage.local.get("promptOnShift") });
      })()`,
      objectOf({ response: decodeRecord, stored: decodeRecord }),
    );

    expect(result.response).toEqual({
      type: "OK",
      body: { instanceId: expect.any(String), generation: expect.any(Number) },
    });
    expect(result.stored).toEqual({});
    expect(await control.options.get("promptOnShift")).toBe(true);
  } finally {
    await control.options.set({ promptOnShift: true });
  }
});

test("click-to-save rejects synthetic input and handles trusted single, double, and long clicks", async () => {
  // Serve a page with an image so the content script has something real
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<html><body><a id="image-link" href="/opened"><img id="img" src="/pic.png"></a></body></html>',
      );
    }
  });
  const serverPort = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${serverPort}/`;
  const targetUrl = `127.0.0.1:${serverPort}`;
  const previousContentClickToSave = await control.options.get("contentClickToSave");
  const previousContentClickToSaveCombo = await control.options.get("contentClickToSaveCombo");
  const previousContentClickToSaveBindings = await control.options.get(
    "contentClickToSaveBindings",
  );
  const previousContentClickToSaveLongPressMs = await control.options.get(
    "contentClickToSaveLongPressMs",
  );
  const previousFilenamePatterns = (await control.storage.local.get("filenamePatterns"))
    .filenamePatterns;

  try {
    await control.options.set({
      contentClickToSave: true,
      contentClickToSaveBindings: "",
      contentClickToSaveCombo: 18,
    });

    await cdp.openTab(PORT, pageUrl);
    await poll(
      async () =>
        (await cdp.evalInTarget(PORT, targetUrl, "!!document.getElementById('img')")) === true,
      { description: "content page image", ignoreErrors: true },
    );
    const fixtureTab = (await control.tabs.query()).find((candidate) =>
      candidate.url?.includes(targetUrl),
    );
    const fixtureTabId = requireValue(fixtureTab?.id, "click-to-save fixture tab missing");
    await control.tabs.waitContentReady(fixtureTabId);
    await control.tabs.update(fixtureTabId, { active: true });

    await cdp.evalInTarget(
      PORT,
      targetUrl,
      `(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
        document.getElementById("img").dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1 })
        );
        return true;
      })()`,
    );
    const syntheticDownloads = (await control.downloads.search()).filter(
      (item) => item.url === `${pageUrl}pic.png`,
    );
    expect(syntheticDownloads).toHaveLength(0);

    // The page-generated attempt above is rejected. Dispatch real input through
    // the browser to prove the configured gesture still works.
    const target = parseJson(
      await cdp.evalInTarget(
        PORT,
        targetUrl,
        `(() => {
          const rect = document.getElementById("img").getBoundingClientRect();
          return JSON.stringify({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        })()`,
      ),
      objectOf({ x: decodeNumber, y: decodeNumber }),
    );

    await cdp.dispatchInput(PORT, targetUrl, [
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyDown",
          key: "Alt",
          code: "AltLeft",
          windowsVirtualKeyCode: 18,
          nativeVirtualKeyCode: 18,
          modifiers: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          modifiers: 1,
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyUp",
          key: "Alt",
          code: "AltLeft",
          windowsVirtualKeyCode: 18,
          nativeVirtualKeyCode: 18,
        },
      },
    ]);

    const download = await waitForDownloads("pic");

    if (download.length !== 1) {
      const [log, downloads, option] = await Promise.all([
        control.logs.get(),
        control.downloads.search(),
        control.storage.local.get("contentClickToSave"),
      ]);
      // eslint-disable-next-line no-console -- emitted only when the e2e assertion is about to fail
      console.log(
        "DIAG:",
        JSON.stringify({
          log: log.slice(-5),
          downloads: downloads.map((entry) => entry.filename.slice(-30)),
          option,
        }),
      );
    }

    expect(download).toHaveLength(1);
    const completed = requireValue(download[0], "Automatic Chrome download was not captured");
    expect(completed.state).toBe("complete");
    expect(fs.readFileSync(completed.filename)).toEqual(png);

    const longClickConfig = {
      contentClickToSaveBindings: JSON.stringify({
        version: 1,
        bindings: [{ gesture: "long-left-click", combo: "" }],
      }),
      contentClickToSaveLongPressMs: 500,
      filenamePatterns:
        "context: ^click$\ngesture: ^long-left-click$\ninto: e2e/long-click/:filename:",
    };
    const appliedLongClick = await control.runtime.send({
      type: "APPLY_CONFIG",
      body: { config: longClickConfig },
    });
    expect(appliedLongClick.body.applied).toMatchObject(longClickConfig);
    await cdp.evalInTarget(
      PORT,
      targetUrl,
      `(() => {
        document.getElementById("image-link").href = "#opened";
        window.__saveInLongClickEvents = [];
        for (const type of ["mousedown", "mouseup", "click"]) {
          window.addEventListener(type, (event) => {
            window.__saveInLongClickEvents.push(type);
          }, true);
        }
        return true;
      })()`,
    );
    /** @returns {{method: "Input.dispatchMouseEvent", params: Record<string, unknown>}} */
    const longMouseEvent = (/** @type {"mousePressed" | "mouseReleased"} */ type) => ({
      method: "Input.dispatchMouseEvent",
      params: {
        type,
        x: target.x,
        y: target.y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      },
    });

    await cdp.dispatchInput(PORT, targetUrl, [
      longMouseEvent("mousePressed"),
      longMouseEvent("mouseReleased"),
    ]);
    expect(
      parseJson(
        await cdp.evalInTarget(PORT, targetUrl, "JSON.stringify(window.__saveInLongClickEvents)"),
        arrayOf(decodeString),
      ),
    ).toEqual(["mousedown", "mouseup", "click"]);
    expect(await cdp.evalInTarget(PORT, targetUrl, "location.hash")).toBe("#opened");
    await cdp.evalInTarget(
      PORT,
      targetUrl,
      `history.replaceState(null, "", location.pathname); window.__saveInLongClickEvents = []; true`,
    );

    await cdp.dispatchInput(PORT, targetUrl, [longMouseEvent("mousePressed")]);
    const longClickDownloads = await waitForDownloads("long-click");
    await cdp.dispatchInput(PORT, targetUrl, [longMouseEvent("mouseReleased")]);
    expect(longClickDownloads).toHaveLength(1);
    expect(longClickDownloads[0]?.state).toBe("complete");
    expect(fs.readFileSync(requireValue(longClickDownloads[0]?.filename, "path"))).toEqual(png);
    const longEvents = parseJson(
      await cdp.evalInTarget(PORT, targetUrl, "JSON.stringify(window.__saveInLongClickEvents)"),
      arrayOf(decodeString),
    );
    // A page capture listener registered before an options-driven remount may
    // observe click before Save In's capture listener cancels it. Navigation is
    // the contract: short clicks change the hash above; completed holds do not.
    expect(longEvents.slice(0, 2)).toEqual(["mousedown", "mouseup"]);
    expect(await cdp.evalInTarget(PORT, targetUrl, "location.hash")).toBe("");

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
    await cdp.evalInTarget(
      PORT,
      targetUrl,
      `(() => {
        window.__saveInDoubleClickEvents = [];
        for (const type of ["mousedown", "click", "dblclick"]) {
          window.addEventListener(type, (event) => {
            window.__saveInDoubleClickEvents.push({ type, detail: event.detail, button: event.button });
            if (type === "click") event.preventDefault();
          }, true);
        }
        return true;
      })()`,
    );
    await cdp.dispatchInput(PORT, targetUrl, [
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 1,
          clickCount: 2,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: target.x,
          y: target.y,
          button: "left",
          buttons: 0,
          clickCount: 2,
        },
      },
    ]);
    const doubleClickEvents = parseJson(
      await cdp.evalInTarget(PORT, targetUrl, "JSON.stringify(window.__saveInDoubleClickEvents)"),
      arrayOf(objectOf({ type: decodeString, detail: decodeNumber, button: decodeNumber })),
    );
    expect(doubleClickEvents).toEqual([
      { type: "mousedown", detail: 1, button: 0 },
      { type: "click", detail: 1, button: 0 },
    ]);
    const doubleClickDownloads = await waitForDownloads("double-click");
    expect(doubleClickDownloads).toHaveLength(1);
    expect(doubleClickDownloads[0]?.state).toBe("complete");
    expect(fs.readFileSync(requireValue(doubleClickDownloads[0]?.filename, "path"))).toEqual(png);
  } finally {
    try {
      await control.options.set({
        contentClickToSave: previousContentClickToSave,
        contentClickToSaveBindings: previousContentClickToSaveBindings,
        contentClickToSaveCombo: previousContentClickToSaveCombo,
        contentClickToSaveLongPressMs: previousContentClickToSaveLongPressMs,
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

test("middle and right click gestures on a link save without the native action", async () => {
  // Measured for this case (Chrome 150, CDP input): a synthesized middle
  // click on a link opens it in a new tab, and a synthesized right click
  // delivers a cancelable contextmenu — both renderer-level defaults the
  // gesture must cancel alongside its own mousedown. The page registers its
  // observers at parse time, before the document_idle content script, so it
  // still sees suppressed events; defaultPrevented is read in a queued task
  // because the extension's capture listener runs after the observer.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="margin:0">
        <a id="lnk" href="/pic.png" style="display:block;width:200px;height:60px">save target</a>
        <script>
          window.__saveInGestureEvents = [];
          for (const type of ["auxclick", "contextmenu", "click"]) {
            window.addEventListener(type, (event) => {
              window.__saveInGestureEvents.push({ type, event });
            }, true);
          }
        </script></body></html>`);
    }
  });
  const serverPort = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${serverPort}/`;
  const targetUrl = `127.0.0.1:${serverPort}`;
  const previousStoredPatterns = (await control.storage.local.get("filenamePatterns"))
    .filenamePatterns;
  const previousOptions = {
    contentClickToSave: await control.options.get("contentClickToSave"),
    contentClickToSaveBindings: await control.options.get("contentClickToSaveBindings"),
    filenamePatterns: typeof previousStoredPatterns === "string" ? previousStoredPatterns : "",
  };

  try {
    await control.options.set({
      contentClickToSave: true,
      contentClickToSaveBindings: JSON.stringify({
        version: 1,
        bindings: [
          { gesture: "middle-click", combo: "" },
          { gesture: "right-click", combo: "" },
        ],
      }),
      // The default links:true content option resolves the enclosing link.
      filenamePatterns: [
        "context: ^click$",
        "gesture: ^middle-click$",
        "into: e2e/middle-gesture/:filename:",
        "",
        "context: ^click$",
        "gesture: ^right-click$",
        "into: e2e/right-gesture/:filename:",
      ].join("\n"),
    });

    await cdp.openTab(PORT, pageUrl);
    const fixtureTab = await control.tabs.wait({ urlIncludes: targetUrl });
    const fixtureTabId = requireValue(fixtureTab.id, "gesture fixture tab missing");
    await control.tabs.waitContentReady(fixtureTabId);
    await control.tabs.update(fixtureTabId, { active: true });
    const tabsBefore = (await control.tabs.query()).length;

    const point = parseJson(
      await cdp.evalInTarget(
        PORT,
        targetUrl,
        `(() => {
          const rect = document.getElementById("lnk").getBoundingClientRect();
          return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        })()`,
      ),
      objectOf({ x: decodeNumber, y: decodeNumber }),
    );

    await cdp.dispatchInput(PORT, targetUrl, [
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: "middle",
          buttons: 4,
          clickCount: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: "middle",
          buttons: 0,
          clickCount: 1,
        },
      },
    ]);
    const middleDownloads = await waitForDownloads("middle-gesture");
    expect(middleDownloads).toHaveLength(1);
    expect(middleDownloads[0]?.state).toBe("complete");
    expect(fs.readFileSync(requireValue(middleDownloads[0]?.filename, "path"))).toEqual(png);

    await cdp.dispatchInput(PORT, targetUrl, [
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: "right",
          buttons: 2,
          clickCount: 1,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: "right",
          buttons: 0,
          clickCount: 1,
        },
      },
    ]);
    const rightDownloads = await waitForDownloads("right-gesture");
    expect(rightDownloads).toHaveLength(1);
    expect(rightDownloads[0]?.state).toBe("complete");

    // defaultPrevented is read here, after the dispatches completed: a
    // microtask checkpoint runs between listeners, so any deferred read
    // queued by this early observer would still run before the extension's
    // later-registered capture listener called preventDefault.
    const observed = parseJson(
      await cdp.evalInTarget(
        PORT,
        targetUrl,
        `JSON.stringify(window.__saveInGestureEvents.map(({ type, event }) =>
          ({ type, button: event.button, prevented: event.defaultPrevented })))`,
      ),
      arrayOf(objectOf({ type: decodeString, button: decodeNumber, prevented: decodeBoolean })),
    );
    // The middle click's auxclick (new-tab default) and the right click's
    // contextmenu (menu default) were both canceled by the extension.
    expect(observed).toContainEqual({ type: "auxclick", button: 1, prevented: true });
    expect(observed).toContainEqual({ type: "contextmenu", button: 2, prevented: true });
    expect(observed.filter((event) => event.prevented === false)).toEqual([]);

    // The saved link did not also open: the page stayed put and no tab opened.
    const tabs = await control.tabs.query();
    expect(tabs.length).toBe(tabsBefore);
    expect(tabs.filter((tab) => tab.url?.includes("pic.png"))).toEqual([]);
  } finally {
    try {
      await control.options.set(previousOptions);
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
  const target = `127.0.0.1:${port}/automatic-sources`;
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
pageurl: ^http://127\\.0\\.0\\.1:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: \\.png$
into: e2e/automatic-chrome/:filename:`,
    });
    await cdp.openTab(PORT, pageUrl);
    const completed = await control.downloads.wait({
      filenameRegex: "automatic-chrome",
      minimumComplete: 2,
      timeoutMs: 10000,
    });
    expect(completed.filter((row) => row.state === "complete")).toHaveLength(2);
    expect(completed.every((row) => !row.filename.includes("ordinary-should-not-match"))).toBe(
      true,
    );

    await cdp.evalInTarget(
      PORT,
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
    await waitForDownloadUrl(`http://127.0.0.1:${port}/late.png`);
    const rows = (await control.downloads.search()).filter(
      (item) => item.url === `http://127.0.0.1:${port}/over-limit.png`,
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
  const target = `127.0.0.1:${port}/automatic-sources`;
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
pageurl: ^http://127\\.0\\.0\\.1:${port}/automatic-sources$
sourcekind: ^document$
sourceurl: doc\\.pdf$
into: e2e/automatic-phase-b-chrome/:filename:

context: ^auto$
pageurl: ^http://127\\.0\\.0\\.1:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: bg\\.png$
into: e2e/automatic-phase-b-chrome/:filename:`,
    });
    await cdp.openTab(PORT, pageUrl);
    const completed = await control.downloads.wait({
      filenameRegex: "automatic-phase-b-chrome",
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
  const target = `127.0.0.1:${port}/automatic-data-sources`;
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
pageurl: ^http://127\\.0\\.0\\.1:${port}/automatic-data-sources$
sourcekind: ^image$
sourceurl: ^data:image/png
into: e2e/automatic-phase-c-chrome/inline.:mimeext:`,
    });
    await cdp.openTab(PORT, pageUrl);
    const completed = await control.downloads.wait({
      filenameRegex: "automatic-phase-c-chrome",
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
  const firstPath = `127.0.0.1:${port}/sources-one`;
  const secondPath = `127.0.0.1:${port}/sources-two`;
  const firstUrl = `http://${firstPath}`;
  const secondUrl = `http://${secondPath}`;
  /** @param {string} pathPart @param {string} expression */
  const evalPage = (pathPart, expression) => cdp.evalInTarget(PORT, pathPart, expression);

  try {
    await Promise.all([
      control.storage.local.set({
        sourcePanelEnabled: true,
        sourcePanelLive: true,
        sourcePanelPreviews: false,
        sourcePanelBackgrounds: false,
        sourcePanelResourceHints: false,
        sourcePanelLinks: false,
      }),
      control.storage.session.set({ sourcePanelOpen: false }),
    ]);
    await control.runtime.reset();
    const firstTab = await control.tabs.create({ url: firstUrl, active: true });
    const firstReady = await control.tabs.wait(
      firstTab.id === undefined ? { urlIncludes: firstPath } : { id: firstTab.id },
    );
    await poll(
      async () =>
        (await evalPage(firstPath, "document.readyState === 'complete'")) === true ? true : null,
      { description: "first Page Sources fixture", ignoreErrors: true },
    );
    const firstTabId = requireValue(
      firstTab.id ?? firstReady.id,
      "Page Sources fixture tab missing",
    );
    await control.tabs.update(firstTabId, { active: true });
    const [discoveryJson] = await Promise.all([
      evalPage(
        firstPath,
        appendImageAndWaitForSourceExpression("/late.png", "late.png", ["second.png", "first.png"]),
      ),
      cdp.triggerAction(PORT, extensionId, firstPath),
    ]);
    const discovery = parseJson(
      discoveryJson,
      objectOf({ initial: arrayOf(decodeString), current: arrayOf(decodeString) }),
    );
    expect(discovery.initial).toEqual(["second.png", "first.png"]);
    expect(discovery.current).toContain("late.png");

    await evalPage(
      firstPath,
      `(() => {
        const rows = [...document.querySelector("#save-in-source-panel").shadowRoot
          .querySelectorAll(".row")];
        const row = rows.find((candidate) => candidate.querySelector(".name")?.textContent === "first.png");
        row?.querySelector(".actions .primary-action")?.click();
        return Boolean(row);
      })()`,
    );
    expect(await waitForDownloadUrl(`http://127.0.0.1:${port}/first.png`)).toMatch(/first\.png$/);

    const secondTab = await control.tabs.create({ url: secondUrl, active: true });
    const secondReady = await control.tabs.wait(
      secondTab.id === undefined ? { urlIncludes: secondPath } : { id: secondTab.id },
    );
    await poll(
      async () =>
        (await evalPage(secondPath, "document.readyState === 'complete'")) === true ? true : null,
      { description: "second Page Sources fixture", ignoreErrors: true },
    );
    const secondTabId = requireValue(
      secondTab.id ?? secondReady.id,
      "second Page Sources fixture tab missing",
    );
    await control.tabs.update(secondTabId, { active: true });
    await poll(
      async () =>
        (await evalPage(
          secondPath,
          "!!document.querySelector('#save-in-source-panel')?.shadowRoot",
        ))
          ? true
          : null,
      { description: "Page Sources restored on activated tab", ignoreErrors: true },
    );
  } finally {
    await Promise.all([
      control.storage.session.set({ sourcePanelOpen: false }),
      control.storage.local.set({ sourcePanelEnabled: false }),
    ]);
    const fixtureIds = (await control.tabs.query())
      .filter((tab) => tab.url?.includes(`127.0.0.1:${port}/sources-`))
      .map((tab) => tab.id)
      .filter((id) => id !== undefined);
    if (fixtureIds.length) await control.tabs.remove(fixtureIds);
    await control.runtime.reset();
    await closeLocal(server);
  }
});

registerSharedBrowserCases({
  control,
  evaluate: evalSW,
  evaluateOptions: evalOptions,
  evaluatePage: (target, expression) => cdp.evalInTarget(PORT, target, expression),
  waitForDownloads,
  waitForLog,
  downloadDir: () => DOWNLOADS,
  browserLabel: "chrome",
  browserProcess: () => proc,
  routingContent: "routed content",
  symlinkSupported: false,
  failedDownloadFilename: "si-unreachable.bin",
  afterFailedDownload: async () => {
    const requested = (await control.logs.get()).filter(
      (entry) =>
        entry.message === "download requested" && String(entry.data).includes("si-unreachable"),
    );
    expect(requested.length).toBeGreaterThanOrEqual(1);
  },
  // Repeated CDP attachments can leave a reloaded Chrome extension page
  // unevaluable even after Page.reload acknowledges the navigation.
  reloadOptions: () =>
    cdp.replaceTab(
      PORT,
      "options.html",
      `chrome-extension://${extensionId}/src/options/options.html`,
    ),
});

test("history and the debug log record a self-contained download", async () => {
  const [beforeHistory, beforeLog] = await Promise.all([control.history.get(), control.logs.get()]);
  await control.background.startDownload({
    content: "history e2e content",
    suggestedFilename: "history-e2e.txt",
    pageUrl: "https://example.com/",
  });
  await waitForDownloads("history-e2e");

  const [history, log] = await Promise.all([control.history.get(), control.logs.get()]);
  const matchingHistory = history.filter((entry) =>
    String(entry.finalFullPath).includes("history-e2e"),
  );
  const matchingRequests = log
    .slice(beforeLog.length)
    .filter(
      (entry) =>
        entry.message === "download requested" &&
        JSON.stringify(entry.data).includes("history-e2e"),
    );

  expect(history.length).toBeGreaterThan(beforeHistory.length);
  expect(matchingHistory).toHaveLength(1);
  expect(matchingRequests).toHaveLength(1);
});
