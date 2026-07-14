import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { expect } from "vitest";

import {
  CONTENT_DISPOSITION_CASES,
  startContentDispositionServer,
} from "./content-disposition-cases.mjs";
import { closeLocal, listenLocal } from "./helpers.mjs";

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   downloadUsingBrowserFilename: (url: string) => Promise<string>,
 *   waitForDownloadUrl: (url: string) => Promise<string>,
 * }} adapters
 */
export const runContentDispositionScenario = async ({
  evaluate,
  downloadUsingBrowserFilename,
  waitForDownloadUrl,
}) => {
  const { server, port } = await startContentDispositionServer();
  try {
    for (const fixture of CONTENT_DISPOSITION_CASES) {
      const nativeUrl = `http://127.0.0.1:${port}/${fixture.id}?source=native`;
      const saveInUrl = `http://127.0.0.1:${port}/${fixture.id}?source=save-in`;
      const nativeFilename = await downloadUsingBrowserFilename(nativeUrl);
      await evaluate(
        `api.startDownload({
          url: ${JSON.stringify(saveInUrl)},
          suggestedFilename: ${JSON.stringify(`${fixture.id}-url-fallback.bin`)},
          pageUrl: ${JSON.stringify(`http://127.0.0.1:${port}/`)},
          path: "e2e/content-disposition",
        }).then(() => true)`,
      );
      expect.soft(await waitForDownloadUrl(saveInUrl), fixture.id).toBe(nativeFilename);
    }
  } finally {
    await closeLocal(server);
  }
};

/**
 * Drives a private context-menu save through the production pipeline and
 * verifies that private activity never reaches extension persistence.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 *   filename: string,
 * }} adapters
 */
export const runPrivateContextScenario = async ({ evaluate, waitForDownloads, filename }) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("private context content");
  });
  const port = await listenLocal(server);
  const privateUrl = `http://127.0.0.1:${port}/${filename}.txt`;
  const snapshot = JSON.parse(
    await evaluate(`Promise.all([
      browser.storage.local.get(["paths", "save-in-history", "save-in-last-used-path", "save-in-last-used-meta"]),
      browser.storage.session.get(null),
      api.logs(),
    ]).then(([local, session, log]) => JSON.stringify({ local, session, log }))`),
  );

  try {
    await evaluate(`browser.storage.local.set({ paths: "e2e/private" })
      .then(() => api.reset())
      .then(() => api.clickContextMenu({
        info: {
          menuItemId: "save-in-0",
          mediaType: "image",
          srcUrl: ${JSON.stringify(privateUrl)},
          pageUrl: "https://private.example/",
        },
        tab: {
          id: 91,
          title: ${JSON.stringify(filename)},
          url: "https://private.example/",
          incognito: true,
        },
      })).then(() => "clicked")`);

    const downloads = await waitForDownloads(filename);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].state).toBe("complete");
    expect(fs.readFileSync(downloads[0].filename, "utf8")).toBe("private context content");

    const after = JSON.parse(
      await evaluate(`Promise.all([
        browser.storage.local.get(["save-in-history", "save-in-last-used-path", "save-in-last-used-meta"]),
        browser.storage.session.get(null),
        api.logs(),
      ]).then(([local, session, log]) => JSON.stringify({ local, session, log }))`),
    );
    expect(after.local["save-in-history"]).toEqual(snapshot.local["save-in-history"]);
    expect(after.local["save-in-last-used-path"]).toEqual(snapshot.local["save-in-last-used-path"]);
    expect(after.local["save-in-last-used-meta"]).toEqual(snapshot.local["save-in-last-used-meta"]);
    expect(after.log).toEqual(snapshot.log);
    expect(Object.keys(after.session.siActiveTransfers || {})).toHaveLength(0);
  } finally {
    const hadPaths = Object.hasOwn(snapshot.local, "paths");
    try {
      await evaluate(`${hadPaths ? `browser.storage.local.set({ paths: ${JSON.stringify(snapshot.local.paths)} })` : 'browser.storage.local.remove("paths")'}
        .then(() => api.reset()).then(() => "restored")`);
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * Starts a real background fetch, restarts the background while it is in
 * flight, and verifies cold-start recovery clears the durable transfer record.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   restartBackground: () => Promise<void>,
 *   filename: string,
 * }} adapters
 */
export const runInterruptedTransferRecoveryScenario = async ({
  evaluate,
  restartBackground,
  filename,
}) => {
  /** @type {import("node:http").ServerResponse | undefined} */
  let pendingResponse;
  /** @type {(() => void) | undefined} */
  let requestStartedResolve;
  /** @type {Promise<void>} */
  const requestStarted = new Promise((resolve) => {
    requestStartedResolve = () => resolve();
  });
  const server = http.createServer((_req, res) => {
    pendingResponse = res;
    requestStartedResolve?.();
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previousFetchViaFetch = await evaluate(`api.getOption("fetchViaFetch")`);

  try {
    await evaluate(`api.setOptions({ fetchViaFetch: true, filenamePatterns: "" })
      .then(() => { void api.startDownload({
        url: ${JSON.stringify(url)},
        suggestedFilename: ${JSON.stringify(filename)},
        pageUrl: "https://restart.example/",
      }); return "started"; })`);
    await requestStarted;
    const active = JSON.parse(
      await evaluate(`new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        let settled = false;
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          browser.storage.onChanged.removeListener(onChanged);
          timeout.removeEventListener("abort", onTimeout);
          callback();
        };
        const check = async () => {
          const stored = await browser.storage.session.get("siActiveTransfers");
          const records = stored.siActiveTransfers || {};
          if (Object.keys(records).length === 1) {
            finish(() => resolve(JSON.stringify(records)));
          }
        };
        const onChanged = (_changes, area) => {
          if (area === "session") void check().catch((error) => finish(() => reject(error)));
        };
        const onTimeout = () => finish(() => reject(
          new Error("Timed out waiting for durable active-transfer state")
        ));
        browser.storage.onChanged.addListener(onChanged);
        timeout.addEventListener("abort", onTimeout, { once: true });
        void check().catch((error) => finish(() => reject(error)));
      })`),
    );
    expect(Object.keys(active)).toHaveLength(1);

    await restartBackground();
    pendingResponse?.end("response after background restart");

    const recovered = JSON.parse(
      await evaluate(`new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(8000);
        const check = async () => {
          const [history, session] = await Promise.all([
            api.history(),
            browser.storage.session.get("siActiveTransfers"),
          ]);
          const entry = history.findLast((row) => row.url === ${JSON.stringify(url)});
          if (entry?.status === "DOWNLOAD_PREPARATION_INTERRUPTED" &&
              Object.keys(session.siActiveTransfers || {}).length === 0) {
            resolve(JSON.stringify(entry));
            return;
          }
          if (timeout.aborted) {
            reject(new Error("Timed out waiting for interrupted-transfer recovery"));
            return;
          }
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            void check();
          };
          channel.port2.postMessage(null);
        };
        void check();
      })`),
    );
    expect(recovered.status).toBe("DOWNLOAD_PREPARATION_INTERRUPTED");
  } finally {
    pendingResponse?.destroy();
    await evaluate(`api.setOptions({ fetchViaFetch: ${JSON.stringify(previousFetchViaFetch)} })`);
    await closeLocal(server);
  }
};

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 *   content: string,
 * }} adapters
 */
export const runRoutingScenario = async ({ evaluate, waitForDownloads, content }) => {
  await evaluate(
    `browser.storage.local.set({
      filenamePatterns: "filename: routeme\\ninto: routed/renamed-:filename:",
    })
      .then(() => api.reset())
      .then(() => api.startDownload({
        content: ${JSON.stringify(content)},
        suggestedFilename: "routeme.txt",
        pageUrl: "https://example.com/",
      })).then(() => "started")`,
  );
  const downloads = await waitForDownloads("renamed-routeme");
  expect(downloads.map((entry) => entry.state)).toEqual(["complete"]);
  return downloads;
};

/**
 * Replays the durable settings that matter most when a 3.7 profile first runs
 * version 4, then proves that an extensionless response still reaches its
 * configured folder with the MIME-derived extension.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 *   filename: string,
 * }} adapters
 */
export const runLegacyProfileRoutingScenario = async ({ evaluate, waitForDownloads, filename }) => {
  const body = Buffer.from("legacy profile png");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": body.length,
    });
    res.end(body);
  });
  const port = await listenLocal(server);
  const url = `http://127.0.0.1:${port}/${filename}`;
  const previous = JSON.parse(
    await evaluate(`browser.storage.local.get([
      "paths", "filenamePatterns", "contentClickToSaveCombo"
    ]).then((stored) => JSON.stringify(stored))`),
  );
  const legacyKeys = ["paths", "filenamePatterns", "contentClickToSaveCombo"];
  const missingLegacyKeys = legacyKeys.filter((key) => !(key in previous));

  try {
    const resolved = JSON.parse(
      await evaluate(`browser.storage.local.set({
        paths: "e2e/legacy-custom",
        filenamePatterns: "mime: ^image/png$\\ninto: legacy-custom/:filename:",
        contentClickToSaveCombo: 18,
      })
        .then(() => api.reset())
        .then(() => Promise.all([
          api.getOption("paths"),
          api.getOption("contentClickToSaveCombo"),
        ]))
        .then(([paths, combo]) => JSON.stringify({ paths, combo }))`),
    );
    expect(resolved).toEqual({ paths: "e2e/legacy-custom", combo: 18 });

    await evaluate(`api.startDownload({
      url: ${JSON.stringify(url)},
      suggestedFilename: ${JSON.stringify(filename)},
      pageUrl: "https://legacy-profile.example/",
    }).then(() => "started")`);
    const downloads = await waitForDownloads(`${filename}.png`);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].state).toBe("complete");
    expect(downloads[0].filename).toMatch(
      new RegExp(`e2e[\\\\/]legacy-custom[\\\\/]${filename}\\.png$`),
    );
    expect(fs.readFileSync(downloads[0].filename)).toEqual(body);
  } finally {
    try {
      await evaluate(`Promise.all([
        browser.storage.local.set(${JSON.stringify(previous)}),
        browser.storage.local.remove(${JSON.stringify(missingLegacyKeys)}),
      ]).then(() => api.reset())`);
    } finally {
      await closeLocal(server);
    }
  }
};

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 *   downloadDir: string,
 *   filename: string,
 *   supported?: boolean,
 * }} adapters
 */
export const runSymlinkDestinationScenario = async ({
  evaluate,
  waitForDownloads,
  downloadDir,
  filename,
  supported = true,
}) => {
  const linkParent = path.join(downloadDir, "e2e");
  const link = path.join(linkParent, "release-symlink");
  const target = path.join(path.dirname(downloadDir), `release-symlink-target-${filename}`);
  fs.mkdirSync(linkParent, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

  try {
    await evaluate(`api.startDownload({
      content: "symlink destination smoke",
      suggestedFilename: ${JSON.stringify(filename)},
      pageUrl: "https://symlink-smoke.example/",
      path: "e2e/release-symlink",
    }).then(() => "started")`);
    if (!supported) {
      const rejected = JSON.parse(
        await evaluate(`(async () => {
          const deadline = Date.now() + 8000;
          for (;;) {
            const rows = await api.history();
            const match = rows.findLast(
              (row) => row.finalFullPath === ${JSON.stringify(`e2e/release-symlink/${filename}`)},
            );
            if (match?.status === "USER_CANCELED") {
              return JSON.stringify(match);
            }
            if (Date.now() >= deadline) return JSON.stringify(null);
            await new Promise((resolve) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                resolve();
              };
              channel.port2.postMessage(null);
            });
          }
        })()`),
      );
      expect(rejected).toMatchObject({
        finalFullPath: `e2e/release-symlink/${filename}`,
        status: "USER_CANCELED",
      });
      expect(fs.existsSync(path.join(target, filename))).toBe(false);
      return;
    }
    const downloads = await waitForDownloads(filename);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].state).toBe("complete");
    expect(fs.realpathSync(path.dirname(downloads[0].filename))).toBe(fs.realpathSync(target));
    expect(fs.readFileSync(path.join(target, filename), "utf8")).toBe("symlink destination smoke");
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
};

/**
 * Exercises menu-state construction and the production context-menu handler
 * through download completion. Native browser-chrome menu selection remains a
 * manual release check because CDP and Firefox RDP cannot operate that UI.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 * }} adapters
 */
export const runContextMenuScenario = async ({ evaluate, waitForDownloads }) => {
  await evaluate(`browser.storage.local.set({ paths: "e2e/context-menu", selection: true })
      .then(() => api.reset())
      .then(() => api.clickContextMenu({
        info: {
          menuItemId: "save-in-0",
          selectionText: "context menu content",
          pageUrl: "https://example.com/",
        },
        tab: { id: 1, title: "context-menu-smoke", url: "https://example.com/" },
      })).then(() => "clicked")`);

  const downloads = await waitForDownloads("context-menu-smoke");
  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(downloads[0].filename).toMatch(
    /e2e[\\/]context-menu[\\/]context-menu-smoke\.selection\.txt$/,
  );
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toBe("context menu content");
};

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 * }} adapters
 */
export const runShortcutScenario = async ({ evaluate, waitForDownloads }) => {
  await evaluate(`api.startDownload({
    shortcutUrl: "https://example.com/target",
    suggestedFilename: "page-shortcut.html",
    pageUrl: "https://example.com/",
  }).then(() => "started")`);
  const downloads = await waitForDownloads("page-shortcut");
  expect(downloads).toHaveLength(1);
  expect(downloads[0].state).toBe("complete");
  expect(downloads[0].filename.endsWith("page-shortcut.html")).toBe(true);
  expect(fs.readFileSync(downloads[0].filename, "utf8")).toContain(
    'window.location.href = "https://example.com/target"',
  );
};

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForLog: (predicate: string) => Promise<any[]>,
 *   filename?: string,
 * }} adapters
 */
export const runFailedDownloadLogScenario = async ({
  evaluate,
  waitForLog,
  filename = "unreachable.bin",
}) => {
  const baseline = Number(await evaluate(`api.logs().then((log) => log.length)`));
  await evaluate(`api.startDownload({
    url: "http://127.0.0.1:1/${filename}",
    suggestedFilename: ${JSON.stringify(filename)},
    pageUrl: "https://example.com/",
  }).then(() => "started")`);
  const entries = await waitForLog(
    `(entry, index) => index >= ${baseline} &&
      (entry.message === "download failed" || entry.message === "downloads.download failed")`,
  );
  expect(entries.length).toBeGreaterThanOrEqual(1);
};

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string, deadlineMs?: number) => Promise<any[]>,
 *   filename: string,
 * }} adapters
 */
export const runAutomaticRetryScenario = async ({ evaluate, waitForDownloads, filename }) => {
  const body = `recovered ${filename}`;
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  });
  const port = await listenLocal(server);
  const previous = JSON.parse(
    await evaluate(`Promise.all([
      api.getOption("fallbackFetch"),
      api.getOption("filenamePatterns"),
    ]).then(([fallbackFetch, filenamePatterns]) =>
      JSON.stringify({ fallbackFetch, filenamePatterns }))`),
  );

  try {
    await evaluate(`api.setOptions({ fallbackFetch: true, filenamePatterns: "" })
      .then(() => api.startDownload({
        url: "http://127.0.0.1:${port}/${filename}",
        suggestedFilename: ${JSON.stringify(filename)},
        pageUrl: "http://127.0.0.1:${port}/",
      })).then(() => "started")`);

    const rows = await waitForDownloads(filename, 10000);
    const completed = rows.find((row) => row.state === "complete");
    expect(completed).toBeTruthy();
    expect(fs.readFileSync(completed.filename, "utf8")).toBe(body);
    expect(hits).toBeGreaterThanOrEqual(2);
  } finally {
    try {
      await evaluate(`api.setOptions(${JSON.stringify(previous)})`);
    } finally {
      await closeLocal(server);
    }
  }
};
