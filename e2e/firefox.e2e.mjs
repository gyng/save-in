// Firefox end-to-end suite: throwaway profile, temporary install over RDP
// (the about:debugging mechanism), evaluated in the extension's background
// event page. Tests are sequential and build on each other's state.

import fs from "fs";
import http from "http";

import firefox from "../scripts/lib/firefox.js";
import { listenLocal } from "./helpers.mjs";

let session;

const inE2EBridge = (expr) => `(() => {
  const {
    runtime: window, SHORTCUT_TYPES, CURRENT_BROWSER, WEB_EXTENSION_CAPABILITIES,
    Log, SaveHistory, BackgroundState, peekCounter, resetCounter, Notifier,
    Path, Download, Shortcut, menuState, OptionsManagement, options, Messaging
  } = globalThis.__SAVE_IN_E2E__;
  return (${expr});
})()`;
const evalBackground = (expr, timeoutMs) => session.evaluate(inE2EBridge(expr), timeoutMs);

const waitForDownloads = async (filenamePart, deadlineMs = 8000) =>
  JSON.parse(
    await evalBackground(
      `(async () => {
        const deadline = Date.now() + ${deadlineMs};
        for (;;) {
          const downloads = await browser.downloads.search({});
          const rows = downloads
            .filter((x) => x.filename.includes(${JSON.stringify(filenamePart)}))
            .map((x) => ({ state: x.state, filename: x.filename }));
          if (rows.some((x) => x.state === "complete")) {
            return JSON.stringify(rows);
          }
          if (Date.now() >= deadline) return JSON.stringify(rows);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })()`,
      deadlineMs + 2000,
    ),
  );

const waitForLog = async (predicate, deadlineMs = 8000) =>
  JSON.parse(
    await evalBackground(
      `(async () => {
        const deadline = Date.now() + ${deadlineMs};
        for (;;) {
          const matches = (await Log.get()).filter(${predicate});
          if (matches.length || Date.now() >= deadline) return JSON.stringify(matches);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })()`,
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

beforeAll(async () => {
  session = await firefox.launch();
});

afterAll(async () => {
  if (session) await session.cleanup();
});

test("background event page initialises cleanly", async () => {
  const state = JSON.parse(
    await evalBackground(`window.ready.then(() => JSON.stringify({
      browser: CURRENT_BROWSER,
      capabilities: WEB_EXTENSION_CAPABILITIES,
      promptConflictAction: OptionsManagement.OPTION_KEYS
        .find(({ name }) => name === "conflictAction").onLoad("prompt"),
      pathErrors: window.optionErrors.paths.length,
      menuCount: Object.keys(menuState.pathMappings).length,
      hasObjectUrl: typeof URL.createObjectURL === "function",
    }))`),
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
  expect(state.pathErrors).toBe(0);
  expect(state.menuCount).toBeGreaterThan(0);
  // Event pages keep a real DOM (unlike Chrome's service worker)...
  expect(state.hasObjectUrl).toBe(true);
});

test("download completes through the real pipeline", async () => {
  await evalBackground(
    `window.ready.then(() => {
        Notifier.expectDownload();
        return Download.renameAndDownload({
          path: new Path("e2e"),
          scratch: {},
          info: {
            url: Download.makeObjectUrl("firefox e2e content"),
            suggestedFilename: "ff-smoke.txt",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      }).then(() => "started")`,
  );
  const downloads = await waitForDownloads("ff-smoke");

  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toBe("firefox e2e content");
});

test("options reset re-initialises", async () => {
  const reset = await evalBackground(`Promise.resolve(window.reset()).then(() => "reset-ok")`);
  expect(reset).toBe("reset-ok");
});

test("downloads receive the configured Referer header", async () => {
  let resolveReferer;
  const receivedReferer = new Promise((resolve) => {
    resolveReferer = resolve;
  });
  const server = http.createServer((req, res) => {
    if (req.method === "GET") resolveReferer(req.headers.referer || null);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("referer probe");
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/referer-probe.txt`;
  const referer = "http://referrer.example/download-test";

  try {
    await evalBackground(`window.ready.then(() => {
      options.setRefererHeader = true;
      options.setRefererHeaderFilter = "*://127.0.0.1/*";
      return Download.renameAndDownload({
        path: new Path("e2e"), scratch: {},
        info: { url: ${JSON.stringify(url)}, pageUrl: ${JSON.stringify(referer)},
          suggestedFilename: "referer-probe-firefox.txt", modifiers: [] },
      });
    })`);
    await expect(receivedReferer).resolves.toBe(referer);
    expect(
      (await waitForDownloads("referer-probe-firefox")).some((x) => x.state === "complete"),
    ).toBe(true);
  } finally {
    server.close();
  }
});

test("routing rules rename and route the download", async () => {
  await evalBackground(
    `browser.storage.local.set({
        filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
      })
        .then(() => window.reset())
        .then(() => {
          Notifier.expectDownload();
          return Download.renameAndDownload({
            path: new Path("e2e"),
            scratch: {},
            info: {
              url: Download.makeObjectUrl("ff routed content"),
              suggestedFilename: "routeme.txt",
              pageUrl: "https://example.com/",
              modifiers: [],
            },
          });
        }).then(() => "started")`,
  );
  expect((await waitForDownloads("renamed-routeme")).map((x) => x.state)).toEqual(["complete"]);
});

test("message-driven downloads work and never inherit a stale route", async () => {
  await evalBackground(
    `new Promise((resolve) => {
        Messaging.handleDownloadMessage({
          body: {
            url: Download.makeObjectUrl("ff message download"),
            info: {
              pageUrl: "https://example.com/",
              srcUrl: "https://example.com/src.png",
              suggestedFilename: "ff-msg-download.txt",
            },
          },
        }, { tab: { id: 1, title: "E2E Tab" } }, resolve);
      }).then(() => "started")`,
  );
  expect((await waitForDownloads("ff-msg-download")).map((x) => x.state)).toEqual(["complete"]);
});

test("shortcut files keep their extension and redirect content", async () => {
  await evalBackground(
    `window.ready.then(() => {
        Notifier.expectDownload();
        return Download.renameAndDownload({
          path: new Path("e2e"),
          scratch: {},
          info: {
            url: Shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, "https://example.com/target"),
            suggestedFilename: "page-shortcut.html",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      }).then(() => "started")`,
  );
  const downloads = await waitForDownloads("page-shortcut");

  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(downloads[0].filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
});

test("failed downloads are recorded in the debug log", async () => {
  await evalBackground(
    `window.ready.then(() => {
        Notifier.expectDownload();
        return Download.renameAndDownload({
          path: new Path("e2e"),
          scratch: {},
          info: {
            // Nothing listens on port 1
            url: "http://127.0.0.1:1/unreachable.bin",
            suggestedFilename: "unreachable.bin",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      }).then(() => "started")`,
  );
  const entries = await waitForLog(
    `(e) => e.message === "download failed" || e.message === "downloads.download failed"`,
  );
  expect(entries.length).toBeGreaterThanOrEqual(1);
});

test("ordinary browser downloads can be tracked and experimentally rerouted on Firefox", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/native-ff.bin") {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="native-ff.bin"',
      });
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
      filenamePatterns: "filename: native-ff\\.bin\\ninto: browser-routed/:filename:",
    }).then(() => window.reset())`);
    await evalBackground(`browser.tabs.create({ url: ${JSON.stringify(pageUrl)} })`);
    await evalBackground(`(async () => {
      const deadline = Date.now() + 8000;
      for (;;) {
        const tabs = await browser.tabs.query({});
        if (tabs.some((tab) => tab.url?.includes(${JSON.stringify(target)}) && tab.status === "complete")) return;
        if (Date.now() >= deadline) throw new Error("ordinary download page timeout");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })()`);
    await session.evaluateInTab(target, `document.querySelector("#native").click()`);

    const rows = await waitForDownloads("browser-routed");
    expect(rows.some((row) => row.state === "complete")).toBe(true);
    expect(rows.some((row) => row.filename.includes("browser-routed"))).toBe(true);
    const observed = JSON.parse(
      await evalBackground(`(async () => {
        const deadline = Date.now() + 8000;
        for (;;) {
          const entries = (await SaveHistory.get()).filter((entry) => entry.info?.context === "browser");
          if (entries.some((entry) => entry.status === "complete")) return JSON.stringify(entries);
          if (Date.now() >= deadline) return JSON.stringify(entries);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })()`),
    );
    expect(observed.at(-1)).toMatchObject({ status: "complete", info: { context: "browser" } });
  } finally {
    await evalBackground(`browser.storage.local.set({
      trackBrowserDownloads: false,
      routeBrowserDownloadsFirefox: false,
      browserDownloadFilter: "",
      filenamePatterns: "",
    }).then(() => window.reset())`);
    server.close();
  }
});

test("alt+click on a real page saves the image through the content script", async () => {
  const { server, port } = await startPageServer();
  const pageUrl = `http://127.0.0.1:${port}/`;
  const targetUrl = `127.0.0.1:${port}`;

  try {
    // Enable click-to-save and reinitialise so the content script picks it up
    await evalBackground(
      `browser.storage.local.set({ contentClickToSave: true })
        .then(() => window.reset())
        .then(() => "enabled")`,
    );

    await evalBackground(
      `browser.tabs.create({ url: ${JSON.stringify(pageUrl)} }).then(() => "opened")`,
    );
    await evalBackground(`(async () => {
      const deadline = Date.now() + 8000;
      for (;;) {
        const tabs = await browser.tabs.query({});
        if (tabs.some((tab) => tab.url?.includes(${JSON.stringify(targetUrl)}) && tab.status === "complete")) {
          return "ready";
        }
        if (Date.now() >= deadline) throw new Error("page load timeout");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })()`);

    // Firefox honours keyCode/buttons on synthetic events, and content-script
    // window listeners fire on real page DOM events, so we can drive the flow
    // straight from a page-context evaluate
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

    const downloads = await waitForDownloads("pic");

    expect(downloads.length).toBeGreaterThanOrEqual(1);
    expect(downloads[0].state).toBe("complete");
    expect(fs.readFileSync(downloads[0].filename)).toEqual(PNG);
  } finally {
    server.close();
  }
});

test("history and the debug log record the session's downloads", async () => {
  const records = JSON.parse(
    await evalBackground(
      `Promise.all([SaveHistory.get(), Log.get()]).then(([history, log]) => JSON.stringify({
        history: history.length,
        logRequested: log.filter((e) => e.message === "download requested").length,
      }))`,
    ),
  );

  expect(records.history).toBeGreaterThanOrEqual(3);
  expect(records.logRequested).toBeGreaterThanOrEqual(3);
});
