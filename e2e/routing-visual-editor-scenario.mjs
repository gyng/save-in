import { expect } from "vitest";

import { poll } from "./helpers.mjs";

const VISUAL_RULE_SOURCE = [
  "// Product images",
  "filename/i: \\.jpg$",
  "into: images/:filename:",
  "",
  "// PDF documents",
  "mime: ^application/pdf$",
  "into: documents/:filename:",
].join("\n");
const EDITED_MATCHER = "\\.png$";
const EDITED_RULE_SOURCE = VISUAL_RULE_SOURCE.replace("\\.jpg$", EDITED_MATCHER).concat(
  "\ndisabled: true",
);

/**
 * Proves that the AST-backed visual editor survives the full Options storage
 * boundary and that debugger source navigation targets its visual projection.
 *
 * @param {{
 *   evaluate: (expression: string) => Promise<any>,
 *   evaluateOptions: (expression: string) => Promise<any>,
 *   reloadOptions?: () => Promise<any>,
 * }} adapters
 */
export const runRoutingVisualEditorScenario = async ({
  evaluate,
  evaluateOptions,
  reloadOptions = () => evaluateOptions(`location.reload()`),
}) => {
  const previousConfig = JSON.parse(
    await evaluate(
      `browser.storage.local.get("filenamePatterns").then((value) => JSON.stringify(value))`,
    ),
  );
  const previousMode = await evaluateOptions(`localStorage.getItem("saveInRulesEditorMode")`);

  try {
    await evaluate(`api.setOptions({ filenamePatterns: ${JSON.stringify(VISUAL_RULE_SOURCE)} })`);
    await reloadOptions();
    await poll(
      async () =>
        (await evaluateOptions(`(() => {
          const source = document.querySelector("#filenamePatterns");
          return document.readyState === "complete" &&
            source?.value === ${JSON.stringify(VISUAL_RULE_SOURCE)};
        })()`)) === true || null,
      { description: "routing rules loaded in Options" },
    );

    const initial = JSON.parse(
      await evaluateOptions(`JSON.stringify((() => {
        document.querySelector("#rules-mode-visual")?.click();
        const cards = [...document.querySelectorAll(".rule-editor-card")];
        return {
          textHidden: document.querySelector("#rules-text-editor")?.hidden,
          visualHidden: document.querySelector("#rules-visual")?.hidden,
          cardCount: cards.length,
          firstLine: cards[0]?.dataset.line,
          firstValue: cards[0]?.querySelector(".rule-clause-value")?.value,
          secondEnabled: cards[1]?.querySelector(".rule-editor-enabled")?.checked,
        };
      })())`),
    );
    expect(initial).toEqual({
      textHidden: true,
      visualHidden: false,
      cardCount: 2,
      firstLine: "2",
      firstValue: "\\.jpg$",
      secondEnabled: true,
    });

    await evaluateOptions(`(() => {
      const cards = [...document.querySelectorAll(".rule-editor-card")];
      const value = cards[0]?.querySelector(".rule-clause-value");
      const enabled = cards[1]?.querySelector(".rule-editor-enabled");
      if (!(value instanceof HTMLInputElement) || !(enabled instanceof HTMLInputElement)) {
        return false;
      }
      value.value = ${JSON.stringify(EDITED_MATCHER)};
      value.dispatchEvent(new InputEvent("input", { bubbles: true }));
      enabled.click();
      return true;
    })()`);

    await poll(
      async () =>
        (await evaluateOptions(`(() => {
          const apply = document.querySelector('#rules-visual [data-apply="filenamePatterns"]');
          return apply instanceof HTMLButtonElement && !apply.disabled;
        })()`)) === true || null,
      { description: "valid visual routing edits ready to apply" },
    );
    await evaluateOptions(`(() => {
      const apply = document.querySelector('#rules-visual [data-apply="filenamePatterns"]');
      if (!(apply instanceof HTMLButtonElement) || apply.disabled) return false;
      apply.click();
      return true;
    })()`);

    const persisted = await poll(
      async () => {
        const value = JSON.parse(
          await evaluate(
            `browser.storage.local.get("filenamePatterns").then((stored) => JSON.stringify(stored.filenamePatterns))`,
          ),
        );
        if (value === EDITED_RULE_SOURCE) return value;
        throw new Error(
          `Expected ${JSON.stringify(EDITED_RULE_SOURCE)}, received ${JSON.stringify(value)}`,
        );
      },
      { description: "visual routing edits persisted" },
    );
    expect(persisted).toBe(EDITED_RULE_SOURCE);

    await reloadOptions();
    const restored = await poll(
      async () => {
        const state = JSON.parse(
          await evaluateOptions(`JSON.stringify((() => {
            const cards = [...document.querySelectorAll(".rule-editor-card")];
            return {
              ready: document.readyState,
              visualSelected: document.querySelector("#rules-mode-visual")?.getAttribute("aria-selected"),
              textHidden: document.querySelector("#rules-text-editor")?.hidden,
              cardCount: cards.length,
              firstValue: cards[0]?.querySelector(".rule-clause-value")?.value,
              secondDisabled: cards[1]?.classList.contains("is-disabled"),
              secondEnabled: cards[1]?.querySelector(".rule-editor-enabled")?.checked,
            };
          })())`),
        );
        return state.ready === "complete" && state.cardCount === 2 ? state : null;
      },
      { description: "visual routing editor restored after reload" },
    );
    expect(restored).toEqual({
      ready: "complete",
      visualSelected: "true",
      textHidden: true,
      cardCount: 2,
      firstValue: "\\.png$",
      secondDisabled: true,
      secondEnabled: false,
    });

    await evaluateOptions(`(() => {
      const filename = document.querySelector("#route-debugger-filename");
      const mime = document.querySelector("#route-debugger-mime");
      if (!(filename instanceof HTMLInputElement) || !(mime instanceof HTMLInputElement)) {
        return false;
      }
      filename.value = "product.png";
      mime.value = "image/png";
      document.querySelector("#route-debugger-run")?.click();
      return true;
    })()`);
    await poll(
      async () =>
        (await evaluateOptions(
          `document.querySelector("#route-debugger-result")?.dataset.state`,
        )) === "matched" || null,
      { description: "visual routing debugger match" },
    );
    const sourceNavigation = JSON.parse(
      await evaluateOptions(`JSON.stringify((() => {
        const source = document.querySelector(
          ".route-debugger-rule.is-selected .route-debugger-source-link"
        );
        if (!(source instanceof HTMLButtonElement)) return null;
        source.click();
        const selected = document.querySelector(".rule-editor-card.is-debug-selected");
        return {
          ruleIndex: selected?.dataset.ruleIndex,
          activeLine: selected?.querySelector(".rule-clause-row.is-active")?.dataset.line,
        };
      })())`),
    );
    expect(sourceNavigation).toEqual({ ruleIndex: "0", activeLine: "2" });
  } finally {
    await evaluate(`Promise.all([
      browser.storage.local.set(${JSON.stringify(previousConfig)}),
      ${Object.hasOwn(previousConfig, "filenamePatterns") ? "Promise.resolve()" : 'browser.storage.local.remove("filenamePatterns")'},
    ]).then(() => api.reset())`);
    await evaluateOptions(`(() => {
      const previous = ${JSON.stringify(previousMode)};
      if (previous === null) localStorage.removeItem("saveInRulesEditorMode");
      else localStorage.setItem("saveInRulesEditorMode", previous);
      return true;
    })()`);
    await reloadOptions();
  }
};
