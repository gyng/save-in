import fs from "node:fs";
import http from "node:http";

import { expect } from "vitest";

import { closeLocal, listenLocal, requireValue } from "./helpers.mjs";

/** @typedef {import("./control-protocol.mjs").DownloadSummary} DownloadSummary */

const PDF_TEMPLATE_MATCHER = "mime: ^application/pdf$";
const PDF_TEMPLATE_DESTINATION = "into: documents/:filename:";

/**
 * @param {{
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluateOptions: (expression: string) => Promise<unknown>,
 *   waitForDownloads: (filename: string) => Promise<DownloadSummary[]>,
 *   filename: string,
 *   content: string,
 * }} adapters
 */
export const runTemplateLibraryScenario = async ({
  control,
  evaluateOptions,
  waitForDownloads,
  filename,
  content,
}) => {
  const previous = await control.storage.local.get("filenamePatterns");

  try {
    await evaluateOptions(`(() => {
      document.querySelector("#tab-section-dynamic-downloads")?.click();
      document.querySelector("#rules-mode-text")?.click();
      const rules = document.querySelector("#filenamePatterns");
      if (!(rules instanceof HTMLTextAreaElement)) return false;
      rules.focus();
      document.querySelector('[data-reference-tab="options-reference-templates"]')?.click();
      return true;
    })()`);
    await evaluateOptions(`new Promise((resolve, reject) => {
          const dialog = document.querySelector("#reference-dialog");
          const library = document.querySelector("#rule-templates");
          const apply = document.querySelector('button[data-apply="filenamePatterns"]');
          const rules = document.querySelector("#filenamePatterns");
          if (!(dialog instanceof HTMLDialogElement) ||
              !(library instanceof HTMLElement) ||
              !(apply instanceof HTMLButtonElement) ||
              !(rules instanceof HTMLTextAreaElement)) {
            reject(new Error("Template controls are unavailable"));
            return;
          }
          const timeout = AbortSignal.timeout(8000);
          let added = false;
          let applied = false;
          let appliedValue;
          let storedValue;
          let observer;
          const finish = (callback) => {
            observer?.disconnect();
            timeout.removeEventListener("abort", onTimeout);
            browser.storage.onChanged.removeListener(onStorage);
            rules.removeEventListener("options-value-applied", onApplied);
            callback();
          };
          const matchesTemplate = (value) =>
            typeof value === "string" &&
            value.includes(${JSON.stringify(PDF_TEMPLATE_MATCHER)}) &&
            value.includes(${JSON.stringify(PDF_TEMPLATE_DESTINATION)});
          const finishWhenSaved = () => {
            if (matchesTemplate(appliedValue) && matchesTemplate(storedValue)) {
              finish(() => resolve(storedValue));
            }
          };
          const onApplied = (event) => {
            appliedValue = event.detail;
            finishWhenSaved();
          };
          const onStorage = (changes, area) => {
            if (area === "local" && changes.filenamePatterns) {
              storedValue = changes.filenamePatterns.newValue;
              finishWhenSaved();
            }
          };
          const check = () => {
            if (document.documentElement.classList.contains("localization-pending")) return;
            if (rules.closest(".tab-panel")?.hidden) return;
            const template = [...library.querySelectorAll(".rule-template")].find((candidate) =>
              candidate.querySelector(".rule-template-rule")?.textContent?.includes(
                ${JSON.stringify(PDF_TEMPLATE_MATCHER)},
              ),
            );
            const add = template?.querySelector(".rule-template-add");
            if (!added && add instanceof HTMLButtonElement && !add.disabled) {
              added = true;
              add.click();
            }
            if (added && dialog.open) {
              const view = dialog.querySelector(".template-feedback button");
              if (view instanceof HTMLButtonElement) view.click();
            }
            if (added && !applied && !apply.disabled) {
              applied = true;
              apply.click();
              void browser.storage.local.get("filenamePatterns")
                .then((stored) => {
                  storedValue = stored.filenamePatterns;
                  finishWhenSaved();
                });
            }
          };
          const onTimeout = () => finish(() => reject(new Error(JSON.stringify({
            dialogOpen: dialog.open,
            visibleTemplates: library.querySelectorAll(".rule-template:not([hidden])").length,
            applyDisabled: apply.disabled,
            applied,
            appliedValue,
            storedValue,
            rules: rules.value,
          }))));
          observer = new MutationObserver(check);
          observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ["class", "disabled", "hidden", "value"],
          });
          timeout.addEventListener("abort", onTimeout, { once: true });
          browser.storage.onChanged.addListener(onStorage);
          rules.addEventListener("options-value-applied", onApplied);
          check();
        })`);
    await control.runtime.reset();

    const body = Buffer.from(content);
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": body.length,
      });
      response.end(body);
    });
    const port = await listenLocal(server);
    try {
      await control.background.startDownload({
        url: `http://127.0.0.1:${port}/${filename}`,
        suggestedFilename: filename,
        pageUrl: `http://127.0.0.1:${port}/`,
      });
      const downloads = await waitForDownloads(filename);
      const completed = requireValue(
        downloads.find((entry) => entry.state === "complete"),
        "Template-library download did not complete",
      );
      const routedName = completed.filename.replaceAll("\\", "/").split("/documents/")[1];
      expect([filename, `${filename}.pdf`]).toContain(routedName);
      expect(fs.readFileSync(completed.filename, "utf8")).toBe(content);
    } finally {
      await closeLocal(server);
    }
  } finally {
    await control.storage.local.set(previous);
    if (!Object.hasOwn(previous, "filenamePatterns")) {
      await control.storage.local.remove("filenamePatterns");
    }
    await control.runtime.reset();
  }
};
