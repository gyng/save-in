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
import { createE2EControlClient } from "./control-client.mjs";
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
} from "./helpers.mjs";

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
/** @type {import("./helpers.mjs").E2EResourceScope | undefined} */
let resourceScope;
/** @type {ReturnType<typeof createHarnessSession> | undefined} */
let harness;
const FIRST_INSTALL_TEST = "first install starts with a focused welcome";
const control = createE2EControlClient({
  callFunction: (functionDeclaration, args, timeoutMs) =>
    cdp.callFunctionInTarget(PORT, "options.html", functionDeclaration, args, timeoutMs),
});

/** @param {string} expr @returns {Promise<any>} */
const rawEvalOptions = (expr) => cdp.evalInTarget(PORT, "options.html", expr);
const reloadOptionsPage = async () => {
  const reloaded = await cdp.reloadTargets(PORT, "options.html");
  if (reloaded === 0) {
    await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  }
  await poll(
    async () =>
      (await rawEvalOptions(`document.readyState === "complete" &&
        Boolean(chrome.runtime?.id) &&
        Boolean(document.querySelector("#autocomplete-paths")) &&
        document.querySelector("#paths")?.getAttribute("aria-busy") === "false" &&
        document.querySelector("#filenamePatterns")?.getAttribute("aria-busy") === "false"`))
        ? true
        : null,
    { description: "reloaded Chrome options page", ignoreErrors: true },
  );
};
const optionsPage = createLazyPageEvaluator({
  evaluate: rawEvalOptions,
  prepare: reloadOptionsPage,
});
const evalOptions = optionsPage.evaluate;
// App control travels through production runtime messages from an extension
// page. Raw worker evaluation remains only for worker-specific assertions.
/** @param {string} expr @returns {Promise<any>} */
const evalSW = (expr) => rawEvalOptions(inBackgroundContext(expr));
/** @param {string} expr @returns {Promise<any>} */
const evalWorker = (expr) => cdp.evalInServiceWorker(PORT, extensionId, expr);
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
  /** @type {Record<string, any>} */
  const report = {
    testName,
    durationMs,
    capturedAt: new Date().toISOString(),
    runId: process.env.E2E_RUN_ID,
    browser: { executable: browserPath, version: browserVersion },
  };
  try {
    report.targets = await cdp.listTargets(PORT);
    report.options = JSON.parse(
      await evalOptions(`JSON.stringify({
        url: location.href,
        title: document.title,
        active: document.activeElement?.outerHTML,
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      })`),
    );
    fs.writeFileSync(`${prefix}.html`, await evalOptions(`document.documentElement.outerHTML`));
    const [activeTab] = /** @type {any[]} */ (
      await control.tabs.query({ active: true, currentWindow: true })
    );
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

const startSourcePanelServer = async () => {
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": SOURCE_PNG.length });
      res.end(SOURCE_PNG);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>Page Sources e2e</title>
      <img src="/first.png" alt="first"><img src="/second.png" alt="second">`);
  });
  return { server, port: await listenLocal(server) };
};

/** @param {string} regex @param {number} [deadlineMs] @returns {Promise<any[]>} */
const waitForDownloads = async (regex, deadlineMs = 8000) =>
  /** @type {any[]} */ (
    await control.downloads.wait({ filenameRegex: regex, timeoutMs: deadlineMs })
  );

/** @param {string} url @returns {Promise<string>} */
const waitForDownloadUrl = async (url) => {
  const rows = /** @type {any[]} */ (await control.downloads.wait({ url }));
  return path.basename(rows.at(-1).filename);
};

/** @param {string} url @returns {Promise<string>} */
const downloadUsingBrowserFilename = async (url) => {
  await control.tabs.create({ url });
  return waitForDownloadUrl(url);
};

/** @param {number} baseline @param {string[]} messages @param {number} [deadlineMs] */
const waitForLog = async (baseline, messages, deadlineMs = 8000) =>
  /** @type {any[]} */ (await control.logs.wait({ baseline, messages, timeoutMs: deadlineMs }));

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
    await poll(
      async () => {
        const state = JSON.parse(
          await rawEvalOptions(`JSON.stringify({
            ready: document.readyState,
            extensionId: globalThis.chrome?.runtime?.id,
            hasStorage: Boolean(globalThis.chrome?.storage?.local),
          })`),
        );
        if (state.ready !== "complete") return null;
        if (state.extensionId !== extensionId || !state.hasStorage) {
          throw new Error(
            `Extension APIs unavailable in options target: ${JSON.stringify({ expectedId: extensionId, ...state })}`,
          );
        }
        return true;
      },
      { description: "options page and extension APIs" },
    );
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
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, "Chrome E2E case cleanup failed");
});

test("first install starts with a focused welcome", async () => {
  const welcome = await poll(
    async () => {
      const state = JSON.parse(
        await evalOptions(`JSON.stringify({
          open: document.querySelector("#welcome-dialog")?.open === true,
          title: document.querySelector("#welcome-title")?.textContent,
          steps: [...document.querySelectorAll(".welcome-steps li")].map((item) => item.textContent),
          status: document.querySelector("#lastSavedAt")?.textContent,
        })`),
      );
      return state.open ? state : null;
    },
    { description: "first-install welcome dialog" },
  );
  expect(welcome).toMatchObject({
    title: "Welcome to Save In",
    status: "Just now",
  });
  expect(welcome.steps).toHaveLength(3);

  await evalOptions(`document.querySelector(".welcome-permissions").click()`);
  const permissions = await poll(
    async () => {
      const state = JSON.parse(
        await evalOptions(`chrome.storage.local.get("welcomePendingVersion").then((stored) =>
          JSON.stringify({
            aboutOpen: document.querySelector("#about-dialog")?.open === true,
            welcomeOpen: document.querySelector("#welcome-dialog")?.open === true,
            pending: stored.welcomePendingVersion,
          }))`),
      );
      return state.aboutOpen && state.welcomeOpen ? state : null;
    },
    { description: "permission explanation over welcome" },
  );
  expect(permissions.pending).toBe(1);
  await evalOptions(`document.querySelector("#about-dialog .about-close").click()`);
  await poll(
    async () =>
      (await evalOptions(
        `document.querySelector("#welcome-dialog")?.open === true &&
          document.activeElement === document.querySelector(".welcome-permissions")`,
      )) === true
        ? true
        : null,
    { description: "welcome focus after permission explanation" },
  );

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
    { description: "welcome dismissal" },
  );
});

test("option search shows detailed locations and navigates indexed actions", async () => {
  await evalOptions(`document.querySelector(".welcome-accept")?.click()`);
  const result = JSON.parse(
    await evalOptions(`JSON.stringify((() => {
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
    })())`),
  );
  expect(result).toMatchObject({
    label: "Send test",
    location: "Advanced › External integrations › Webhooks",
    fullLocation: "Advanced › External integrations › Webhooks",
  });
  expect(result.resultsWidth).toBeGreaterThan(result.inputWidth);

  await evalOptions(`document.querySelector("#option-search-results [role=option]").click()`);
  await poll(
    async () =>
      (await evalOptions(
        `document.activeElement === document.querySelector("#webhookUrl") &&
          document.querySelector('[role=tab][aria-selected="true"]')?.textContent === "Advanced"`,
      )) === true
        ? true
        : null,
    { description: "search action navigation" },
  );
});

test("service worker initialises cleanly", async () => {
  const state = await control.inspect();
  const noObjectUrl = await evalWorker(`typeof URL.createObjectURL !== "function"`);

  expect(state.browser).toBe("CHROME");
  expect(state.capabilities.tabContextMenus).toEqual(expect.any(Boolean));
  expect(state.capabilities).toMatchObject({
    accessKeys: true,
    downloadFilenameSuggestion: true,
    downloadDeltaFilename: true,
    conflictActionPrompt: false,
    downloadRequestHeaders: false,
  });
  expect(state.promptConflictAction).toBe("uniquify");
  // Running in a real service worker, with the MV3 fallbacks in play
  expect(noObjectUrl).toBe(true);
  expect(
    (await control.logs.get()).some((/** @type {any} */ entry) => entry.message === "init failed"),
  ).toBe(false);
});

test("options can select a generated locale and return to the browser default", async () => {
  const choices = JSON.parse(
    await evalOptions(
      `JSON.stringify([...document.querySelectorAll("#uiLocale option")].map((option) => option.value))`,
    ),
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
        const state = JSON.parse(
          await evalOptions(`Promise.all([
            chrome.storage.local.get("uiLocale"),
            Promise.resolve({
              selected: document.querySelector("#uiLocale")?.value,
              marker: globalThis.__saveInE2eLocaleMarker ?? null,
            }),
          ]).then(([stored, page]) => JSON.stringify({ stored: stored.uiLocale, ...page }))`),
        );
        return state.stored === locale && state.selected === locale && state.marker !== marker
          ? true
          : null;
      },
      { description },
    );
  };

  await selectLocale("de", "generated locale selection reload");
  await selectLocale("en", "explicit English selection reload");

  await evalOptions(`chrome.storage.local.set({ uiLocale: "" }).then(() => location.reload())`);
  await poll(async () => (await evalOptions(`document.querySelector("#uiLocale")?.value`)) === "", {
    description: "browser-default locale restore",
  });
  await evalSW(`api.reset().then(() => "browser-default locale restored")`);
});

test("options page works under MV3 CSP with live first-party autocomplete", async () => {
  await poll(
    async () =>
      (await evalOptions(`(() => {
        const ta = document.querySelector("#paths");
        return Boolean(ta && ta.getAttribute("aria-busy") !== "true");
      })()`)) || null,
    { description: "paths editor initialization" },
  );
  await evalOptions(`document.querySelector("#paths-mode-text")?.click()`);
  await poll(
    async () =>
      (await evalOptions(
        `Boolean(document.querySelector("#paths") && !document.querySelector("#paths").hidden)`,
      )) || null,
    { description: "paths text editor activation" },
  );
  await evalOptions(`(() => {
    const ta = document.querySelector("#paths");
    ta.focus();
    ta.value = ":d";
    ta.selectionStart = ta.selectionEnd = 2;
    ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
  })()`);
  const suggestions = await poll(
    async () => {
      const state = JSON.parse(
        await evalOptions(`(() => {
          const dd = document.querySelector("#autocomplete-paths");
          return JSON.stringify({
            open: Boolean(dd && dd.style.display !== "none"),
            text: dd?.textContent || "",
          });
        })()`),
      );
      return state.open && state.text.includes(":date:") ? state.text : null;
    },
    { description: "path variable autocomplete suggestions" },
  );
  const result = JSON.parse(
    await evalOptions(`(async () => {
      const ta = document.querySelector("#paths");
      ta.value = "";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return JSON.stringify({
        form: !!ta,
        hostPermissionGranted: await chrome.permissions.contains({ origins: ["<all_urls>"] }),
        permissionBannerHidden: document.querySelector("#host-permission-banner")?.hidden,
        refererHidden: document.querySelector("#setRefererHeader")?.closest("label")?.hidden,
        nativeBrowserRoutingHidden: document.querySelector("#routeBrowserDownloads")?.closest("label")?.hidden,
        experimentalFirefoxRoutingHidden: document.querySelector("#routeBrowserDownloadsFirefox")?.closest("label")?.hidden,
      });
    })()`),
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

  const result = JSON.parse(
    await evalOptions(`JSON.stringify((() => {
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
    })())`),
  );

  expect(result.duplicateIds).toEqual([]);
  expect(result.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(result.unnamedButtons).toEqual([]);
  expect(result.active.tag).toMatch(/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/);
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
      const overflow = await evalOptions(
        `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
      );
      expect(Number(overflow), `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
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
  const remaining = (await control.dnr.getSessionRules()).map((/** @type {any} */ rule) => rule.id);
  expect(remaining).not.toContain(66_000_001);
});

test("cold start recovers an interrupted in-flight fetch", async () => {
  await runInterruptedTransferRecoveryScenario({
    evaluate: evalSW,
    restartBackground: async () => {
      expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);
      await control.options.all();
    },
    filename: "interrupted-chrome.bin",
  });
});

test("options-save reset message round-trips", async () => {
  expect(await control.runtime.reset()).toEqual({ type: "OK" });
});

test("download completes through the real pipeline with session tracking", async () => {
  await control.background.startDownload({
    content: "e2e smoke test content",
    suggestedFilename: "smoke.txt",
    pageUrl: "https://example.com/",
  });
  const downloads = await waitForDownloads("smoke");
  expect(downloads.some((x) => x.state === "complete")).toBe(true);

  const result = JSON.parse(
    await evalSW(`Promise.all([
      browser.downloads.search({ filenameRegex: "smoke" }),
      browser.storage.session.get(null),
      browser.storage.local.get("save-in-history"),
    ])
    .then(([d, sess, hist]) => {
      const entries = (hist["save-in-history"] || []).filter((e) => (e.finalFullPath || "").includes("smoke"));
      const entry = entries[entries.length - 1] || {};
      const adopted = Object.keys(sess.siDownloads || {}).filter((id) => sess.siDownloads[id].adopted);
      return JSON.stringify({
        state: d[0] && d[0].state,
        adopted,
        pending: sess.siPendingDownloads || 0,
        finalFilenames: sess.siFinalFilenames || {},
        entry: { status: entry.status, hasDownloadId: typeof entry.downloadId === "number", fileSize: entry.fileSize },
      });
    })`),
  );

  expect(result.state).toBe("complete");
  // Adoption is cleared after completion (the record itself lingers in
  // siDownloads for history/retry correlation); the pending counter is balanced
  // back to 0 and the per-URL filename entry was cleaned up (it only lingers
  // across a real service-worker restart, where the cleanup never runs)
  expect(result.adopted).toEqual([]);
  expect(result.pending).toBe(0);
  expect(result.finalFilenames).toEqual({});
  // the history entry recorded completion, the download id, and the file size
  expect(result.entry.status).toBe("complete");
  expect(result.entry.hasDownloadId).toBe(true);
  expect(result.entry.fileSize).toBe("e2e smoke test content".length);

  const file = path.join(DOWNLOADS, "e2e", "smoke.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("e2e smoke test content");
});

test("private context-menu saves leave no extension history or session state", async () => {
  await runPrivateContextScenario({
    evaluate: evalSW,
    waitForDownloads,
    filename: "private-chrome",
  });
});

test("real Incognito activity stays out of routing, history, and automatic saves until opted in", async () => {
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
    { description: "Chrome extension reload after Incognito access change" },
  );
  await evalSW(`api.ready().then(() => true)`);

  await runPrivateBrowserActivityScenario({
    evaluate: evalSW,
    openPrivatePage: async (url) => {
      const opened = JSON.parse(
        await evalSW(`browser.windows.create({ incognito: true, url: ${JSON.stringify(url)} })
          .then((window) => JSON.stringify({ windowId: window.id }))`),
      );
      const tab = JSON.parse(
        await evalSW(`new Promise((resolve, reject) => {
          const timeout = AbortSignal.timeout(8000);
          const check = async () => {
            const [tab] = await browser.tabs.query({ windowId: ${opened.windowId} });
            if (tab?.id != null && tab.status === "complete") {
              resolve(JSON.stringify({ id: tab.id, url: tab.url }));
            } else if (timeout.aborted) reject(new Error("Incognito tab did not load"));
            else requestAnimationFrame(check);
          };
          void check();
        })`),
      );
      const target = `127.0.0.1:${new URL(tab.url).port}/private-browser`;
      return {
        tabId: tab.id,
        target,
        close: () => evalSW(`browser.windows.remove(${opened.windowId})`).then(() => undefined),
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
    evaluate: evalSW,
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
    const download = downloads.find((row) => row.state === "complete");
    expect(download?.id).toEqual(expect.any(Number));
    const notificationId = String(download.id);

    const notification = await poll(
      async () => {
        const calls = await control.background.notificationCalls("get");
        return calls.find((/** @type {any} */ call) => call.id === notificationId) || null;
      },
      { description: "success notification for notification-e2e" },
    );
    expect(notification.message).toContain("notification-e2e");
    const failures = (await control.logs.get())
      .slice(beforeLog)
      .filter((/** @type {any} */ entry) => entry.message === "notification create failed");
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
  const lastUsed = await evalSW(
    `browser.storage.local.set({ lastUsedPath: "e2e/persisted" })
      .then(() => api.reset())
      .then(() => browser.storage.local.get("lastUsedPath"))
      .then((stored) => stored.lastUsedPath)`,
  );
  expect(lastUsed).toBe("e2e/persisted");
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
    await evalSW(`browser.storage.local.set({
      trackBrowserDownloads: true,
      routeBrowserDownloads: true,
      browserDownloadFilter: "*://127.0.0.1/*",
      filenamePatterns: "mime: ^application/octet-stream$\\nreferrerdomain: ^127\\.0\\.0\\.1$\\ninto: browser-routed/:filename:",
    }).then(() => api.reset())`);
    await cdp.openTab(PORT, pageUrl);
    await poll(
      async () =>
        (await cdp.evalInTarget(PORT, target, "!!document.querySelector('#native')")) === true,
      { description: "ordinary download page" },
    );
    await cdp.evalInTarget(PORT, target, "document.querySelector('#native').click(); true");

    const rows = await waitForDownloads("browser-routed.*native\\.bin");
    expect(rows.some((row) => row.state === "complete")).toBe(true);
    const observed = JSON.parse(
      await poll(
        async () => {
          const json = await evalSW(
            `api.history().then((entries) => JSON.stringify(entries.filter((entry) => entry.info?.context === "browser")))`,
          );
          return JSON.parse(json).some((/** @type {any} */ entry) => entry.status === "complete")
            ? json
            : null;
        },
        { description: "ordinary browser download history" },
      ),
    );
    expect(observed.at(-1)).toMatchObject({
      status: "complete",
      finalFullPath: expect.stringContaining("browser-routed"),
      info: { context: "browser" },
    });
  } finally {
    await evalSW(`browser.storage.local.set({
      trackBrowserDownloads: false,
      routeBrowserDownloads: false,
      browserDownloadFilter: "",
      filenamePatterns: "",
    }).then(() => api.reset())`);
    await closeLocal(server);
  }
});

test("paths textarea renders a live menu-tree preview", async () => {
  const preview = await evalOptions(`new Promise((resolve, reject) => {
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
    })`);

  expect(preview).toContain("Dogs!");
  expect(preview).toContain("corgi");
});

test("the paths editor applies changes while drafts stay local", async () => {
  const result = JSON.parse(
    await evalOptions(`(async () => {
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
    })()`),
  );

  expect(result.value).toBe("baseline\nunsaved");
  expect(result.storedPaths).toBe("baseline");
});

test("changing paths is visible after background reinitialisation", async () => {
  const pathCount = await evalSW(
    `browser.storage.local.set({ paths: "alpha\\nbeta\\ngamma\\ndelta\\nepsilon" })
      .then(() => api.reset())
      .then(() => browser.runtime.sendMessage({ type: "OPTIONS" }))
      .then((response) => JSON.stringify(response.body.paths.split("\\n").length))`,
  );
  expect(JSON.parse(pathCount)).toBe(5);
});

test(":counter: advances once per download and persists in storage", async () => {
  await evalSW(`api.resetCounter()
      .then(() => browser.storage.local.set({
        filenamePatterns: "filename: countme\\ninto: counters/:counter:-:filename:",
      }))
      .then(() => api.reset())`);
  for (let i = 0; i < 2; i += 1) {
    await evalSW(`api.startDownload({
      content: "counted-${i}",
      suggestedFilename: "countme.txt",
      pageUrl: "https://example.com/",
    })`);
    const rows = await waitForDownloads(`${i + 1}-countme`);
    expect(rows.some((x) => x.state === "complete")).toBe(true);
  }
  const finalCount = JSON.parse(await evalSW(`api.peekCounter()`));
  // two downloads -> counter advanced exactly twice
  expect(finalCount).toBe(2);
  // and each download's :counter: resolved to its own value
  expect(fs.existsSync(path.join(DOWNLOADS, "e2e", "counters", "1-countme.txt"))).toBe(true);
  expect(fs.existsSync(path.join(DOWNLOADS, "e2e", "counters", "2-countme.txt"))).toBe(true);
});

test("APPLY_CONFIG validates and persists a partial config (#89)", async () => {
  const result = JSON.parse(
    await evalSW(`api.applyConfig({ truncateLength: 99, notifyOnSuccess: false, bogusKey: 1 })
      .then((body) =>
        browser.storage.local
          .get(["truncateLength", "notifyOnSuccess"])
          .then((stored) => JSON.stringify({ body, stored })),
      )`),
  );

  expect(result.body.applied).toEqual({ truncateLength: 99, notifyOnSuccess: false });
  expect(result.body.rejected).toEqual([{ name: "bogusKey", reason: "unknown option" }]);
  // persisted to storage.local, and the unknown key was not written
  expect(result.stored.truncateLength).toBe(99);
  expect(result.stored.notifyOnSuccess).toBe(false);
});

test("message-driven downloads work and never inherit a stale route", async () => {
  // Explicit precondition: a routing rule matching "routeme" is active, and
  // the previous download's routed state is the "last" state a naive merge
  // would inherit. The message download must NOT be renamed/rerouted by it.
  await evalSW(
    `browser.storage.local.set({
      filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
    }).then(() => api.reset())`,
  );

  // v1 handshake: PING negotiates the version + capabilities end-to-end
  const pong = JSON.parse(
    await evalOptions(
      `new Promise((res) => chrome.runtime.sendMessage({ type: "PING" }, (r) => res(JSON.stringify(r))))`,
    ),
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
  expect(JSON.parse(ack)).toEqual({
    type: "DOWNLOAD",
    body: { status: "OK", version: 1, url: "data:text/plain,message%20download" },
  });

  const rows = await waitForDownloads("msg-download");
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("complete");
  // The download kept its own filename and did NOT land under the rule's
  // routed/renamed- destination
  expect(rows[0].filename).toMatch(/msg-download\.txt$/);
  expect(rows[0].filename).not.toMatch(/routed/);
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
    { description: "external caller extension page" },
  );

  await runExternalExtensionScenario({
    evaluate: evalSW,
    sendExternal: (message) =>
      cdp
        .evalInTarget(
          PORT,
          callerId,
          `chrome.runtime.sendMessage(${JSON.stringify(extensionId)}, ${JSON.stringify(message)})
            .then((response) => JSON.stringify(response))`,
        )
        .then(JSON.parse),
    callerId,
    waitForDownloads,
    filename: "external-chrome.bin",
  });
});

test("fetchViaFetch downloads via an offscreen document (Chrome MV3)", async () => {
  await evalSW(`browser.storage.local.set({ filenamePatterns: "", fetchViaFetch: true })
      .then(() => api.reset())
      .then(() => api.startDownload({
        url: "data:text/plain,via%20fetch%20content",
        suggestedFilename: "viafetch.txt",
        pageUrl: "https://example.com/",
      })).then(() => "started")`);
  expect((await waitForDownloads("viafetch")).map((x) => x.state)).toEqual(["complete"]);
  const hasOffscreen = await evalSW(`chrome.offscreen.hasDocument()`);
  await evalSW(`api.setOptions({ fetchViaFetch: false })`);
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
  const previous = JSON.parse(
    await evalSW(`Promise.all([
      api.getOption("setRefererHeader"),
      api.getOption("setRefererHeaderFilter"),
    ]).then(([setRefererHeader, setRefererHeaderFilter]) =>
      JSON.stringify({ setRefererHeader, setRefererHeaderFilter }))`),
  );
  try {
    await evalSW(`api.setOptions({
        setRefererHeader: true,
        setRefererHeaderFilter: "*://127.0.0.1/*",
        fetchViaFetch: false,
      }).then(() => api.startDownload({
        url: ${JSON.stringify(url)},
        pageUrl: ${JSON.stringify(expectedReferer)},
        path: "e2e/referer-protected-chrome-:mimeext:-:sha256:.txt",
        suggestedFilename: "referer-protected-chrome.txt",
      }))`);
    const rows = await waitForDownloads("referer-protected-chrome");
    const done = rows.find((row) => row.state === "complete");
    expect(done).toBeTruthy();
    expect(receivedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
    expect(receivedRequests.every(({ referer }) => referer === expectedReferer)).toBe(true);
    expect(done.filename).toContain(`referer-protected-chrome-webp-${expectedHash}`);
    expect(fs.readFileSync(done.filename, "utf8")).toBe(body);
    const remainingRules = await evalSW(
      `chrome.declarativeNetRequest.getSessionRules().then((rules) => rules.map((rule) => rule.id))`,
    );
    expect(remainingRules).not.toContain(66_000_001);
  } finally {
    await evalSW(`api.setOptions(${JSON.stringify({ ...previous, fetchViaFetch: false })})`);
    await closeLocal(server);
  }
});

test("concurrent Referer-protected fetches keep their exact headers serialized", async () => {
  /** @type {Array<{path: string, method: string, referer: string}>} */
  const requests = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const server = http.createServer((req, res) => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    requests.push({
      path: req.url || "",
      method: req.method || "",
      referer: req.headers.referer || "",
    });
    setImmediate(() => {
      activeRequests -= 1;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(req.method === "HEAD" ? undefined : `body:${req.url}`);
    });
  });
  const port = await listenLocal(server);
  const previous = JSON.parse(
    await evalSW(`Promise.all([
      api.getOption("setRefererHeader"),
      api.getOption("setRefererHeaderFilter"),
    ]).then(([setRefererHeader, setRefererHeaderFilter]) =>
      JSON.stringify({ setRefererHeader, setRefererHeaderFilter }))`),
  );
  const fixtures = [
    { name: "referer-concurrent-a", referer: "https://gallery.example/a" },
    { name: "referer-concurrent-b", referer: "https://gallery.example/b" },
  ];

  try {
    await evalSW(`api.setOptions({
      setRefererHeader: true,
      setRefererHeaderFilter: "*://127.0.0.1/*",
      fetchViaFetch: false,
    }).then(() => Promise.all(${JSON.stringify(fixtures)}.map((fixture) => api.startDownload({
      url: "http://127.0.0.1:${port}/" + fixture.name + ".txt",
      pageUrl: fixture.referer,
      path: "e2e/" + fixture.name + "-:mimeext:.txt",
      suggestedFilename: fixture.name + ".txt",
    }))))`);
    await Promise.all(fixtures.map(({ name }) => waitForDownloads(name)));

    expect(maxActiveRequests).toBe(1);
    for (const fixture of fixtures) {
      const matching = requests.filter(({ path: requestPath }) =>
        requestPath.includes(fixture.name),
      );
      expect(matching.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
      expect(matching.every(({ referer }) => referer === fixture.referer)).toBe(true);
    }
    const remainingRules = await evalSW(
      `chrome.declarativeNetRequest.getSessionRules().then((rules) => rules.map((rule) => rule.id))`,
    );
    expect(remainingRules).not.toContain(66_000_001);
  } finally {
    await evalSW(`api.setOptions(${JSON.stringify({ ...previous, fetchViaFetch: false })})`);
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
      { description: "credential fixture cookie" },
    );

    await evalSW(`api.setOptions({ fetchViaFetch: true, includeFetchCredentials: false })
      .then(() => api.startDownload({
        url: "http://127.0.0.1:${redirectPort}/credentials-omitted.bin",
        suggestedFilename: "credentials-omitted.bin",
        pageUrl: ${JSON.stringify(pageUrl)},
      })).then(() => "started")`);
    await waitForDownloads("credentials-omitted", 10000);

    await evalSW(`api.setOptions({ fetchViaFetch: true, includeFetchCredentials: true })
      .then(() => api.startDownload({
        url: "http://127.0.0.1:${redirectPort}/credentials-included.bin",
        suggestedFilename: "credentials-included.bin",
        pageUrl: ${JSON.stringify(pageUrl)},
      })).then(() => "started")`);
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
    await evalSW(`api.setOptions({ fetchViaFetch: false, includeFetchCredentials: false })`);
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
    await evalSW(
      `browser.storage.local.set({ filenamePatterns: "" })
        .then(() => api.reset())
        .then(() => api.startDownload({
          path: "e2e/:sha256:/:sha256full:",
          url: "http://127.0.0.1:${serverPort}/hashme.bin",
          suggestedFilename: "hashme.bin",
          pageUrl: "http://127.0.0.1:${serverPort}/",
        })).then(() => "started")`,
    );

    const rows = await waitForDownloads(expectedHash, 10000);
    const done = rows.find((r) => r.state === "complete");
    expect(done).toBeTruthy();

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
    "webhookIncludePageUrl",
    "webhookIncludePageTitle",
    "webhookIncludeSelectionText",
  ];
  const previous = JSON.parse(
    await evalSW(`browser.storage.local.get(${JSON.stringify(keys)})
      .then((stored) => JSON.stringify(stored))`),
  );
  const missing = keys.filter((key) => !(key in previous));

  try {
    await evalSW(`api.setOptions({
      webhookEnabled: true,
      webhookUrl: "https://webhook.invalid/save?token=secret",
      webhookIncludePageUrl: true,
      webhookIncludePageTitle: false,
      webhookIncludeSelectionText: false,
    })`);
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
    await evalSW(`api.startDownload({
      content: "webhook e2e content",
      suggestedFilename: "webhook-e2e.txt",
      pageUrl: "https://page.example/webhook-source",
    }).then(() => "started")`);
    await waitForDownloads("webhook-e2e");
    const calls = await poll(
      async () => {
        const rows = JSON.parse(
          await evalWorker(`JSON.stringify(globalThis.__saveInE2EWebhookCalls || [])`),
        );
        return rows.length === 1 ? rows : null;
      },
      { description: "webhook delivery" },
    );
    expect(calls[0]).toMatchObject({
      input: "https://webhook.invalid/save?token=secret",
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(calls[0].body)).toMatchObject({
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
    await evalSW(`Promise.all([
      browser.storage.local.set(${JSON.stringify(previous)}),
      browser.storage.local.remove(${JSON.stringify(missing)}),
    ]).then(() => api.reset())`);
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
    const stored = await evalSW(
      `browser.storage.local.get("promptOnShift").then((o) => JSON.stringify(o.promptOnShift))`,
    );
    expect(JSON.parse(stored)).toBe(false);

    // ...and survives a simulated service-worker restart
    const afterReset = await evalSW(
      `api.reset().then(() => api.getOption("promptOnShift")).then(JSON.stringify)`,
    );
    expect(JSON.parse(afterReset)).toBe(false);
  } finally {
    await evalOptions(`(async () => {
      const cb = document.querySelector("#promptOnShift");
      const stored = ${localStorageValue("promptOnShift", true)};
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      await stored;
      return "restored";
    })()`);
    await evalSW(`api.reset().then(() => "reset")`);
  }
});

test("removing option keys restores live defaults before reset acknowledgement", async () => {
  try {
    await evalSW(`browser.storage.local.set({ promptOnShift: false })
      .then(() => api.reset())
      .then(() => api.getOption("promptOnShift"))
      .then(JSON.stringify)`);

    const result = JSON.parse(
      await evalOptions(`(async () => {
        await chrome.storage.local.remove("promptOnShift");
        const response = await chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" });
        return JSON.stringify({ response, stored: await chrome.storage.local.get("promptOnShift") });
      })()`),
    );

    expect(result.response).toEqual({ type: "OK" });
    expect(result.stored).toEqual({});
    expect(JSON.parse(await evalSW(`api.getOption("promptOnShift").then(JSON.stringify)`))).toBe(
      true,
    );
  } finally {
    await evalSW(`browser.storage.local.set({ promptOnShift: true })
      .then(() => api.reset())
      .then(() => "restored")`);
  }
});

test("alt+click on a real page saves the image through the content script", async () => {
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
      res.end('<html><body><img id="img" src="/pic.png"></body></html>');
    }
  });
  const serverPort = await listenLocal(server);
  const pageUrl = `http://127.0.0.1:${serverPort}/`;
  const targetUrl = `127.0.0.1:${serverPort}`;
  const previousContentClickToSave = await evalSW(`api.getOption("contentClickToSave")`);
  const previousContentClickToSaveCombo = await evalSW(`api.getOption("contentClickToSaveCombo")`);

  try {
    await evalSW(
      `browser.storage.local.set({ contentClickToSave: true, contentClickToSaveCombo: 18 })
        .then(() => api.reset())
        .then(() => "enabled")`,
    );

    await cdp.openTab(PORT, pageUrl);
    await poll(
      async () =>
        (await cdp.evalInTarget(PORT, targetUrl, "!!document.getElementById('img')")) === true,
      { description: "content page image" },
    );
    await evalSW(`browser.tabs.query({}).then((tabs) => {
      const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(targetUrl)}));
      if (!tab?.id) throw new Error("click-to-save fixture tab missing");
      return browser.tabs.update(tab.id, { active: true });
    }).then(() => "activated")`);

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
    const syntheticDownloads = JSON.parse(
      await evalSW(
        `browser.downloads.search({}).then((items) => JSON.stringify(items
          .filter((item) => item.url === ${JSON.stringify(`${pageUrl}pic.png`)})))`,
      ),
    );
    expect(syntheticDownloads).toHaveLength(0);

    // The page-generated attempt above is rejected. Dispatch real input through
    // the browser to prove the configured gesture still works.
    const target = JSON.parse(
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
      // eslint-disable-next-line no-console -- emitted only when the e2e assertion is about to fail
      console.log(
        "DIAG:",
        await evalSW(
          `Promise.all([api.logs(), browser.downloads.search({}), browser.storage.local.get("contentClickToSave")])
            .then(([log, d, o]) => JSON.stringify({
              log: log.slice(-5),
              downloads: d.map((x) => x.filename.slice(-30)),
              option: o,
            }))`,
        ),
      );
    }

    expect(download).toHaveLength(1);
    expect(download[0].state).toBe("complete");
    expect(fs.readFileSync(download[0].filename)).toEqual(png);
  } finally {
    try {
      await evalSW(`browser.storage.local
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
  const target = `127.0.0.1:${port}/automatic-sources`;
  const pageUrl = `http://${target}`;
  const previous = JSON.parse(
    await evalSW(`browser.storage.local.get([
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
    await evalSW(`browser.storage.local.set({
      autoDownloadEnabled: true,
      autoDownloadLive: true,
      autoDownloadMaxPerPage: 3,
      filenamePatterns: ${JSON.stringify(
        `url: .*
into: e2e/ordinary-should-not-match/

context: ^auto$
pageurl: ^http://127\\.0\\.0\\.1:${port}/automatic-sources$
sourcekind: ^image$
sourceurl: \\.png$
into: e2e/automatic-chrome/:filename:`,
      )},
    }).then(() => api.reset()).then(() => "enabled")`);
    await cdp.openTab(PORT, pageUrl);
    const initial = await poll(
      async () => {
        const rows = JSON.parse(
          await evalSW(`browser.downloads.search({ filenameRegex: "automatic-chrome" })
            .then((items) => JSON.stringify(items.map(({ state, filename, url }) => ({ state, filename, url }))))`),
        );
        return rows.filter((/** @type {any} */ row) => row.state === "complete").length === 2
          ? rows
          : null;
      },
      { timeoutMs: 10000, description: "initial automatic Page Sources downloads" },
    );
    expect(initial.filter((/** @type {any} */ row) => row.state === "complete")).toHaveLength(2);
    expect(
      initial.every(
        (/** @type {any} */ row) => !row.filename.includes("ordinary-should-not-match"),
      ),
    ).toBe(true);

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
    const rows = JSON.parse(
      await evalSW(`browser.downloads.search({}).then((items) => JSON.stringify(items.filter(
        (item) => item.url === "http://127.0.0.1:${port}/over-limit.png"
      )))`),
    );
    expect(rows).toHaveLength(0);
  } finally {
    await evalSW(`Promise.all([
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
  const firstPath = `127.0.0.1:${port}/sources-one`;
  const secondPath = `127.0.0.1:${port}/sources-two`;
  const firstUrl = `http://${firstPath}`;
  const secondUrl = `http://${secondPath}`;
  /** @param {string} pathPart @param {string} expression */
  const evalPage = (pathPart, expression) => cdp.evalInTarget(PORT, pathPart, expression);

  try {
    await evalSW(`Promise.all([
      browser.storage.local.set({
        sourcePanelEnabled: true,
        sourcePanelLive: true,
        sourcePanelPreviews: false,
        sourcePanelBackgrounds: false,
        sourcePanelResourceHints: false,
        sourcePanelLinks: false,
      }),
      browser.storage.session.set({ sourcePanelOpen: false }),
    ]).then(() => api.reset()).then(() => "enabled")`);
    await cdp.openTab(PORT, firstUrl);
    await poll(
      async () =>
        (await evalPage(firstPath, "document.readyState === 'complete'")) === true ? true : null,
      { description: "first Page Sources fixture" },
    );
    await evalSW(`browser.tabs.query({}).then(async (tabs) => {
      const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(firstPath)}));
      if (!tab?.id) throw new Error("Page Sources fixture tab missing");
      await browser.tabs.update(tab.id, { active: true });
      return "activated";
    })`);
    const [discoveryJson] = await Promise.all([
      evalPage(
        firstPath,
        appendImageAndWaitForSourceExpression("/late.png", "late.png", ["second.png", "first.png"]),
      ),
      cdp.triggerAction(PORT, extensionId, firstPath),
    ]);
    const discovery = JSON.parse(discoveryJson);
    expect(discovery.initial).toEqual(["second.png", "first.png"]);
    expect(discovery.current).toContain("late.png");

    await evalPage(
      firstPath,
      `(() => {
        const rows = [...document.querySelector("#save-in-source-panel").shadowRoot
          .querySelectorAll(".row")];
        const row = rows.find((candidate) => candidate.querySelector(".name")?.textContent === "first.png");
        row?.querySelector(".actions button:nth-child(2)")?.click();
        return Boolean(row);
      })()`,
    );
    expect(await waitForDownloadUrl(`http://127.0.0.1:${port}/first.png`)).toMatch(/first\.png$/);

    await cdp.openTab(PORT, secondUrl);
    await poll(
      async () =>
        (await evalPage(secondPath, "document.readyState === 'complete'")) === true ? true : null,
      { description: "second Page Sources fixture" },
    );
    await evalSW(`browser.tabs.query({}).then((tabs) => {
      const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(secondPath)}));
      if (!tab?.id) throw new Error("second Page Sources fixture tab missing");
      return browser.tabs.update(tab.id, { active: true });
    }).then(() => "activated")`);
    await poll(
      async () =>
        (await evalPage(
          secondPath,
          "!!document.querySelector('#save-in-source-panel')?.shadowRoot",
        ))
          ? true
          : null,
      { description: "Page Sources restored on activated tab" },
    );
  } finally {
    await evalSW(`Promise.all([
      browser.storage.session.set({ sourcePanelOpen: false }),
      browser.storage.local.set({ sourcePanelEnabled: false }),
      browser.tabs.query({}).then((tabs) => browser.tabs.remove(tabs.filter((tab) =>
        tab.url?.includes(${JSON.stringify(`127.0.0.1:${port}/sources-`)})
      ).map((tab) => tab.id).filter((id) => id != null))),
    ]).then(() => api.reset()).then(() => "cleaned")`);
    await closeLocal(server);
  }
});

registerSharedBrowserCases({
  control,
  evaluate: evalSW,
  evaluateOptions: evalOptions,
  waitForDownloads,
  waitForLog,
  downloadDir: () => DOWNLOADS,
  browserLabel: "chrome",
  routingContent: "routed content",
  symlinkSupported: false,
  failedDownloadFilename: "si-unreachable.bin",
  afterFailedDownload: async () => {
    const requested = JSON.parse(
      await evalSW(
        `api.logs().then((log) => JSON.stringify(
          log.filter((entry) => entry.message === "download requested" && String(entry.data).includes("si-unreachable"))
        ))`,
      ),
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
  const before = JSON.parse(
    await evalSW(`Promise.all([api.history(), api.logs()]).then(([history, log]) => JSON.stringify({
      history: history.length,
      log: log.length,
    }))`),
  );
  await evalSW(`api.startDownload({
    content: "history e2e content",
    suggestedFilename: "history-e2e.txt",
    pageUrl: "https://example.com/",
  }).then(() => "started")`);
  await waitForDownloads("history-e2e");

  const records = JSON.parse(
    await evalSW(`Promise.all([api.history(), api.logs()]).then(([history, log]) => JSON.stringify({
      history: history.length,
      matchingHistory: history.filter((entry) => String(entry.finalFullPath).includes("history-e2e")).length,
      matchingRequests: log.slice(${before.log}).filter((entry) =>
        entry.message === "download requested" && JSON.stringify(entry.data).includes("history-e2e")
      ).length,
    }))`),
  );

  expect(records.history).toBeGreaterThan(before.history);
  expect(records.matchingHistory).toBe(1);
  expect(records.matchingRequests).toBe(1);
});
