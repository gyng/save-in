// Automated MV3 smoke test: stages the Chrome build, launches an isolated
// Chrome profile, loads the extension over CDP, and exercises the real
// download pipeline. Run with `yarn e2e:chrome`. Requires Node >= 22.

const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");

const PORT = 9377;
const PROFILE = path.join(chrome.ROOT, "dist", "e2e-profile");
const DOWNLOADS = path.join(PROFILE, "downloads");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const main = async () => {
  console.log("Staging build...");
  chrome.stageBuild();

  console.log("Launching Chrome...");
  const { proc, extensionId } = await chrome.launch({
    port: PORT,
    profileDir: PROFILE,
    downloadDir: DOWNLOADS,
    fresh: true,
  });

  try {
    await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
    await cdp.sleep(2000);

    console.log("Running checks...");

    // 1. Service worker boots and initialises cleanly
    const state = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `window.ready.then(() => JSON.stringify({
        browser: CURRENT_BROWSER,
        pathErrors: window.optionErrors.paths.length,
        patternErrors: window.optionErrors.filenamePatterns.length,
        menuCount: Object.keys(Menus.pathMappings).length,
        noObjectUrl: typeof URL.createObjectURL === "undefined",
        hasDnr: typeof chrome.declarativeNetRequest === "object",
      }))`,
    );
    const s = JSON.parse(state);
    check("service worker init", s.browser === "CHROME");
    check(
      "no option errors",
      s.pathErrors === 0 && s.patternErrors === 0,
      `paths=${s.pathErrors} patterns=${s.patternErrors}`,
    );
    check("path menus built", s.menuCount > 0, `${s.menuCount} items`);
    check("running in real SW (no createObjectURL)", s.noObjectUrl);
    check("declarativeNetRequest available", s.hasDnr);

    // 2. Options page under MV3 CSP, with the first-party autocomplete live
    const optionsPage = await cdp.evalInTarget(
      PORT,
      "options.html",
      `(async () => {
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
          hasDate: suggestions.includes(":date:"),
        });
      })()`,
    );
    const op = JSON.parse(optionsPage);
    check("options page loads under MV3 CSP", op.form);
    check("first-party autocomplete suggests variables", op.open && op.hasDate);

    // 3. WAKE_WARM round trip (content-script service worker prewarm)
    const wake = await cdp.evalInTarget(
      PORT,
      "options.html",
      "new Promise(res => chrome.runtime.sendMessage({type:'WAKE_WARM'}, r => res(JSON.stringify(r))))",
    );
    check("WAKE_WARM responds OK", wake === '{"type":"OK"}', wake);

    // 3. Options-save reset round trip
    const reset = await cdp.evalInTarget(
      PORT,
      "options.html",
      "new Promise(res => chrome.runtime.sendMessage({type:'OPTIONS_LOADED'}, r => res(JSON.stringify(r))))",
    );
    check("options reset responds OK", reset === '{"type":"OK"}', reset);

    // 4. End-to-end download through the real pipeline (data URL fallback,
    //    routing, onDeterminingFilename, session tracking)
    const dl = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `window.ready.then(() => {
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
      }))`,
    );
    const download = JSON.parse(dl);
    check("download completes", download.state === "complete", download.state);
    check(
      "download untracked after completion",
      download.tracked.length === 0 && download.pending === false,
    );
    check(
      "final filename persisted for SW-restart recovery",
      download.finalFilename === "e2e/smoke.txt",
      String(download.finalFilename),
    );

    const file = path.join(DOWNLOADS, "e2e", "smoke.txt");
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    check("file on disk with correct content", content === "e2e smoke test content", file);

    // 5. lastUsedPath persists across re-init (simulated SW restart)
    const lastUsed = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `browser.storage.local.set({ lastUsedPath: "e2e/persisted" })
        .then(() => window.reset())
        .then(() => String(lastUsedPath))`,
    );
    check("lastUsedPath restored on re-init", lastUsed === "e2e/persisted", lastUsed);

    // 6. Referer DNR session rule
    const dnr = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `(() => {
        options.setRefererHeader = true;
        options.setRefererHeaderFilter = "*://i.pximg.net/*";
        return Headers.prepareReferer({
          info: {
            url: "https://i.pximg.net/img/e2e.png",
            pageUrl: "https://www.pixiv.net/artworks/1",
          },
        })
        .then(() => chrome.declarativeNetRequest.getSessionRules())
        .then((rules) => JSON.stringify(
          rules.map((r) => r.action.requestHeaders[0].value)
        ));
      })()`,
    );
    check("referer DNR session rule created", dnr === '["https://www.pixiv.net/artworks/1"]', dnr);

    // 7. Options change rebuilds the context menus (storage -> OPTIONS_LOADED)
    const rebuilt = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `browser.storage.local.set({ paths: "alpha\\nbeta\\ngamma\\ndelta\\nepsilon" })
        .then(() => window.reset())
        .then(() => JSON.stringify(Object.keys(Menus.pathMappings).length))`,
    );
    check("options change rebuilds menus", rebuilt === "5", `${rebuilt} items`);

    // 8. Routing rules: rename + route through the real router/variable stack
    const routed = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `browser.storage.local.set({
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
        .then((d) => JSON.stringify(d.map((x) => x.state)))`,
    );
    check("routing rule renames the download", routed === '["complete"]', routed);

    const routedFile = path.join(DOWNLOADS, "e2e", "routed", "renamed-routeme.txt");
    check(
      "routed file lands in the rule destination",
      fs.existsSync(routedFile) && fs.readFileSync(routedFile, "utf8") === "routed content",
      routedFile,
    );

    // 9. Message-driven download (external extension / click-to-save API path)
    const msgResponse = await cdp.evalInTarget(
      PORT,
      "options.html",
      `new Promise((res) => chrome.runtime.sendMessage({
        type: "DOWNLOAD",
        body: {
          url: "data:text/plain,message%20download",
          info: {
            pageUrl: "https://example.com/",
            srcUrl: "data:text/plain,message%20download",
            suggestedFilename: "msg-download.txt",
          },
        },
      }, (r) => res(JSON.stringify(r))))`,
    );
    check(
      "DOWNLOAD message acknowledged",
      msgResponse === '{"type":"DOWNLOAD","body":{"status":"OK"}}',
      msgResponse,
    );

    const msgDl = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `new Promise(r => setTimeout(r, 2000))
        .then(() => browser.downloads.search({ filenameRegex: "msg-download" }))
        .then((d) => JSON.stringify(d.map((x) => x.state)))`,
    );
    check("message-driven download completes", msgDl === '["complete"]', msgDl);

    // 10. fetchViaFetch pipeline (fetch -> blob -> data URL -> downloads API)
    const viaFetch = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `browser.storage.local.set({ filenamePatterns: "" })
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
        .then((d) => JSON.stringify(d.map((x) => x.state)))`,
    );
    check("fetchViaFetch download completes", viaFetch === '["complete"]', viaFetch);

    const viaFetchFile = path.join(DOWNLOADS, "e2e", "viafetch.txt");
    check(
      "fetchViaFetch file has correct content",
      fs.existsSync(viaFetchFile) && fs.readFileSync(viaFetchFile, "utf8") === "via fetch content",
      viaFetchFile,
    );

    // 11. History and debug log record the session's downloads
    const records = await cdp.evalInServiceWorker(
      PORT,
      extensionId,
      `Promise.all([SaveHistory.get(), Log.get()]).then(([history, log]) => JSON.stringify({
        history: history.length,
        logRequested: log.filter((e) => e.message === "download requested").length,
      }))`,
    );
    const rec = JSON.parse(records);
    check("history records downloads", rec.history >= 3, `${rec.history} entries`);
    check("debug log records downloads", rec.logRequested >= 3, `${rec.logRequested} entries`);
  } finally {
    proc.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error(`\nE2E run failed: ${err.message}`);
  process.exitCode = 1;
});
