import fs from "node:fs";

import { expect } from "vitest";

import {
  CONTENT_DISPOSITION_CASES,
  startContentDispositionServer,
} from "./content-disposition-cases.mjs";

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
  await evaluate(`api.startDownload({
    url: "http://127.0.0.1:1/${filename}",
    suggestedFilename: ${JSON.stringify(filename)},
    pageUrl: "https://example.com/",
  }).then(() => "started")`);
  const entries = await waitForLog(
    `(entry) => entry.message === "download failed" || entry.message === "downloads.download failed"`,
  );
  expect(entries.length).toBeGreaterThanOrEqual(1);
};
