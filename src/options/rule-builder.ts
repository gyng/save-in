import { webExtensionApi } from "../web-extension-api.ts";

// Guided rule input and template library for the Dynamic Downloads rules
// textarea. Both compose complete rules and append them through the normal
// input event pipeline, so autosave, validation, and the routing preview
// all react as if the user had typed the rule.

import { PathEditor } from "./path-editor.ts";

// Every `into:` must end in a filename component (it replaces the whole
// path, not just the directory) — test/rule-builder.test.js parses each
// template through the real Router to keep these valid.
export const RULE_TEMPLATES = [
  {
    name: "Images into per-site folders",
    description: "Sorts every saved image by the site it came from",
    rule: "mediatype: image\ninto: images/:pagedomain:/:filename:",
  },
  {
    name: "Videos into per-site folders",
    description: "Same, for video",
    rule: "mediatype: video\ninto: videos/:pagedomain:/:filename:",
  },
  {
    name: "PDFs into a documents folder",
    description: "Collects every PDF in one place",
    rule: "fileext: pdf\ninto: documents/:filename:",
  },
  {
    name: "Archives into one folder",
    description: "zip/rar/7z/tar downloads land together",
    rule: "fileext: (zip|rar|7z|gz|tgz)\ninto: archives/:filename:",
  },
  {
    name: "Date-stamp every download",
    description: "Keeps the original name, prefixed with the save date",
    rule: "sourceurl: .*\ninto: :date:-:filename:",
  },
  {
    name: "Weekly inbox",
    description: "Everything into one folder per ISO week",
    rule: "sourceurl: .*\ninto: inbox/:year:-w:isoweek:/:filename:",
  },
  {
    name: "One site, one folder",
    description: "Add it, then change example.com to the site you want",
    rule: "pagedomain: example\\.com\ninto: example/:pagetitleslug:/:filename:",
  },
  {
    name: "Capture part of the URL",
    description: "Regex capture groups become :$1:, :$2:, … in the path",
    rule: "sourceurl: imgur\\.com/(\\w+)\ncapture: sourceurl\ninto: imgur/:$1:-:filename:",
  },
];

export const RuleBuilder = {
  // Appends a complete rule, separated by the blank line the parser uses
  // as a rule boundary. Goes through PathEditor.insertText so the edit
  // joins the undo stack and fires the input pipeline
  appendRule: (textarea, rule) => {
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

    // The matcher list comes from the background's Router, like the
    // autocomplete keywords do
    webExtensionApi.runtime
      .sendMessage({ type: "GET_KEYWORDS" })
      .then((res) => {
        ((res && res.body && res.body.matchers) || []).forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          matcher.appendChild(option);
        });
        // fileext is the most common matcher; context (first in Router's
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

    const syncs = [];

    RULE_TEMPLATES.forEach((tpl) => {
      const row = document.createElement("div");
      row.className = "rule-template";

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
      container.appendChild(row);
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
