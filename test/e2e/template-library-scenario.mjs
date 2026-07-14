import fs from "node:fs";
import http from "node:http";

import { expect } from "vitest";

import { closeLocal, listenLocal, poll } from "./helpers.mjs";

const PDF_TEMPLATE_MATCHER = "mime: ^application/pdf$";
const PDF_TEMPLATE_DESTINATION = "into: documents/:filename:";

/**
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   evaluateOptions: (expression: string) => Promise<any>,
 *   waitForDownloads: (filename: string) => Promise<any[]>,
 *   filename: string,
 *   content: string,
 * }} adapters
 */
export const runTemplateLibraryScenario = async ({
  evaluate,
  evaluateOptions,
  waitForDownloads,
  filename,
  content,
}) => {
  const previous = JSON.parse(
    await evaluate(
      `Promise.resolve(api.getOption("filenamePatterns")).then((value) => JSON.stringify(value))`,
    ),
  );

  try {
    await evaluateOptions(`(() => {
      document.querySelector("#tab-section-dynamic-downloads")?.click();
      document.querySelector("#rules-mode-text")?.click();
      const rules = document.querySelector("#filenamePatterns");
      if (!(rules instanceof HTMLTextAreaElement)) return false;
      rules.focus();
      return true;
    })()`);
    await poll(
      async () =>
        (await evaluateOptions(`(() => {
          const picker = document.querySelector("#routing-template-typeahead");
          const add = document.querySelector(".rule-template-typeahead-add");
          if (!(picker instanceof HTMLInputElement) || !(add instanceof HTMLButtonElement)) {
            return false;
          }
          picker.value = ${JSON.stringify(PDF_TEMPLATE_MATCHER)};
          picker.dispatchEvent(new InputEvent("input", { bubbles: true }));
          const listbox = document.getElementById(picker.getAttribute("aria-controls") || "");
          const option = listbox?.querySelector('[role="option"]');
          if (!(option instanceof HTMLButtonElement)) {
            return false;
          }
          option.click();
          if (add.disabled) return false;
          add.click();
          return true;
        })()`)) === true,
      { description: "PDF template Add button" },
    );

    await poll(
      async () =>
        (await evaluateOptions(`(() => {
          const apply = document.querySelector('button[data-apply="filenamePatterns"]');
          return apply instanceof HTMLButtonElement && !apply.disabled;
        })()`)) === true,
      { description: "valid template rule ready to apply" },
    );
    await evaluateOptions(`(() => {
      const apply = document.querySelector('button[data-apply="filenamePatterns"]');
      if (!(apply instanceof HTMLButtonElement) || apply.disabled) return false;
      apply.click();
      return true;
    })()`);

    const persisted = await poll(
      async () => {
        const state =
          /** @type {{live: Array<Array<{name?: string, value?: unknown}>>, stored: unknown}} */ (
            JSON.parse(
              await evaluate(`Promise.all([
              api.getOption("filenamePatterns"),
              browser.storage.local.get("filenamePatterns"),
            ]).then(([live, stored]) => JSON.stringify({ live, stored: stored.filenamePatterns }))`),
            )
          );
        if (
          Array.isArray(state.live) &&
          state.live.some((rule) =>
            rule.some(
              (clause) => clause.name === "into" && clause.value === "documents/:filename:",
            ),
          ) &&
          typeof state.stored === "string" &&
          state.stored.includes(PDF_TEMPLATE_MATCHER) &&
          state.stored.includes(PDF_TEMPLATE_DESTINATION)
        ) {
          return state;
        }
        throw new Error(`Unexpected rule state: ${JSON.stringify(state)}`);
      },
      { description: "template rule in live and persisted options" },
    );
    expect(persisted.stored).toContain(PDF_TEMPLATE_MATCHER);
    expect(persisted.stored).toContain(PDF_TEMPLATE_DESTINATION);

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
      await evaluate(`api.startDownload({
        url: "http://127.0.0.1:${port}/${filename}",
        suggestedFilename: ${JSON.stringify(filename)},
        pageUrl: "http://127.0.0.1:${port}/",
      }).then(() => "started")`);
      const downloads = await waitForDownloads(filename);
      const completed = downloads.find((entry) => entry.state === "complete");

      expect(completed).toBeDefined();
      const routedName = completed.filename.replaceAll("\\", "/").split("/documents/")[1];
      expect([filename, `${filename}.pdf`]).toContain(routedName);
      expect(fs.readFileSync(completed.filename, "utf8")).toBe(content);
    } finally {
      await closeLocal(server);
    }
  } finally {
    await evaluate(`api.setOptions({ filenamePatterns: ${JSON.stringify(previous)} })`);
  }
};
