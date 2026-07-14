// Firefox end-to-end suite: throwaway profile, temporary install over RDP
// (the about:debugging mechanism), evaluated in the extension's background
// event page and an extension-page control client. Tests are sequential and
// build on each other's state.

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import firefox from "../scripts/lib/firefox.js";
import { inBackgroundContext } from "./background-context.mjs";
import {
  runAutomaticRetryScenario,
  runContentDispositionScenario,
  runContextMenuScenario,
  runFailedDownloadLogScenario,
  runLegacyProfileRoutingScenario,
  runRoutingScenario,
  runShortcutScenario,
  runSymlinkDestinationScenario,
} from "./shared-scenarios.mjs";
import { runTemplateLibraryScenario } from "./template-library-scenario.mjs";
import { runRoutingVisualEditorScenario } from "./routing-visual-editor-scenario.mjs";
import {
  closeLocal,
  listenLocal,
  nextBrowserTaskExpression,
  poll,
  waitForDownloadExpression,
  waitForTabExpression,
} from "./helpers.mjs";

/** @type {Awaited<ReturnType<typeof firefox.launch>>} */
let session;
let suiteFailed = false;
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(process.env.E2E_ARTIFACT_DIR)
  : path.resolve("dist", "e2e-artifacts");

/** @param {string} expr @param {number} [timeoutMs] */
const evalOptions = (expr, timeoutMs) =>
  session.evaluateInTab("src/options/options.html", expr, timeoutMs);
/** @param {string} expr @param {number} [timeoutMs] */
const evalBackground = (expr, timeoutMs) => evalOptions(inBackgroundContext(expr), timeoutMs);
/** @param {string} name */
const artifactName = (name) =>
  name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();

/** @param {string} testName */
const captureFailureArtifacts = async (testName) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  /** @type {Record<string, any>} */
  const report = { testName, capturedAt: new Date().toISOString() };
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
      `(async () => {
        const deadline = Date.now() + ${deadlineMs};
        for (;;) {
          const matches = (await api.logs()).filter(${predicate});
          if (matches.length || Date.now() >= deadline) return JSON.stringify(matches);
          await ${nextBrowserTaskExpression};
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
  } catch (error) {
    suiteFailed = true;
    throw error;
  }
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
  if (task.result?.state === "fail") {
    suiteFailed = true;
    try {
      await captureFailureArtifacts(task.name);
    } catch (error) {
      process.stderr.write(
        `Unable to capture Firefox failure artifacts: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      );
    }
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
        (await session.evaluateInTab(
          "src/options/options.html",
          `(() => {
            const checkbox = document.querySelector("#promptOnShift");
            return document.readyState === "complete" && checkbox && !checkbox.disabled;
          })()`,
        )) === true
          ? true
          : null,
      { description: "Firefox options controls" },
    );
    await session.evaluateInTab(
      "src/options/options.html",
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

test("production context-menu handler completes a selection save", async () => {
  await runContextMenuScenario({ evaluate: evalBackground, waitForDownloads });
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

test("routing rules rename and route the download", async () => {
  await runRoutingScenario({
    evaluate: evalBackground,
    waitForDownloads,
    content: "ff routed content",
  });
});

test("a 3.7 profile keeps its custom folder and repairs an extensionless filename", async () => {
  await runLegacyProfileRoutingScenario({
    evaluate: evalBackground,
    waitForDownloads,
    filename: "legacy-profile-firefox",
  });
});

test("a configured symlink destination reaches its target", async () => {
  await runSymlinkDestinationScenario({
    evaluate: evalBackground,
    waitForDownloads,
    downloadDir: session.downloadDir,
    filename: "symlink-firefox.txt",
  });
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

test("a template added in Options persists and routes a matching download", async () => {
  await runTemplateLibraryScenario({
    evaluate: evalBackground,
    evaluateOptions: (expression) => session.evaluateInTab("src/options/options.html", expression),
    waitForDownloads,
    filename: "template-library-firefox",
    content: "firefox template library e2e",
  });
});

test("visual routing edits persist and connect to the debugger", async () => {
  await runRoutingVisualEditorScenario({
    evaluate: evalBackground,
    evaluateOptions: (expression) => session.evaluateInTab("src/options/options.html", expression),
  });
});

test("shortcut files keep their extension and redirect content", async () => {
  await runShortcutScenario({ evaluate: evalBackground, waitForDownloads });
});

test("failed downloads are recorded in the debug log", async () => {
  await runFailedDownloadLogScenario({ evaluate: evalBackground, waitForLog });
});

test("a failed download is retried automatically via background fetch", async () => {
  await runAutomaticRetryScenario({
    evaluate: evalBackground,
    waitForDownloads,
    filename: "flaky-firefox.bin",
  });
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
      await evalBackground(`(async () => {
        const deadline = Date.now() + 8000;
        for (;;) {
          const entries = (await api.history()).filter((entry) => entry.info?.context === "browser");
          if (entries.some((entry) => entry.status === "complete")) return JSON.stringify(entries);
          if (Date.now() >= deadline) return JSON.stringify(entries);
          await ${nextBrowserTaskExpression};
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
    }).then(() => api.reset())`);
    server.close();
  }
});

test("page-generated alt+click cannot trigger a content-script download", async () => {
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
      server.close();
    }
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
  /** @param {string} target @returns {Promise<any>} */
  const sourceNames = (target) =>
    session
      .evaluateInTab(
        target,
        `JSON.stringify([...document.querySelector("#save-in-source-panel").shadowRoot
          .querySelectorAll(".source-link .name")].map((node) => node.textContent))`,
      )
      .then(JSON.parse);

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
    await evalBackground(`(${waitForTabExpression(firstMatch)}).then(async (tabJson) => {
      const tab = JSON.parse(tabJson);
      await browser.storage.session.set({ sourcePanelOpen: true });
      await browser.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
      return "opened";
    })`);
    await poll(
      async () =>
        (await session.evaluateInTab(
          firstTarget,
          "!!document.querySelector('#save-in-source-panel')?.shadowRoot",
        )) === true
          ? true
          : null,
      { description: "Firefox Page Sources panel open" },
    );

    expect(await sourceNames(firstTarget)).toEqual(["second.png", "first.png"]);

    await session.evaluateInTab(
      firstTarget,
      `(() => {
        const image = document.createElement("img");
        image.src = "/late.png";
        document.body.append(image);
      })()`,
    );
    await poll(async () => ((await sourceNames(firstTarget)).includes("late.png") ? true : null), {
      description: "Firefox live Page Sources discovery",
    });

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
    server.close();
  }
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
