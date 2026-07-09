// Chrome MV3 end-to-end suite: launches an isolated Chrome, loads the
// staged unpacked build over CDP, and drives the real extension. Tests in
// this file are sequential and build on each other's state.

import fs from "fs";
import path from "path";

import cdp from "../scripts/lib/cdp.js";
import chrome from "../scripts/lib/chrome.js";

const PORT = 9377;
const PROFILE = path.join(chrome.ROOT, "dist", "e2e-profile");
const DOWNLOADS = path.join(PROFILE, "downloads");

let proc;
let extensionId;

const evalSW = (expr, wake) => cdp.evalInServiceWorker(PORT, extensionId, expr, wake);
const evalOptions = (expr) => cdp.evalInTarget(PORT, "options.html", expr);

beforeAll(async () => {
  chrome.stageBuild();
  ({ proc, extensionId } = await chrome.launch({
    port: PORT,
    profileDir: PROFILE,
    downloadDir: DOWNLOADS,
    fresh: true,
  }));
  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  await cdp.sleep(2000);
});

afterAll(() => {
  if (proc) proc.kill();
});

test("service worker initialises cleanly", async () => {
  const state = JSON.parse(
    await evalSW(`window.ready.then(() => JSON.stringify({
      browser: CURRENT_BROWSER,
      pathErrors: window.optionErrors.paths.length,
      patternErrors: window.optionErrors.filenamePatterns.length,
      menuCount: Object.keys(Menus.pathMappings).length,
      noObjectUrl: typeof URL.createObjectURL === "undefined",
      hasDnr: typeof chrome.declarativeNetRequest === "object",
    }))`),
  );

  expect(state.browser).toBe("CHROME");
  expect(state.pathErrors).toBe(0);
  expect(state.patternErrors).toBe(0);
  expect(state.menuCount).toBeGreaterThan(0);
  // Running in a real service worker, with the MV3 fallbacks in play
  expect(state.noObjectUrl).toBe(true);
  expect(state.hasDnr).toBe(true);
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
      return JSON.stringify({ form: !!ta, open, suggestions });
    })()`),
  );

  expect(result.form).toBe(true);
  expect(result.open).toBe(true);
  expect(result.suggestions).toContain(":date:");
});

test("WAKE_WARM prewarm round-trips", async () => {
  const response = await evalOptions(
    `new Promise((res) => chrome.runtime.sendMessage({ type: "WAKE_WARM" }, (r) => res(JSON.stringify(r))))`,
  );
  expect(JSON.parse(response)).toEqual({ type: "OK" });
});

test("options-save reset message round-trips", async () => {
  const response = await evalOptions(
    `new Promise((res) => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" }, (r) => res(JSON.stringify(r))))`,
  );
  expect(JSON.parse(response)).toEqual({ type: "OK" });
});

test("download completes through the real pipeline with session tracking", async () => {
  const result = JSON.parse(
    await evalSW(`window.ready.then(() => {
      requestedDownloadFlag = true;
      return Download.renameAndDownload({
        path: new Path.Path("e2e"),
        scratch: {},
        info: {
          url: Download.makeObjectUrl("e2e smoke test content"),
          suggestedFilename: "smoke.txt",
          pageUrl: "https://example.com/",
          modifiers: [],
        },
      });
    })
    .then(() => new Promise(r => setTimeout(r, 2500)))
    .then(() => Promise.all([
      browser.downloads.search({ filenameRegex: "smoke" }),
      browser.storage.session.get(null),
    ]))
    .then(([d, sess]) => JSON.stringify({
      state: d[0] && d[0].state,
      tracked: sess.siTrackedDownloads || [],
      pending: sess.siPendingDownload,
      finalFilename: sess.siFinalFilename,
    }))`),
  );

  expect(result.state).toBe("complete");
  // Untracked again after completion; the persisted filename remains for
  // service-worker-restart recovery
  expect(result.tracked).toEqual([]);
  expect(result.pending).toBe(false);
  expect(result.finalFilename).toBe("e2e/smoke.txt");

  const file = path.join(DOWNLOADS, "e2e", "smoke.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("e2e smoke test content");
});

test("lastUsedPath survives re-initialisation", async () => {
  const lastUsed = await evalSW(
    `browser.storage.local.set({ lastUsedPath: "e2e/persisted" })
      .then(() => window.reset())
      .then(() => String(lastUsedPath))`,
  );
  expect(lastUsed).toBe("e2e/persisted");
});

test("referer option creates a declarativeNetRequest session rule", async () => {
  const rules = JSON.parse(
    await evalSW(`(() => {
      options.setRefererHeader = true;
      options.setRefererHeaderFilter = "*://i.pximg.net/*";
      return Headers.prepareReferer({
        info: {
          url: "https://i.pximg.net/img/e2e.png",
          pageUrl: "https://www.pixiv.net/artworks/1",
        },
      })
      .then(() => chrome.declarativeNetRequest.getSessionRules())
      .then((r) => JSON.stringify(r.map((rule) => rule.action.requestHeaders[0].value)));
    })()`),
  );
  expect(rules).toEqual(["https://www.pixiv.net/artworks/1"]);
});

test("changing the paths option rebuilds the context menus", async () => {
  const menuCount = await evalSW(
    `browser.storage.local.set({ paths: "alpha\\nbeta\\ngamma\\ndelta\\nepsilon" })
      .then(() => window.reset())
      .then(() => JSON.stringify(Object.keys(Menus.pathMappings).length))`,
  );
  expect(JSON.parse(menuCount)).toBe(5);
});

test("routing rules rename and route the download", async () => {
  const states = JSON.parse(
    await evalSW(`browser.storage.local.set({
      filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
    })
      .then(() => window.reset())
      .then(() => {
        requestedDownloadFlag = true;
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            url: Download.makeObjectUrl("routed content"),
            suggestedFilename: "routeme.txt",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      })
      .then(() => new Promise(r => setTimeout(r, 2000)))
      .then(() => browser.downloads.search({ filenameRegex: "renamed-routeme" }))
      .then((d) => JSON.stringify(d.map((x) => x.state)))`),
  );
  expect(states).toEqual(["complete"]);

  const file = path.join(DOWNLOADS, "e2e", "routed", "renamed-routeme.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("routed content");
});

test("message-driven downloads work and never inherit a stale route", async () => {
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
  expect(JSON.parse(ack)).toEqual({ type: "DOWNLOAD", body: { status: "OK" } });

  const states = JSON.parse(
    await evalSW(
      `new Promise(r => setTimeout(r, 2000))
        .then(() => browser.downloads.search({ filenameRegex: "msg-download" }))
        .then((d) => JSON.stringify(d.map((x) => x.state)))`,
    ),
  );
  expect(states).toEqual(["complete"]);
});

test("fetchViaFetch downloads via fetch -> blob -> data URL", async () => {
  const states = JSON.parse(
    await evalSW(`browser.storage.local.set({ filenamePatterns: "" })
      .then(() => window.reset())
      .then(() => {
        options.fetchViaFetch = true;
        requestedDownloadFlag = true;
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            url: "data:text/plain,via%20fetch%20content",
            suggestedFilename: "viafetch.txt",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      })
      .then(() => new Promise(r => setTimeout(r, 2500)))
      .then(() => {
        options.fetchViaFetch = false;
        return browser.downloads.search({ filenameRegex: "viafetch" });
      })
      .then((d) => JSON.stringify(d.map((x) => x.state)))`),
  );
  expect(states).toEqual(["complete"]);

  const file = path.join(DOWNLOADS, "e2e", "viafetch.txt");
  expect(fs.readFileSync(file, "utf8")).toBe("via fetch content");
});

test("history and the debug log record the session's downloads", async () => {
  const records = JSON.parse(
    await evalSW(`Promise.all([SaveHistory.get(), Log.get()]).then(([history, log]) => JSON.stringify({
      history: history.length,
      logRequested: log.filter((e) => e.message === "download requested").length,
    }))`),
  );

  expect(records.history).toBeGreaterThanOrEqual(3);
  expect(records.logRequested).toBeGreaterThanOrEqual(3);
});
