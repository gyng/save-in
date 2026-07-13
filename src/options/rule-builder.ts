import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";

// Guided rule input and template library for the Dynamic Downloads rules
// textarea. Both compose complete rules and append them through the normal
// input event pipeline, so autosave, validation, and the routing preview
// all react as if the user had typed the rule.

import { PathEditor } from "./path-editor.ts";
import { sortClauses } from "./vocabulary-groups.ts";
import { getMessage } from "../platform/localization.ts";
import { localizeRuleTemplates } from "./rule-templates.ts";

export { RULE_TEMPLATES } from "./rule-templates.ts";

const MATCHER_PATTERN_PLACEHOLDERS: Record<string, string> = {
  context: "media|link|page|tab",
  menuindex: "images|documents",
  comment: "favorites|work",
  fileext: "jpg|png",
  urlfileext: "pdf|epub",
  actualfileext: "jpg|png",
  filename: "^invoice.*\\.pdf$",
  frameurl: "example\\.com/embed",
  linktext: "download|save",
  mediatype: "image|video",
  naivefilename: "^photo-",
  pagedomain: "(^|\\.)example\\.com$",
  sourcedomain: "(^|\\.)cdn\\.example\\.com$",
  pagetitle: "invoice|receipt",
  pageurl: "example\\.com/gallery",
  selectiontext: "invoice|receipt",
  sourceurl: "/images/|/media/",
};

export const RuleBuilder = {
  // Appends a complete rule, separated by the blank line the parser uses
  // as a rule boundary. Goes through PathEditor.insertText so the edit
  // joins the undo stack and fires the input pipeline
  appendRule: (textarea: HTMLTextAreaElement, rule: string): void => {
    const trimmedEnd = textarea.value.replace(/\s+$/, "").length;
    const separator = trimmedEnd > 0 ? "\n\n" : "";
    PathEditor.insertText(textarea, `${separator}${rule}\n`, trimmedEnd, textarea.value.length);
  },

  setupGuidedInput: () => {
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;
    const matcher = document.querySelector("#rule-builder-matcher") as HTMLSelectElement;
    const pattern = document.querySelector("#rule-builder-pattern") as HTMLInputElement;
    const into = document.querySelector("#rule-builder-into") as HTMLInputElement;
    const add = document.querySelector("#rule-builder-add") as HTMLButtonElement;
    if (!textarea || !matcher || !pattern || !into || !add) {
      return;
    }

    const updatePatternPlaceholder = () => {
      pattern.placeholder = MATCHER_PATTERN_PLACEHOLDERS[matcher.value] || ".*";
    };

    // The matcher list comes from the background routing module, like the
    // autocomplete keywords do
    sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
      .then((response) => {
        const matchers = "matchers" in response.body ? response.body.matchers : [];
        sortClauses(matchers).forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          matcher.appendChild(option);
        });
        // Prefer URL-path extension matching for new rules because it ignores
        // query strings and fragments. Keep fileext as a compatibility fallback
        // when an older background does not advertise urlfileext yet.
        const matcherNames = [...matcher.options].map((option) => option.value);
        if (matcherNames.includes("urlfileext")) matcher.value = "urlfileext";
        else if (matcherNames.includes("fileext")) matcher.value = "fileext";
        updatePatternPlaceholder();
        sync();
      })
      .catch(() => {});

    const sync = () => {
      add.disabled = !(matcher.value && pattern.value.trim() && into.value.trim());
    };
    [matcher, pattern, into].forEach((el) => {
      el.addEventListener("input", sync);
      el.addEventListener("change", sync);
    });
    matcher.addEventListener("change", updatePatternPlaceholder);
    updatePatternPlaceholder();
    sync();

    add.addEventListener("click", () => {
      RuleBuilder.appendRule(
        textarea,
        `${matcher.value}: ${pattern.value.trim()}\ninto: ${into.value.trim()}`,
      );
      pattern.value = "";
      sync();
    });
  },

  renderTemplates: (localize: (key: string) => string = () => "") => {
    const containers = [
      ...new Set(
        document.querySelectorAll<HTMLElement>("[data-rule-template-library], #rule-templates"),
      ),
    ];
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;
    if (containers.length === 0 || !textarea) {
      return;
    }

    containers.forEach((container) => {
      container.replaceChildren();
      const syncs: Array<() => void> = [];
      const rows: HTMLElement[] = [];
      let filter: HTMLInputElement | null = null;
      let applyFilter = () => {};
      let category = "";
      let categoryList: HTMLElement | null = null;

      localizeRuleTemplates(localize).forEach((tpl) => {
        if (tpl.category !== category) {
          category = tpl.category;
          const section = document.createElement("section");
          section.className = "rule-template-category";
          const heading = document.createElement("h3");
          heading.textContent = category;
          categoryList = document.createElement("div");
          categoryList.className = "rule-template-category-list";
          section.append(heading, categoryList);
          container.append(section);
        }
        const row = document.createElement("div");
        row.className = "rule-template";
        row.dataset.search = `${tpl.name} ${tpl.description} ${tpl.rule}`.toLocaleLowerCase();
        rows.push(row);

        const body = document.createElement("div");
        body.className = "rule-template-body";

        const name = document.createElement("div");
        name.className = "rule-template-name";
        name.textContent = tpl.name;
        body.appendChild(name);

        const description = document.createElement("div");
        description.className = "caption rule-template-desc";
        description.textContent = tpl.description;
        body.appendChild(description);

        // Preserve the matcher/destination line break so the preview teaches the
        // same grammar users see in the rules editor.
        const ruleEl = document.createElement("pre");
        ruleEl.className = "rule-template-rule";
        ruleEl.textContent = tpl.rule;
        body.appendChild(ruleEl);

        const add = document.createElement("button");
        add.type = "button";
        add.className = "rule-template-add";

        const sync = () => {
          const present = textarea.value.includes(tpl.rule);
          add.disabled = present;
          add.textContent = present
            ? localize("ruleTemplateAdded") || "Added"
            : localize("ruleTemplateAdd") || "Add";
        };
        syncs.push(sync);
        sync();

        add.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          // Prepend the description as a comment (parseRules strips //-lines)
          // so the added rule is self-documenting in the textarea
          RuleBuilder.appendRule(textarea, `// ${tpl.name}: ${tpl.description}\n${tpl.rule}`);
          if (filter?.value) {
            filter.value = "";
            applyFilter();
          }
          syncs.forEach((fn) => fn());
          const feedback =
            (container.id === "rule-templates"
              ? document.querySelector<HTMLElement>("#reference-dialog .template-feedback")
              : container
                  .closest(".rule-template-surface")
                  ?.querySelector<HTMLElement>(".template-feedback")) ||
            document.querySelector<HTMLElement>(".template-feedback");
          if (feedback) {
            feedback.replaceChildren(
              `${localize("ruleTemplateAddedFeedback") || "Added"} “${tpl.name}”. `,
            );
            const view = document.createElement("button");
            view.type = "button";
            view.textContent = localize("ruleTemplateViewInEditor") || "View in rules editor";
            view.addEventListener("click", () => {
              document.querySelector<HTMLDialogElement>("#reference-dialog")?.close();
              document.dispatchEvent(
                new CustomEvent("save-in:navigate-option", { detail: { target: textarea } }),
              );
            });
            feedback.append(view);
            feedback.hidden = false;
          }
        });

        row.appendChild(body);
        row.appendChild(add);
        categoryList?.appendChild(row);
      });

      filter =
        container.id === "rule-templates"
          ? document.querySelector<HTMLInputElement>(
              "#reference-dialog .reference-dialog-filter.rule-template-filter",
            ) || document.querySelector<HTMLInputElement>(".rule-template-filter")
          : container
              .closest(".rule-template-surface")
              ?.querySelector<HTMLInputElement>(".rule-template-filter") || null;
      applyFilter = () => {
        const query = filter?.value.trim().toLocaleLowerCase() || "";
        rows.forEach(
          (row) => (row.hidden = Boolean(query) && !row.dataset.search?.includes(query)),
        );
        container.querySelectorAll<HTMLElement>(".rule-template-category").forEach((section) => {
          section.hidden = !section.querySelector(".rule-template:not([hidden])");
        });
      };
      filter?.addEventListener("input", applyFilter);
      filter?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const first = rows.find((row) => !row.hidden)?.querySelector<HTMLButtonElement>("button");
        if (!first) return;
        event.preventDefault();
        first.click();
      });

      textarea.addEventListener("input", () => syncs.forEach((fn) => fn()));
      // restoreOptions fills the textarea programmatically (no input event);
      // re-check the Added states once options have had a chance to load
      window.setTimeout(() => syncs.forEach((fn) => fn()), 1000);
    });
  },
};

export const setupRuleBuilder = () => {
  RuleBuilder.setupGuidedInput();
  RuleBuilder.renderTemplates(getMessage);
};
