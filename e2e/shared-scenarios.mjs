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
    server.close();
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
