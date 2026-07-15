import { expect } from "vitest";

import {
  decodeBoolean,
  decodeNumber,
  decodeString,
  evaluateJson,
  nullable,
  objectOf,
  optional,
  poll,
  requireValue,
  waitForPageCondition,
} from "./helpers.mjs";

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
 *   control: ReturnType<typeof import("./control-client.mjs").createE2EControlClient>,
 *   evaluateOptions: (expression: string) => Promise<unknown>,
 *   reloadOptions?: () => Promise<unknown>,
 * }} adapters
 */
export const runRoutingVisualEditorScenario = async ({
  control,
  evaluateOptions,
  reloadOptions = () => evaluateOptions(`location.reload()`),
}) => {
  const previousConfig = await control.storage.local.get("filenamePatterns");
  const previousMode = nullable(decodeString)(
    await evaluateOptions(`localStorage.getItem("saveInRulesEditorMode")`),
  );

  try {
    await control.options.set({ filenamePatterns: VISUAL_RULE_SOURCE });
    await reloadOptions();
    await poll(
      async () =>
        (await evaluateOptions(`(() => {
          const source = document.querySelector("#filenamePatterns");
          return document.readyState === "complete" &&
            source?.value === ${JSON.stringify(VISUAL_RULE_SOURCE)};
        })()`)) === true || null,
      { description: "routing rules loaded in Options", ignoreErrors: true },
    );

    const initial = await evaluateJson(
      evaluateOptions,
      `JSON.stringify((() => {
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
      })())`,
      objectOf({
        textHidden: decodeBoolean,
        visualHidden: decodeBoolean,
        cardCount: decodeNumber,
        firstLine: optional(decodeString),
        firstValue: optional(decodeString),
        secondEnabled: optional(decodeBoolean),
      }),
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

    await waitForPageCondition(
      evaluateOptions,
      `(() => {
        const apply = document.querySelector('#rules-visual [data-apply="filenamePatterns"]');
        return apply instanceof HTMLButtonElement && !apply.disabled;
      })()`,
      { description: "valid visual routing edits ready to apply" },
    );
    await evaluateOptions(`(() => {
      const apply = document.querySelector('#rules-visual [data-apply="filenamePatterns"]');
      if (!(apply instanceof HTMLButtonElement) || apply.disabled) return false;
      apply.click();
      return true;
    })()`);

    const persisted = decodeString(
      await control.storage.local.wait("filenamePatterns", EDITED_RULE_SOURCE),
    );
    expect(persisted).toBe(EDITED_RULE_SOURCE);

    await reloadOptions();
    const restored = await poll(
      async () => {
        const state = await evaluateJson(
          evaluateOptions,
          `JSON.stringify((() => {
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
          })())`,
          objectOf({
            ready: decodeString,
            visualSelected: optional(decodeString),
            textHidden: decodeBoolean,
            cardCount: decodeNumber,
            firstValue: optional(decodeString),
            secondDisabled: decodeBoolean,
            secondEnabled: optional(decodeBoolean),
          }),
        );
        return state.ready === "complete" && state.cardCount === 2 ? state : null;
      },
      { description: "visual routing editor restored after reload", ignoreErrors: true },
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

    const hasLastDownload =
      (await evaluateOptions(`browser.runtime.sendMessage({ type: "CHECK_ROUTES" }).then(
        (response) => response?.body?.lastDownload != null,
      )`)) === true;
    if (hasLastDownload) {
      await waitForPageCondition(
        evaluateOptions,
        `(() => {
          const useLast = document.querySelector("#route-debugger-use-last");
          return useLast instanceof HTMLButtonElement && !useLast.disabled;
        })()`,
        { description: "route debugger last-download initialization" },
      );
    }

    await evaluateOptions(`(() => {
      document.querySelector("#route-debugger-clear")?.click();
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
    await waitForPageCondition(
      evaluateOptions,
      `document.querySelector("#route-debugger-result")?.dataset.state === "matched"`,
      { description: "visual routing debugger match" },
    );
    const sourceNavigation = requireValue(
      await evaluateJson(
        evaluateOptions,
        `JSON.stringify((() => {
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
      })())`,
        nullable(
          objectOf({
            ruleIndex: optional(decodeString),
            activeLine: optional(decodeString),
          }),
        ),
      ),
      "Visual routing source navigation was unavailable",
    );
    expect(sourceNavigation).toEqual({ ruleIndex: "0", activeLine: "2" });
  } finally {
    await control.storage.local.set(previousConfig);
    if (!Object.hasOwn(previousConfig, "filenamePatterns")) {
      await control.storage.local.remove("filenamePatterns");
    }
    await control.runtime.reset();
    await evaluateOptions(`(() => {
      const previous = ${JSON.stringify(previousMode)};
      if (previous === null) localStorage.removeItem("saveInRulesEditorMode");
      else localStorage.setItem("saveInRulesEditorMode", previous);
      return true;
    })()`);
  }
};
