import fs from "node:fs";
import http from "node:http";

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
