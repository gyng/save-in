import { webExtensionApi } from "../platform/web-extension-api.ts";

// Guided rule input and template library for the Dynamic Downloads rules
// textarea. Both compose complete rules and append them through the normal
// input event pipeline, so autosave, validation, and the routing preview
// all react as if the user had typed the rule.

import { PathEditor } from "./path-editor.ts";
import { sortClauses } from "./vocabulary-groups.ts";
import { RULE_TEMPLATES } from "./rule-templates.ts";

export { RULE_TEMPLATES } from "./rule-templates.ts";

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

    // The matcher list comes from the background routing module, like the
    // autocomplete keywords do
    webExtensionApi.runtime
      .sendMessage({ type: "GET_KEYWORDS" })
      .then((res: { body?: { matchers?: string[] } } | undefined) => {
        sortClauses(res?.body?.matchers || []).forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          matcher.appendChild(option);
        });
        // fileext is the most common matcher; context (first in the routing
        // object order) is an obscure default
        if ([...matcher.options].some((o) => o.value === "fileext")) {
          matcher.value = "fileext";
        }
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

  renderTemplates: () => {
    const container = document.querySelector("#rule-templates");
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;
    if (!container || !textarea) {
      return;
    }

    container.replaceChildren();
    const syncs: Array<() => void> = [];
    const rows: HTMLElement[] = [];
    let category = "";
    let categoryList: HTMLElement | null = null;

    RULE_TEMPLATES.forEach((tpl) => {
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

      // The rule itself, compact (newlines joined); full text on hover
      const ruleEl = document.createElement("code");
      ruleEl.className = "rule-template-rule";
      ruleEl.textContent = tpl.rule.replace(/\n/g, "  ");
      ruleEl.title = tpl.rule;
      body.appendChild(ruleEl);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "rule-template-add";

      const sync = () => {
        const present = textarea.value.includes(tpl.rule);
        add.disabled = present;
        add.textContent = present ? "Added" : "Add";
      };
      syncs.push(sync);
      sync();

      add.addEventListener("click", () => {
        // Prepend the description as a comment (parseRules strips //-lines)
        // so the added rule is self-documenting in the textarea
        RuleBuilder.appendRule(textarea, `// ${tpl.name}: ${tpl.description}\n${tpl.rule}`);
        syncs.forEach((fn) => fn());
      });

      row.appendChild(body);
      row.appendChild(add);
      categoryList?.appendChild(row);
    });

    const filter = document.querySelector<HTMLInputElement>(".rule-template-filter");
    const applyFilter = () => {
      const query = filter?.value.trim().toLocaleLowerCase() || "";
      rows.forEach((row) => (row.hidden = Boolean(query) && !row.dataset.search?.includes(query)));
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
  },
};

document.addEventListener("DOMContentLoaded", () => {
  RuleBuilder.setupGuidedInput();
  RuleBuilder.renderTemplates();
});
