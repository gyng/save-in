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
  runRoutingActionsScenario,
  runShortcutScenario,
  runSymlinkDestinationScenario,
  runTabStripScenario,
  runRerouteLastSaveScenario,
  runUndoLastSaveScenario,
} from "../shared-scenarios.mjs";
import { runTemplateLibraryScenario } from "../template-library-scenario.mjs";
import { runRoutingVisualEditorScenario } from "../routing-visual-editor-scenario.mjs";
import { runHistoryMemoryScenario } from "../history-memory-scenario.mjs";
import { decodeBoolean, decodeString, evaluateJson, objectOf, requireValue } from "../helpers.mjs";

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

  test("routing exclusions and post-save tab actions respect browser lifecycle", async () => {
    await runRoutingActionsScenario({
      control,
      waitForDownloads,
      filename: `routing-actions-${browserLabel}`,
    });
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

  test("Restore defaults refreshes controls before reporting success", async () => {
    await control.options.set({ paths: "e2e/reset-custom", quickSaveEnabled: true });
    const restored = await evaluateJson(
      evaluateOptions,
      `new Promise((resolve, reject) => {
      const paths = document.querySelector("#paths");
      const quickSave = document.querySelector("#quickSaveEnabled");
      const button = document.querySelector("#reset");
      const status = document.querySelector("#settings-reset-status");
      if (!paths || !quickSave || !button || !status) {
        reject(new Error("Reset controls are missing"));
        return;
      }
      paths.value = "e2e/reset-custom";
      quickSave.checked = true;
      const observer = new MutationObserver(() => {
        if (button.disabled || status.hidden) return;
        observer.disconnect();
        resolve(JSON.stringify({ paths: paths.value, quickSave: quickSave.checked, role: status.getAttribute("role") }));
      });
      observer.observe(status, { attributes: true, childList: true, subtree: true });
      button.click();
      document.querySelector(".reset-settings-confirm")?.click();
    })`,
      objectOf({ paths: decodeString, quickSave: decodeBoolean, role: decodeString }),
    );
    const paths = await control.options.get("paths");
    expect(paths).not.toBe("e2e/reset-custom");
    expect(restored).toEqual({ paths, quickSave: false, role: "status" });
    expect(await control.options.get("quickSaveEnabled")).toBe(false);
  });

  test("History limit edits confirm reductions from malformed stored settings", async () => {
    await control.storage.local.set({ historyRetentionLimit: null });
    await control.runtime.reset();
    // Reload once so the form and its persisted snapshot both read the legacy value.
    await reloadOptions?.();
    const result = await evaluateJson(
      evaluateOptions,
      `new Promise((resolve, reject) => {
      const input = document.querySelector("#historyRetentionLimit");
      if (!input) {
        reject(new Error("History limit control is missing"));
        return;
      }
      const initial = input.value;
      const observer = new MutationObserver(() => {
        const dialog = document.querySelector(".history-retention-dialog");
        if (!dialog) return;
        observer.disconnect();
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        // Capture the restored control at the next paint, after the decline settles.
        requestAnimationFrame(() => resolve(JSON.stringify({ initial, restored: input.value })));
      });
      observer.observe(document.body, { childList: true });
      input.value = "100";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })`,
      objectOf({ initial: decodeString, restored: decodeString }),
    );
    expect(result).toEqual({ initial: "10000", restored: "10000" });
    expect(await control.storage.local.get("historyRetentionLimit")).toEqual({
      historyRetentionLimit: null,
    });
  });

  test("Settings import can keep the default History limit while applying other settings", async () => {
    await control.storage.local.remove("historyRetentionLimit");
    await control.runtime.reset();
    const imported = await evaluateJson(
      evaluateOptions,
      `new Promise((resolve, reject) => {
      const button = document.querySelector("#settings-import");
      if (!button) {
        reject(new Error("Import control is missing"));
        return;
      }
      const originalPrompt = window.prompt;
      const originalAlert = window.alert;
      let confirmed = false;
      const observer = new MutationObserver(() => {
        const dialog = document.querySelector(".history-retention-dialog");
        if (!dialog) return;
        confirmed = true;
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      });
      observer.observe(document.body, { childList: true });
      window.prompt = () => JSON.stringify({ paths: "e2e/import-kept", historyRetentionLimit: 10 });
      window.alert = message => {
        observer.disconnect();
        window.prompt = originalPrompt;
        window.alert = originalAlert;
        resolve(JSON.stringify({
          confirmed,
          message,
          limit: document.querySelector("#historyRetentionLimit")?.value,
        }));
      };
      button.click();
    })`,
      objectOf({ confirmed: decodeBoolean, message: decodeString, limit: decodeString }),
    );
    expect(imported).toEqual({ confirmed: true, message: "Settings loaded.", limit: "10000" });
    expect(await control.options.get("paths")).toBe("e2e/import-kept");
    expect(await control.storage.local.get("historyRetentionLimit")).toEqual({});
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
