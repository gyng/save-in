// Firefox end-to-end suite: throwaway profile, temporary install over RDP
// (the about:debugging mechanism), evaluated in the extension's background
// event page. Tests are sequential and build on each other's state.

import fs from "fs";
import http from "http";

import firefox from "../scripts/lib/firefox.js";

let session;

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const startPageServer = (port) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<html><body><img id="img" src="/pic.png" width="50" height="50"></body></html>');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
};

beforeAll(async () => {
  session = await firefox.launch();
});

afterAll(async () => {
  if (session) await session.cleanup();
});

test("background event page initialises cleanly", async () => {
  const state = JSON.parse(
    await session.evaluate(`window.ready.then(() => JSON.stringify({
      browser: CURRENT_BROWSER,
      pathErrors: window.optionErrors.paths.length,
      menuCount: Object.keys(Menus.pathMappings).length,
      hasObjectUrl: typeof URL.createObjectURL === "function",
      hasBlockingWebRequest: !!(browser.webRequest && browser.webRequest.onBeforeSendHeaders),
    }))`),
  );

  expect(state.browser).toBe("FIREFOX");
  expect(state.pathErrors).toBe(0);
  expect(state.menuCount).toBeGreaterThan(0);
  // Event pages keep a real DOM (unlike Chrome's service worker)...
  expect(state.hasObjectUrl).toBe(true);
  // ...and Firefox MV3 keeps blocking webRequest
  expect(state.hasBlockingWebRequest).toBe(true);
});

test("download completes through the real pipeline", async () => {
  const downloads = JSON.parse(
    await session.evaluate(
      `window.ready.then(() => {
        requestedDownloadFlag = true;
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            url: Download.makeObjectUrl("firefox e2e content"),
            suggestedFilename: "ff-smoke.txt",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      })
      .then(() => new Promise(r => setTimeout(r, 3000)))
      .then(() => browser.downloads.search({}))
      .then((d) => JSON.stringify(
        d.filter((x) => x.filename.includes("ff-smoke"))
          .map((x) => ({ state: x.state, filename: x.filename }))
      ))`,
      45000,
    ),
  );

  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toBe("firefox e2e content");
});

test("options reset re-initialises", async () => {
  const reset = await session.evaluate(`Promise.resolve(window.reset()).then(() => "reset-ok")`);
  expect(reset).toBe("reset-ok");
});

test("referer option registers a blocking webRequest listener", async () => {
  const result = JSON.parse(
    await session.evaluate(`(() => {
      options.setRefererHeader = true;
      options.setRefererHeaderFilter = "*://i.pximg.net/*";
      Headers.addRequestListener();
      return JSON.stringify({
        registered: browser.webRequest.onBeforeSendHeaders.hasListener(Headers.refererListener),
      });
    })()`),
  );
  expect(result.registered).toBe(true);
});

test("routing rules rename and route the download", async () => {
  const states = JSON.parse(
    await session.evaluate(
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
              url: Download.makeObjectUrl("ff routed content"),
              suggestedFilename: "routeme.txt",
              pageUrl: "https://example.com/",
              modifiers: [],
            },
          });
        })
        .then(() => new Promise(r => setTimeout(r, 3000)))
        .then(() => browser.downloads.search({}))
        .then((d) => JSON.stringify(
          d.filter((x) => x.filename.includes("renamed-routeme")).map((x) => x.state)
        ))`,
      45000,
    ),
  );
  expect(states).toEqual(["complete"]);
});

test("message-driven downloads work and never inherit a stale route", async () => {
  const states = JSON.parse(
    await session.evaluate(
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
      })
        .then(() => new Promise(r => setTimeout(r, 3000)))
        .then(() => browser.downloads.search({}))
        .then((d) => JSON.stringify(
          d.filter((x) => x.filename.includes("ff-msg-download")).map((x) => x.state)
        ))`,
      45000,
    ),
  );
  expect(states).toEqual(["complete"]);
});

test("shortcut files keep their extension and redirect content", async () => {
  const downloads = JSON.parse(
    await session.evaluate(
      `window.ready.then(() => {
        requestedDownloadFlag = true;
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
      .then(() => new Promise(r => setTimeout(r, 3000)))
      .then(() => browser.downloads.search({}))
      .then((d) => JSON.stringify(
        d.filter((x) => x.filename.includes("page-shortcut"))
          .map((x) => ({ state: x.state, filename: x.filename }))
      ))`,
      45000,
    ),
  );

  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(downloads[0].filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
});

test("failed downloads are recorded in the debug log", async () => {
  const entries = JSON.parse(
    await session.evaluate(
      `window.ready.then(() => {
        requestedDownloadFlag = true;
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            // Nothing listens on port 1
            url: "http://127.0.0.1:1/unreachable.bin",
            suggestedFilename: "unreachable.bin",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      })
      .then(() => new Promise(r => setTimeout(r, 4000)))
      .then(() => Log.get())
      .then((log) => JSON.stringify(
        log.filter((e) => e.message === "download failed" || e.message === "downloads.download failed").length
      ))`,
      45000,
    ),
  );
  expect(entries).toBeGreaterThanOrEqual(1);
});

test("alt+click on a real page saves the image through the content script", async () => {
  const server = await startPageServer(8919);

  try {
    // Enable click-to-save and reinitialise so the content script picks it up
    await session.evaluate(
      `browser.storage.local.set({ contentClickToSave: true })
        .then(() => window.reset())
        .then(() => "enabled")`,
    );

    await session.evaluate(
      `browser.tabs.create({ url: "http://127.0.0.1:8919/" }).then(() => "opened")`,
    );
    await new Promise((r) => setTimeout(r, 2500));

    // Firefox honours keyCode/buttons on synthetic events, and content-script
    // window listeners fire on real page DOM events, so we can drive the flow
    // straight from a page-context evaluate
    await session.evaluateInTab(
      "127.0.0.1:8919",
      `(() => {
        const alt = new KeyboardEvent("keydown", { keyCode: 18, bubbles: true });
        window.dispatchEvent(alt);
        const img = document.getElementById("img");
        img.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1 }));
        return "clicked";
      })()`,
    );

    const downloads = JSON.parse(
      await session.evaluate(
        `new Promise(r => setTimeout(r, 3000))
          .then(() => browser.downloads.search({}))
          .then((d) => JSON.stringify(
            d.filter((x) => x.filename.includes("pic"))
              .map((x) => ({ state: x.state, filename: x.filename }))
          ))`,
        45000,
      ),
    );

    expect(downloads.length).toBeGreaterThanOrEqual(1);
    expect(downloads[0].state).toBe("complete");
    expect(fs.readFileSync(downloads[0].filename)).toEqual(PNG);
  } finally {
    server.close();
  }
});

test("history and the debug log record the session's downloads", async () => {
  const records = JSON.parse(
    await session.evaluate(
      `Promise.all([SaveHistory.get(), Log.get()]).then(([history, log]) => JSON.stringify({
        history: history.length,
        logRequested: log.filter((e) => e.message === "download requested").length,
      }))`,
    ),
  );

  expect(records.history).toBeGreaterThanOrEqual(3);
  expect(records.logRequested).toBeGreaterThanOrEqual(3);
});
