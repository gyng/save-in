// Chrome MV3 end-to-end suite: launches an isolated Chrome, loads the
// staged unpacked build over CDP, and drives the real extension. Tests in
// this file are sequential and build on each other's state.

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import cdp from "../scripts/lib/cdp.js";
import chrome from "../scripts/lib/chrome.js";
import { listenLocal, poll } from "./helpers.mjs";

const PROFILE = path.join(chrome.ROOT, "dist", "e2e-profile");
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(chrome.ROOT, process.env.E2E_ARTIFACT_DIR)
  : path.join(chrome.ROOT, "dist", "e2e-artifacts");

let proc;
let extensionId;
let PORT;
let DOWNLOADS;
let PROFILE_DIR;
let browserLogPath;
let suiteFailed = false;

const inE2EBridge = (expr) => `(() => {
  const api = globalThis.__SAVE_IN_E2E__;
  return (${expr});
})()`;
const evalSW = (expr) => cdp.evalInServiceWorker(PORT, extensionId, inE2EBridge(expr));
const evalOptions = (expr) => cdp.evalInTarget(PORT, "options.html", expr);
const artifactName = (name) =>
  name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();

const captureFailureArtifacts = async (testName) => {
  const prefix = path.join(ARTIFACTS, `chrome-failure-${artifactName(testName)}`);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const report = { testName, capturedAt: new Date().toISOString() };
  try {
    report.targets = await cdp.listTargets(PORT);
    report.options = JSON.parse(
      await evalOptions(`JSON.stringify({
        url: location.href,
        title: document.title,
        active: document.activeElement?.outerHTML,
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        html: document.documentElement.outerHTML,
      })`),
    );
    const activeUrl = await evalSW(
      `browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.url || "")`,
    );
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
    report.background = JSON.parse(
      await evalSW(`Promise.all([
        api.inspect(), api.logs(), api.history(), browser.storage.local.get(null), browser.storage.session.get(null)
      ]).then(([inspect, logs, history, local, session]) => JSON.stringify({ inspect, logs, history, local, session }))`),
    );
  } catch (error) {
    report.backgroundCaptureError = String(error);
  }
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

// Polls a service-worker expression that returns a JSON array until it is
// non-empty or the deadline passes, instead of a single fixed sleep
const waitForDownloads = (regex, deadlineMs = 8000) =>
  poll(
    async () => {
      const json = await evalSW(
        `browser.downloads.search({ filenameRegex: ${JSON.stringify(regex)} })
        .then((d) => JSON.stringify(d.map((x) => ({ state: x.state, filename: x.filename }))))`,
      );
      const rows = JSON.parse(json);
      return rows.some((r) => r.state === "complete") ? rows : null;
    },
    { timeoutMs: deadlineMs, description: `download matching ${regex}` },
  );

const waitForLog = (predicate, deadlineMs = 8000) =>
  poll(
    async () => {
      const entries = JSON.parse(
        await evalSW(`api.logs().then((log) => JSON.stringify(log.filter(${predicate})))`),
      );
      return entries.length ? entries : null;
    },
    { timeoutMs: deadlineMs, description: "matching debug-log entry" },
  );

beforeAll(async () => {
  ({
    proc,
    extensionId,
    port: PORT,
    downloadDir: DOWNLOADS,
    profileDir: PROFILE_DIR,
    logPath: browserLogPath,
  } = await chrome.launch({
    profileDir: PROFILE,
    fresh: true,
  }));
  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  await poll(
    async () => ((await evalOptions("document.readyState")) === "complete" ? true : null),
    { description: "options page load" },
  );
  // Native notifications are exercised by one focused test below. Keep the
  // rest of the download-heavy suite from submitting Windows toasts.
  await evalSW(`browser.storage.local.set({
    notifyOnSuccess: false,
    notifyOnFailure: false,
    notifyOnRuleMatch: false,
    notifyOnLinkPreferred: false,
  }).then(() => api.reset()).then(() => "notifications suppressed")`);
});

afterAll(async () => {
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
  if (!suiteFailed && browserLogPath) fs.rmSync(browserLogPath, { force: true });
  if (failures.length) throw new AggregateError(failures, "Chrome E2E cleanup failed");
});

afterEach(async ({ task }) => {
  if (task.result?.state === "fail") {
    suiteFailed = true;
    try {
      await captureFailureArtifacts(task.name);
    } catch (error) {
      process.stderr.write(
        `Unable to capture Chrome failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
    }
  }
});

test("service worker initialises cleanly", async () => {
  const state = JSON.parse(
    await evalSW(`api.inspect().then((state) => JSON.stringify({
      ...state,
      noObjectUrl: !state.hasObjectUrl,
    }))`),
  );

  expect(state.browser).toBe("CHROME");
  expect(state.capabilities).toMatchObject({
    tabContextMenus: true,
    accessKeys: true,
    downloadFilenameSuggestion: true,
    downloadDeltaFilename: true,
    conflictActionPrompt: false,
    downloadRequestHeaders: false,
  });
  expect(state.promptConflictAction).toBe("uniquify");
  expect(state.pathErrors).toBe(0);
  expect(state.patternErrors).toBe(0);
  expect(state.menuCount).toBeGreaterThan(0);
  // Running in a real service worker, with the MV3 fallbacks in play
  expect(state.noObjectUrl).toBe(true);
});

test("options can opt into AI localization and explicitly return to English", async () => {
  const choices = JSON.parse(
    await evalOptions(`JSON.stringify([...document.querySelectorAll("#uiLocale option")].map((option) => ({
      value: option.value,
      label: option.textContent,
    })))`),
  );
  expect(choices.filter(({ label }) => label.endsWith("(AI)"))).toHaveLength(10);
  expect(choices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: "en", label: "English" }),
      expect.objectContaining({ value: "zh_TW", label: "繁體中文 (AI)" }),
    ]),
  );

  await evalOptions(`(() => {
    const select = document.querySelector("#uiLocale");
    select.value = "de";
    select.dispatchEvent(new Event("change"));
  })()`);
  await poll(
    async () =>
      (await evalOptions(`document.querySelector("#section-downloads")?.textContent.trim()`)) ===
      "Downloads-Menü",
    { description: "German AI locale reload" },
  );

  await evalOptions(`(() => {
    const select = document.querySelector("#uiLocale");
    select.value = "en";
    select.dispatchEvent(new Event("change"));
  })()`);
  await poll(
    async () =>
      (await evalOptions(`document.querySelector("#section-downloads")?.textContent.trim()`)) ===
      "Downloads menu",
    { description: "explicit English locale reload" },
  );

  await evalOptions(`chrome.storage.local.set({ uiLocale: "" }).then(() => location.reload())`);
  await poll(async () => (await evalOptions(`document.querySelector("#uiLocale")?.value`)) === "", {
    description: "browser-default locale restore",
  });
  await evalSW(`api.reset().then(() => "browser-default locale restored")`);
});

test("options page works under MV3 CSP with live first-party autocomplete", async () => {
  const result = JSON.parse(
    await evalOptions(`(async () => {
      const ta = document.querySelector("#paths");
      ta.focus();
      ta.value = ":d";
      ta.selectionStart = ta.selectionEnd = 2;
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const dd = document.querySelector(".autocomplete-dropdown");
      const open = !!dd && dd.style.display !== "none";
      const suggestions = open ? dd.textContent : "";
      ta.value = "";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return JSON.stringify({
        form: !!ta,
        open,
        suggestions,
        hostPermissionGranted: await chrome.permissions.contains({ origins: ["<all_urls>"] }),
        permissionBannerHidden: document.querySelector("#host-permission-banner")?.hidden,
        refererHidden: document.querySelector("#setRefererHeader")?.closest(".firefox-only")?.hidden,
        nativeBrowserRoutingHidden: document.querySelector("#routeBrowserDownloads")?.closest("label")?.hidden,
        experimentalFirefoxRoutingHidden: document.querySelector("#routeBrowserDownloadsFirefox")?.closest("label")?.hidden,
      });
    })()`),
  );

  expect(result.form).toBe(true);
  expect(result.open).toBe(true);
  expect(result.suggestions).toContain(":date:");
  expect(result.hostPermissionGranted).toBe(true);
  expect(result.permissionBannerHidden).toBe(true);
  expect(result.refererHidden).toBe(true);
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
});

test("WAKE_WARM prewarm round-trips", async () => {
  const response = await evalOptions(
    `new Promise((res) => chrome.runtime.sendMessage({ type: "WAKE_WARM" }, (r) => res(JSON.stringify(r))))`,
  );
  expect(JSON.parse(response)).toEqual({ type: "OK" });
});

test("cold-start messages wait for persisted options", async () => {
  try {
    await evalOptions(`chrome.storage.local.set({ promptOnShift: false })`);
    await evalSW(`api.reset().then(() => "configured")`);
    expect(await cdp.stopServiceWorker(PORT, extensionId)).toBe(true);

    const response = JSON.parse(
      await evalOptions(
        `new Promise((resolve) => chrome.runtime.sendMessage({ type: "OPTIONS" }, (value) => resolve(JSON.stringify(value))))`,
      ),
    );
    expect(response.body.promptOnShift).toBe(false);
  } finally {
    await evalOptions(`chrome.storage.local.set({ promptOnShift: true })`);
    await evalSW(`api.reset().then(() => "restored")`);
  }
});

test("options-save reset message round-trips", async () => {
  const response = await evalOptions(
    `new Promise((res) => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" }, (r) => res(JSON.stringify(r))))`,
  );
  expect(JSON.parse(response)).toEqual({ type: "OK" });
});

test("download completes through the real pipeline with session tracking", async () => {
  await evalSW(`api.startDownload({
      content: "e2e smoke test content",
      suggestedFilename: "smoke.txt",
      pageUrl: "https://example.com/",
    }).then(() => "started")`);
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

test("success notifications are created by the real download listener", async () => {
  try {
    await evalSW(`browser.storage.local.set({ notifyOnSuccess: true, notifyDuration: 0 })
      .then(() => api.reset()).then(() => "configured")`);

    await evalSW(`api.startDownload({
      content: "notification e2e content",
      suggestedFilename: "notification-e2e.txt",
      pageUrl: "https://example.com/",
    }).then(() => "started")`);
    await waitForDownloads("notification-e2e");

    const notifications = await poll(
      async () => {
        const rows = JSON.parse(
          await evalSW(`browser.notifications.getAll().then((rows) => JSON.stringify(rows))`),
        );
        return Object.keys(rows).length ? rows : null;
      },
      { description: "success notification" },
    );
    expect(Object.keys(notifications)).toHaveLength(1);
    const failures = JSON.parse(
      await evalSW(
        `api.logs().then((log) => JSON.stringify(log.filter((e) => e.message === "notification create failed")))`,
      ),
    );
    expect(failures).toEqual([]);
  } finally {
    await evalSW(`browser.notifications.getAll()
      .then((rows) => Promise.all(Object.keys(rows).map((id) => browser.notifications.clear(id))))
      .then(() => browser.storage.local.set({ notifyOnSuccess: false }))
      .then(() => browser.storage.local.remove("notifyDuration"))
      .then(() => api.reset())
      .then(() => "restored")`);
  }
});

test("lastUsedPath survives re-initialisation", async () => {
  const lastUsed = await evalSW(
    `browser.storage.local.set({ lastUsedPath: "e2e/persisted" })
      .then(() => api.reset())
      .then(() => api.menuSnapshot().lastUsedPath)`,
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
      filenamePatterns: "filename: native\\.bin\\ninto: browser-routed/:filename:",
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
          return JSON.parse(json).some((entry) => entry.status === "complete") ? json : null;
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
    server.close();
  }
});

test("paths textarea renders a live menu-tree preview", async () => {
  const items = JSON.parse(
    await evalOptions(`(async () => {
      const ta = document.querySelector("#paths");
      ta.value = "dogs // (alias: Dogs!)\\n>corgi\\n---\\ncats";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      const rows = [...document.querySelectorAll("#menu-preview-tree li")].map((li) => {
        let depth = 0;
        let n = li;
        while ((n = n.parentElement.closest("li"))) depth += 1;
        const title = li.querySelector(".menu-preview-title");
        const dir = li.querySelector(".menu-preview-dir");
        return {
          separator: li.className === "menu-preview-separator",
          title: title ? title.textContent : null,
          dir: dir ? dir.textContent : null,
          depth,
        };
      });
      return JSON.stringify(rows);
    })()`),
  );

  expect(items).toEqual([
    { separator: false, title: "Last Used", dir: null, depth: 0 },
    { separator: true, title: null, dir: null, depth: 0 },
    { separator: false, title: "Dogs!", dir: "dogs", depth: 0 },
    { separator: false, title: "corgi", dir: null, depth: 1 },
    { separator: true, title: null, dir: null, depth: 0 },
    { separator: false, title: "cats", dir: null, depth: 0 },
  ]);
});

test("the paths editor saves manually: Apply/Discard track the dirty state", async () => {
  const result = JSON.parse(
    await evalOptions(`(async () => {
      const ta = document.querySelector("#paths");
      const apply = document.querySelector('[data-apply="paths"]');
      const discard = document.querySelector('[data-discard="paths"]');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      // Establish a clean baseline via Apply
      ta.value = "baseline";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const validationDeadline = Date.now() + 3000;
      while (apply.disabled && Date.now() < validationDeadline) await wait(25);
      apply.click();
      const saveDeadline = Date.now() + 3000;
      while ((!apply.disabled || !discard.disabled) && Date.now() < saveDeadline) await wait(25);
      const clean = { apply: apply.disabled, discard: discard.disabled };

      // Editing dirties both buttons; the value is not yet persisted
      ta.value = "baseline\\nunsaved";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const dirtyValidationDeadline = Date.now() + 3000;
      while (apply.disabled && Date.now() < dirtyValidationDeadline) await wait(25);
      const dirty = { apply: apply.disabled, discard: discard.disabled };
      const stored = await browser.storage.local.get("paths");

      // Discard reverts to the last applied value and re-dims
      discard.click();
      await wait(50);
      const afterDiscard = { value: ta.value, apply: apply.disabled };

      return JSON.stringify({ clean, dirty, storedPaths: stored.paths, afterDiscard });
    })()`),
  );

  expect(result.clean).toEqual({ apply: true, discard: true });
  expect(result.dirty).toEqual({ apply: false, discard: false });
  // The unsaved edit never reached storage
  expect(result.storedPaths).toBe("baseline");
  expect(result.afterDiscard).toEqual({ value: "baseline", apply: true });
});

test("changing the paths option rebuilds the context menus", async () => {
  const menuCount = await evalSW(
    `browser.storage.local.set({ paths: "alpha\\nbeta\\ngamma\\ndelta\\nepsilon" })
      .then(() => api.reset())
      .then(() => JSON.stringify(api.menuSnapshot().count))`,
  );
  expect(JSON.parse(menuCount)).toBe(5);
});

test("routing rules rename and route the download", async () => {
  await evalSW(`browser.storage.local.set({
      filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
    })
      .then(() => api.reset())
      .then(() => api.startDownload({
        content: "routed content",
        suggestedFilename: "routeme.txt",
        pageUrl: "https://example.com/",
      })).then(() => "started")`);
  expect((await waitForDownloads("renamed-routeme")).map((x) => x.state)).toEqual(["complete"]);

  const file = path.join(DOWNLOADS, "e2e", "routed", "renamed-routeme.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("routed content");
});

test(":counter: advances once per download and persists in storage", async () => {
  await evalSW(`api.resetCounter()
      .then(() => browser.storage.local.set({
        filenamePatterns: "filename: countme\\ninto: counters/:counter:-:filename:",
      }))
      .then(() => api.reset())`);
  for (let i = 0; i < 2; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await evalSW(`api.startDownload({
      content: "counted-${i}",
      suggestedFilename: "countme.txt",
      pageUrl: "https://example.com/",
    })`);
    // eslint-disable-next-line no-await-in-loop
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

test("fetchViaFetch downloads via an offscreen document (Chrome MV3)", async () => {
  await evalSW(`browser.storage.local.set({ filenamePatterns: "" })
      .then(() => api.reset())
      .then(() => api.startDownload({
        url: "data:text/plain,via%20fetch%20content",
        suggestedFilename: "viafetch.txt",
        pageUrl: "https://example.com/",
        runtimeOptions: { fetchViaFetch: true },
      })).then(() => "started")`);
  expect((await waitForDownloads("viafetch")).map((x) => x.state)).toEqual(["complete"]);
  const hasOffscreen = await evalSW(`chrome.offscreen.hasDocument()`);
  await evalSW(`api.setOptions({ fetchViaFetch: false })`);
  // the service worker used an offscreen document for the blob object URL
  expect(hasOffscreen).toBe(true);

  const file = path.join(DOWNLOADS, "e2e", "viafetch.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("via fetch content");
});

test("extension fetch credentials are preserved across cross-origin redirects", async () => {
  const protectedRequests = [];
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

    await evalSW(`api.startDownload({
      url: "http://127.0.0.1:${redirectPort}/credentials-omitted.bin",
      suggestedFilename: "credentials-omitted.bin",
      pageUrl: ${JSON.stringify(pageUrl)},
      runtimeOptions: { fetchViaFetch: true, includeFetchCredentials: false },
    }).then(() => "started")`);
    await waitForDownloads("credentials-omitted", 10000);

    await evalSW(`api.startDownload({
      url: "http://127.0.0.1:${redirectPort}/credentials-included.bin",
      suggestedFilename: "credentials-included.bin",
      pageUrl: ${JSON.stringify(pageUrl)},
      runtimeOptions: { fetchViaFetch: true, includeFetchCredentials: true },
    }).then(() => "started")`);
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
    redirectServer.close();
    destinationServer.close();
  }
});

test(":sha256: and :sha256full: hash and save from a single fetch (Chrome MV3)", async () => {
  // The file is routed by its own short and full content hashes. That hash requires the bytes,
  // so the offscreen document fetches once, digests, and the save reuses that
  // same fetch's blob URL — the server must be hit exactly once, not twice.
  const body = "share this fetch once";
  const expectedHash = crypto.createHash("sha256").update(body).digest("hex");
  const expectedShortHash = expectedHash.slice(0, 8);
  let hits = 0;
  const server = http.createServer((req, res) => {
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
    server.close();
  }
});

test("options page autosave persists to storage and survives a restart", async () => {
  // "promptOnShift" is a safe toggle: it never opens a Save As dialog that
  // would stall later downloads, unlike "prompt"
  try {
    await evalOptions(`(async () => {
      const cb = document.querySelector("#promptOnShift");
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 5000;
      for (;;) {
        const stored = await chrome.storage.local.get("promptOnShift");
        if (stored.promptOnShift === false) return "toggled";
        if (Date.now() >= deadline) throw new Error("autosave timeout");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })()`);

    // Persisted to storage.local (not just the in-memory option)...
    const stored = await evalSW(
      `browser.storage.local.get("promptOnShift").then((o) => JSON.stringify(o.promptOnShift))`,
    );
    expect(JSON.parse(stored)).toBe(false);

    // ...and survives a simulated service-worker restart
    const afterReset = await evalSW(
      `api.reset().then(() => JSON.stringify(api.getOption("promptOnShift")))`,
    );
    expect(JSON.parse(afterReset)).toBe(false);
  } finally {
    await evalOptions(`(async () => {
      const cb = document.querySelector("#promptOnShift");
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 5000;
      for (;;) {
        const stored = await chrome.storage.local.get("promptOnShift");
        if (stored.promptOnShift === true) return "restored";
        if (Date.now() >= deadline) throw new Error("autosave restore timeout");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })()`);
    await evalSW(`api.reset().then(() => "reset")`);
  }
});

test("removing option keys restores live defaults before reset acknowledgement", async () => {
  try {
    await evalSW(`browser.storage.local.set({ promptOnShift: false })
      .then(() => api.reset())
      .then(() => JSON.stringify(api.getOption("promptOnShift")))`);

    const result = JSON.parse(
      await evalOptions(`(async () => {
        await chrome.storage.local.remove("promptOnShift");
        const response = await chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" });
        return JSON.stringify({ response, stored: await chrome.storage.local.get("promptOnShift") });
      })()`),
    );

    expect(result.response).toEqual({ type: "OK" });
    expect(result.stored).toEqual({});
    expect(JSON.parse(await evalSW(`JSON.stringify(api.getOption("promptOnShift"))`))).toBe(true);
  } finally {
    await evalSW(`browser.storage.local.set({ promptOnShift: true })
      .then(() => api.reset())
      .then(() => "restored")`);
  }
});

test("shortcut files download with redirect content", async () => {
  await evalSW(`api.startDownload({
      shortcutUrl: "https://example.com/target",
      suggestedFilename: "page-shortcut.html",
      pageUrl: "https://example.com/",
    }).then(() => "started")`);
  const downloads = await waitForDownloads("page-shortcut");
  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  // text/html mime keeps Chrome from rewriting the extension (#161)
  expect(downloads[0].filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
});

test("failed downloads are recorded in the debug log", async () => {
  await evalSW(`api.startDownload({
      url: "http://127.0.0.1:1/si-unreachable.bin",
      suggestedFilename: "si-unreachable.bin",
      pageUrl: "https://example.com/",
    }).then(() => "started")`);
  const entries = await waitForLog(
    `(e) => e.message === "download failed" || e.message === "downloads.download failed"`,
  );

  // A failure entry exists and references THIS download, not noise from
  // earlier tests
  expect(entries.length).toBeGreaterThanOrEqual(1);
  const requested = JSON.parse(
    await evalSW(
      `api.logs().then((log) => JSON.stringify(
        log.filter((e) => e.message === "download requested" && String(e.data).includes("si-unreachable"))
      ))`,
    ),
  );
  expect(requested.length).toBeGreaterThanOrEqual(1);
});

test("a failed download is retried automatically via background fetch", async () => {
  // Abort the first response so the browser reliably reports a network
  // failure. Chrome versions differ on whether an HTTP 500 counts as a
  // completed download, which made this scenario nondeterministic.
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) {
      req.socket.destroy();
    } else {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("recovered content");
    }
  });
  const serverPort = await listenLocal(server);

  try {
    await evalSW(
      `api.startDownload({
        url: "http://127.0.0.1:${serverPort}/flaky.bin",
        suggestedFilename: "flaky.bin",
        pageUrl: "http://127.0.0.1:${serverPort}/",
      }).then(() => "started")`,
    );

    const rows = await waitForDownloads("flaky", 10000);
    expect(rows.some((r) => r.state === "complete")).toBe(true);

    const file = path.join(DOWNLOADS, "e2e", "flaky.bin");
    expect(fs.readFileSync(file, "utf8")).toBe("recovered content");
    // The server really was hit twice: browser download, then fetch retry
    expect(hits).toBeGreaterThanOrEqual(2);
  } finally {
    server.close();
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

  try {
    await evalSW(
      `browser.storage.local.set({ contentClickToSave: true })
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

    // Synthetic DOM events don't carry keyCode/buttons across the content
    // script's isolated-world boundary: dispatch trusted input via CDP
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
    server.close();
  }
});

test("Page Sources discovers, sorts, updates live, and restores across tabs", async () => {
  const { server, port } = await startSourcePanelServer();
  const firstPath = `127.0.0.1:${port}/sources-one`;
  const secondPath = `127.0.0.1:${port}/sources-two`;
  const firstUrl = `http://${firstPath}`;
  const secondUrl = `http://${secondPath}`;
  const evalPage = (pathPart, expression) => cdp.evalInTarget(PORT, pathPart, expression);
  const snapshot = (pathPart) =>
    evalPage(
      pathPart,
      `JSON.stringify({
        names: [...document.querySelector("#save-in-source-panel").shadowRoot.querySelectorAll(".source-link .name")].map((node) => node.textContent),
        sort: document.querySelector("#save-in-source-panel").shadowRoot.querySelector('select[aria-label="Sort sources"]').value,
      })`,
    ).then(JSON.parse);

  try {
    await evalSW(`browser.storage.local.set({
      sourcePanelEnabled: true,
      sourcePanelLive: true,
      sourcePanelPreviews: false,
      sourcePanelBackgrounds: false,
      sourcePanelResourceHints: false,
      sourcePanelLinks: false,
    }).then(() => api.reset()).then(() => "enabled")`);
    await cdp.openTab(PORT, firstUrl);
    await poll(
      async () =>
        (await evalPage(firstPath, "document.readyState === 'complete'")) === true ? true : null,
      { description: "first Page Sources fixture" },
    );
    await evalSW(`browser.tabs.query({}).then(async (tabs) => {
      const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(firstPath)}));
      if (!tab?.id) throw new Error("Page Sources fixture tab missing");
      await browser.storage.session.set({ sourcePanelOpen: true });
      await browser.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
      return "opened";
    })`);
    await poll(
      async () =>
        (await evalPage(firstPath, "!!document.querySelector('#save-in-source-panel')?.shadowRoot"))
          ? true
          : null,
      { description: "Page Sources panel open" },
    );
    await poll(
      async () =>
        (await evalPage(
          firstPath,
          `document.querySelector("#save-in-source-panel").getAnimations().every((animation) => animation.playState === "finished")`,
        )) === true
          ? true
          : null,
      { description: "Page Sources opening animation" },
    );

    const panelLayout = JSON.parse(
      await evalPage(
        firstPath,
        `JSON.stringify((() => {
          const host = document.querySelector("#save-in-source-panel");
          const root = host.shadowRoot;
          const panel = root.querySelector(".panel");
          const hostRect = host.getBoundingClientRect();
          const unnamedButtons = [...root.querySelectorAll("button")].filter((button) =>
            !(button.textContent?.trim() || button.getAttribute("aria-label") || button.title)
          );
          return {
            hostInViewport: hostRect.left >= -1 && hostRect.right <= innerWidth + 1 && hostRect.top >= -1 && hostRect.bottom <= innerHeight + 1,
            hostRect: { left: hostRect.left, right: hostRect.right, top: hostRect.top, bottom: hostRect.bottom },
            viewport: { width: innerWidth, height: innerHeight },
            horizontalOverflow: panel.scrollWidth - panel.clientWidth,
            unnamedButtons: unnamedButtons.length,
            rowTargetHeights: [...root.querySelectorAll(".source-link")].map((link) => link.getBoundingClientRect().height),
            filterLabel: root.querySelector('input[type="search"]')?.getAttribute("aria-label"),
            sortLabel: root.querySelector("select")?.getAttribute("aria-label"),
          };
        })())`,
      ),
    );
    if (!panelLayout.hostInViewport) {
      throw new Error(`Page Sources escaped the viewport: ${JSON.stringify(panelLayout)}`);
    }
    expect(panelLayout.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(panelLayout.unnamedButtons).toBe(0);
    expect(panelLayout.rowTargetHeights.every((height) => height >= 38)).toBe(true);
    expect(panelLayout.filterLabel).toBe("Filter page sources");
    expect(panelLayout.sortLabel).toBe("Sort sources");

    expect((await snapshot(firstPath)).names).toEqual(["second.png", "first.png"]);
    await evalPage(
      firstPath,
      `(() => {
        const root = document.querySelector("#save-in-source-panel").shadowRoot;
        const sort = root.querySelector('select[aria-label="Sort sources"]');
        sort.value = "detected-asc";
        sort.dispatchEvent(new Event("change"));
      })()`,
    );
    expect(await snapshot(firstPath)).toEqual({
      names: ["first.png", "second.png"],
      sort: "detected-asc",
    });

    await evalPage(
      firstPath,
      `(() => {
        const image = document.createElement("img");
        image.src = "/late.png";
        image.alt = "late";
        document.body.append(image);
      })()`,
    );
    await poll(async () => ((await snapshot(firstPath)).names.includes("late.png") ? true : null), {
      description: "live Page Sources discovery",
    });
    await evalPage(
      firstPath,
      `(() => {
        const sort = document.querySelector("#save-in-source-panel").shadowRoot.querySelector('select[aria-label="Sort sources"]');
        sort.value = "detected-desc";
        sort.dispatchEvent(new Event("change"));
      })()`,
    );
    expect((await snapshot(firstPath)).names[0]).toBe("late.png");

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
    server.close();
  }
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
