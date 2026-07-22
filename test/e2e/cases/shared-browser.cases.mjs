import fs from "node:fs";

import { expect, test } from "vitest";

import {
  runAutomaticRetryScenario,
  runContextMenuScenario,
  runLinkMetadataRoutingScenario,
  runCssRoutingScenario,
  runDownloadAttributeRoutingScenario,
  runQuickSaveScenario,
  runFailedDownloadLogScenario,
  runHistoryCancellationScenario,
  runLegacyProfileRoutingScenario,
  runRenameRoutingScenario,
  runRoutingScenario,
  runRoutingTabActionScenario,
  runShortcutScenario,
  runSymlinkDestinationScenario,
  runTabStripScenario,
  runRerouteLastSaveScenario,
  runUndoLastSaveScenario,
} from "../shared-scenarios.mjs";
import { runTemplateLibraryScenario } from "../template-library-scenario.mjs";
import { runRoutingVisualEditorScenario } from "../routing-visual-editor-scenario.mjs";
import { runHistoryMemoryScenario } from "../history-memory-scenario.mjs";
import { requireValue } from "../helpers.mjs";

/** @typedef {import("../control-protocol.mjs").DownloadSummary} DownloadSummary */
/** @typedef {import("../control-protocol.mjs").LogEntry} LogEntry */

/**
 * Registers platform-neutral browser cases without creating another Vitest
 * file or browser process. Browser entrypoints provide only the protocol and
 * capability differences.
 *
 * @param {{
 *   control: ReturnType<typeof import("../control-client.mjs").createE2EControlClient>,
 *   evaluate: (expression: string) => Promise<unknown>,
 *   evaluateOptions: (expression: string) => Promise<unknown>,
 *   evaluatePage: (target: string, expression: string) => Promise<unknown>,
 *   waitForDownloads: (filename: string, timeoutMs?: number) => Promise<DownloadSummary[]>,
 *   waitForLog: (baseline: number, messages: string[], timeoutMs?: number) => Promise<LogEntry[]>,
 *   downloadDir: () => string,
 *   browserLabel: "chrome" | "firefox",
 *   browserProcess: () => import("node:child_process").ChildProcess | undefined,
 *   routingContent: string,
 *   symlinkSupported: boolean,
 *   failedDownloadFilename?: string,
 *   afterFailedDownload?: () => Promise<void>,
 *   reloadOptions?: () => Promise<unknown>,
 * }} adapters
 */
export const registerSharedBrowserCases = (adapters) => {
  const {
    control,
    evaluate,
    evaluateOptions,
    evaluatePage,
    waitForDownloads,
    waitForLog,
    downloadDir,
    browserLabel,
    browserProcess,
    routingContent,
    symlinkSupported,
    failedDownloadFilename,
    afterFailedDownload,
    reloadOptions,
  } = adapters;

  test("history rewrites keep browser RSS below the content-tab fan-out ceiling", async () => {
    await runHistoryMemoryScenario({ browserLabel, browserProcess, control });
  });

  test("History cancels an in-flight acquisition and clears durable state", async () => {
    await runHistoryCancellationScenario({
      control,
      evaluate,
      filename: `cancel-${browserLabel}.bin`,
    });
  });

  test("undo removes the saved file and marks the History entry undone", async () => {
    await runUndoLastSaveScenario({
      control,
      waitForDownloads,
      filename: `undo-${browserLabel}`,
      detectsMissingFile: browserLabel !== "chrome",
    });
  });

  test("move re-downloads to the chosen folder and links the History rows", async () => {
    await runRerouteLastSaveScenario({
      control,
      waitForDownloads,
      filename: `reroute-${browserLabel}`,
    });
  });

  test("production context-menu handler completes a selection save", async () => {
    await runContextMenuScenario({ control, waitForDownloads });
  });

  test("a matched routing action closes its source tab after saving", async () => {
    await runRoutingTabActionScenario({ control, waitForDownloads });
  });

  test("interactive link attributes route through the exact content frame", async () => {
    await runLinkMetadataRoutingScenario({ control, evaluatePage });
  });

  test("Quick save routes straight to the configured default destination", async () => {
    await runQuickSaveScenario({ control, waitForDownloads });
  });

  test("production tab-strip handler saves the selected real tab", async () => {
    await runTabStripScenario({
      control,
      waitForDownloads,
      filename: `tab-strip-${browserLabel}.txt`,
    });
  });

  test("routing rules rename and route the download", async () => {
    const downloads = await runRoutingScenario({
      control,
      waitForDownloads,
      content: routingContent,
    });
    const completed = requireValue(downloads[0], "Routed download was not captured");
    expect(fs.readFileSync(completed.filename, "utf8")).toBe(routingContent);
  });

  test("CSS routes automatic and manual Page Sources by their originating element", async () => {
    await runCssRoutingScenario({ control, evaluatePage, browserLabel });
  });

  test("an anchor's download attribute names and routes an ordinary browser download", async () => {
    await runDownloadAttributeRoutingScenario({
      control,
      evaluatePage,
      waitForDownloads,
      browserLabel,
    });
  });

  test("a rename: clause edits the final filename of a routed save", async () => {
    const downloads = await runRenameRoutingScenario({
      control,
      waitForDownloads,
      content: routingContent,
    });
    const completed = requireValue(downloads[0], "Renamed download was not captured");
    expect(completed.filename.endsWith("save-renamed.txt")).toBe(true);
    expect(fs.readFileSync(completed.filename, "utf8")).toBe(routingContent);
  });

  test("a 3.7 profile keeps its custom folder and repairs an extensionless filename", async () => {
    await runLegacyProfileRoutingScenario({
      control,
      waitForDownloads,
      filename: `legacy-profile-${browserLabel}`,
    });
  });

  test(
    symlinkSupported
      ? "a configured symlink destination reaches its target"
      : "Chrome safely rejects a configured symlink destination",
    async () => {
      await runSymlinkDestinationScenario({
        control,
        waitForDownloads,
        downloadDir: downloadDir(),
        filename: `symlink-${browserLabel}.txt`,
        supported: symlinkSupported,
      });
    },
  );

  test("a template added in Options persists and routes a matching download", async () => {
    await reloadOptions?.();
    await runTemplateLibraryScenario({
      control,
      evaluateOptions,
      waitForDownloads,
      filename: `template-library-${browserLabel}`,
      content: `${browserLabel} template library e2e`,
    });
  });

  test("visual routing edits persist and connect to the debugger", async () => {
    await runRoutingVisualEditorScenario({
      control,
      evaluateOptions,
      ...(reloadOptions ? { reloadOptions } : {}),
    });
  });

  test(
    browserLabel === "chrome"
      ? "shortcut files download with redirect content"
      : "shortcut files keep their extension and redirect content",
    async () => {
      await runShortcutScenario({ control, waitForDownloads });
    },
  );

  test("failed downloads are recorded in the debug log", async () => {
    await runFailedDownloadLogScenario({
      control,
      waitForLog,
      ...(failedDownloadFilename ? { filename: failedDownloadFilename } : {}),
    });
    await afterFailedDownload?.();
  });

  test("a failed download is retried automatically via background fetch", async () => {
    await runAutomaticRetryScenario({
      control,
      waitForDownloads,
      filename: `flaky-${browserLabel}.bin`,
    });
  });
};
