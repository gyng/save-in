// Chrome MV3 end-to-end suite: launches an isolated Chrome, loads the
// staged unpacked build over CDP, and drives the real extension. Tests in
// this file are sequential and build on each other's state.

import fs from "fs";
import http from "http";
import path from "path";

import cdp from "../scripts/lib/cdp.js";
import chrome from "../scripts/lib/chrome.js";

const PROFILE = path.join(chrome.ROOT, "dist", "e2e-profile");

let proc;
let extensionId;
let PORT;
let DOWNLOADS;

const evalSW = (expr, wake) => cdp.evalInServiceWorker(PORT, extensionId, expr, wake);
const evalOptions = (expr) => cdp.evalInTarget(PORT, "options.html", expr);

// Polls a service-worker expression that returns a JSON array until it is
// non-empty or the deadline passes, instead of a single fixed sleep
const waitForDownloads = async (regex, deadlineMs = 8000) => {
  const start = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const json = await evalSW(
      `browser.downloads.search({ filenameRegex: ${JSON.stringify(regex)} })
        .then((d) => JSON.stringify(d.map((x) => ({ state: x.state, filename: x.filename }))))`,
    );
    const rows = JSON.parse(json);
    if (rows.some((r) => r.state === "complete") || Date.now() - start > deadlineMs) {
      return rows;
    }
    // eslint-disable-next-line no-await-in-loop
    await cdp.sleep(250);
  }
};

beforeAll(async () => {
  chrome.stageBuild();
  ({
    proc,
    extensionId,
    port: PORT,
    downloadDir: DOWNLOADS,
  } = await chrome.launch({
    profileDir: PROFILE,
    fresh: true,
  }));
  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  await cdp.sleep(2000);
});

afterAll(async () => {
  await chrome.killTree(proc);
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
      Notifier.expectDownload();
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
      .then(() => String(Menus.state.lastUsedPath))`,
  );
  expect(lastUsed).toBe("e2e/persisted");
});

test("referer option creates a declarativeNetRequest session rule", async () => {
  const rules = JSON.parse(
    await evalSW(`(() => {
      options.setRefererHeader = true;
      options.setRefererHeaderFilter = "*://i.pximg.net/*";
      return RequestHeaders.prepareReferer({
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
      apply.click();
      await wait(300);
      const clean = { apply: apply.disabled, discard: discard.disabled };

      // Editing dirties both buttons; the value is not yet persisted
      ta.value = "baseline\\nunsaved";
      ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
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
        Notifier.expectDownload();
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
  // Explicit precondition: a routing rule matching "routeme" is active, and
  // the previous download's routed state is the "last" state a naive merge
  // would inherit. The message download must NOT be renamed/rerouted by it.
  await evalSW(
    `browser.storage.local.set({
      filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
    }).then(() => window.reset())`,
  );

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

  const rows = await waitForDownloads("msg-download");
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("complete");
  // The download kept its own filename and did NOT land under the rule's
  // routed/renamed- destination
  expect(rows[0].filename).toMatch(/msg-download\.txt$/);
  expect(rows[0].filename).not.toMatch(/routed/);
});

test("fetchViaFetch downloads via fetch -> blob -> data URL", async () => {
  const states = JSON.parse(
    await evalSW(`browser.storage.local.set({ filenamePatterns: "" })
      .then(() => window.reset())
      .then(() => {
        options.fetchViaFetch = true;
        Notifier.expectDownload();
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

test("options page autosave persists to storage and survives a restart", async () => {
  // "promptOnShift" is a safe toggle: it never opens a Save As dialog that
  // would stall later downloads, unlike "prompt"
  try {
    await evalOptions(`(() => {
      const cb = document.querySelector("#promptOnShift");
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      return "toggled";
    })()`);
    await cdp.sleep(1000);

    // Persisted to storage.local (not just the in-memory option)...
    const stored = await evalSW(
      `browser.storage.local.get("promptOnShift").then((o) => JSON.stringify(o.promptOnShift))`,
    );
    expect(JSON.parse(stored)).toBe(false);

    // ...and survives a simulated service-worker restart
    const afterReset = await evalSW(
      `window.reset().then(() => JSON.stringify(options.promptOnShift))`,
    );
    expect(JSON.parse(afterReset)).toBe(false);
  } finally {
    await evalOptions(`(() => {
      const cb = document.querySelector("#promptOnShift");
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      return "restored";
    })()`);
    await cdp.sleep(1000);
    await evalSW(`window.reset().then(() => "reset")`);
  }
});

test("shortcut files download with redirect content", async () => {
  const downloads = JSON.parse(
    await evalSW(`window.ready.then(() => {
      Notifier.expectDownload();
      return Download.renameAndDownload({
        path: new Path.Path("e2e"),
        scratch: {},
        info: {
          url: Shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, "https://example.com/target"),
          suggestedFilename: "page-shortcut.html",
          pageUrl: "https://example.com/",
          modifiers: [],
        },
      });
    })
    .then(() => new Promise(r => setTimeout(r, 2000)))
    .then(() => browser.downloads.search({ filenameRegex: "page-shortcut" }))
    .then((d) => JSON.stringify(d.map((x) => ({ state: x.state, filename: x.filename }))))`),
  );
  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  // text/html mime keeps Chrome from rewriting the extension (#161)
  expect(downloads[0].filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
});

test("failed downloads are recorded in the debug log", async () => {
  const entries = JSON.parse(
    await evalSW(`window.ready.then(() => {
      Notifier.expectDownload();
      return Download.renameAndDownload({
        path: new Path.Path("e2e"),
        scratch: {},
        info: {
          // Nothing listens on port 1
          url: "http://127.0.0.1:1/si-unreachable.bin",
          suggestedFilename: "si-unreachable.bin",
          pageUrl: "https://example.com/",
          modifiers: [],
        },
      });
    })
    .then(() => new Promise(r => setTimeout(r, 3000)))
    .then(() => Log.get())
    .then((log) => JSON.stringify(
      log.filter((e) => e.message === "download failed" || e.message === "downloads.download failed")
    ))`),
  );

  // A failure entry exists and references THIS download, not noise from
  // earlier tests
  expect(entries.length).toBeGreaterThanOrEqual(1);
  const requested = JSON.parse(
    await evalSW(
      `Log.get().then((log) => JSON.stringify(
        log.filter((e) => e.message === "download requested" && String(e.data).includes("si-unreachable"))
      ))`,
    ),
  );
  expect(requested.length).toBeGreaterThanOrEqual(1);
});

test("a failed download is retried automatically via background fetch", async () => {
  // First response 500s (browser download fails with SERVER_FAILED), the
  // automatic fetch fallback then gets the 200
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("boom");
    } else {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("recovered content");
    }
  });
  await new Promise((res) => {
    server.listen(8919, "127.0.0.1", res);
  });

  try {
    await evalSW(
      `window.ready.then(() => {
        Notifier.expectDownload();
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            url: "http://127.0.0.1:8919/flaky.bin",
            suggestedFilename: "flaky.bin",
            pageUrl: "http://127.0.0.1:8919/",
            modifiers: [],
          },
        });
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
  await new Promise((res) => {
    server.listen(8917, "127.0.0.1", res);
  });

  try {
    await evalSW(
      `browser.storage.local.set({ contentClickToSave: true })
        .then(() => window.reset())
        .then(() => "enabled")`,
    );

    await cdp.openTab(PORT, "http://127.0.0.1:8917/");
    await cdp.sleep(2000);

    // Synthetic DOM events don't carry keyCode/buttons across the content
    // script's isolated-world boundary: dispatch trusted input via CDP
    const target = JSON.parse(
      await cdp.evalInTarget(
        PORT,
        "127.0.0.1:8917",
        `(() => {
          const rect = document.getElementById("img").getBoundingClientRect();
          return JSON.stringify({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        })()`,
      ),
    );

    await cdp.dispatchInput(PORT, "127.0.0.1:8917", [
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

    const download = JSON.parse(
      await evalSW(
        `new Promise(r => setTimeout(r, 3000))
          .then(() => browser.downloads.search({ filenameRegex: "pic" }))
          .then((d) => JSON.stringify(d.map((x) => ({ state: x.state, filename: x.filename }))))`,
      ),
    );

    if (download.length !== 1) {
      console.log(
        "DIAG:",
        await evalSW(
          `Promise.all([Log.get(), browser.downloads.search({}), browser.storage.local.get("contentClickToSave")])
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
