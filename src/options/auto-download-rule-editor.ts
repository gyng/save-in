import {
  AUTO_DOWNLOAD_MATCHERS,
  parseAutoDownloadRules,
  serializeAutoDownloadRules,
  type AutoDownloadMatcherName,
  type EditableAutoDownloadRule,
} from "../automation/auto-download-rules.ts";
import { getMessage } from "../platform/localization.ts";

const localize = (key: string, fallback: string): string => getMessage(key) || fallback;

const actionButton = (label: string, title: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "auto-rule-icon-button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
};

const editableRules = (source: string): EditableAutoDownloadRule[] | null => {
  const parsed = parseAutoDownloadRules(source);
  if (parsed.errors.length) return null;
  return parsed.rules.map((rule) => ({
    name: rule.name,
    enabled: rule.enabled,
    destination: rule.destination,
    matchers: rule.matchers.map(({ name, pattern, flags }) => ({ name, pattern, flags })),
  }));
};

export const setupAutoDownloadRuleEditor = (): void => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#autoDownloadRules");
  const visualTab = document.querySelector<HTMLButtonElement>("#auto-rules-mode-visual");
  const textTab = document.querySelector<HTMLButtonElement>("#auto-rules-mode-text");
  const visualPanel = document.querySelector<HTMLElement>("#auto-rules-visual");
  const textPanel = document.querySelector<HTMLElement>("#auto-rules-text");
  const cards = document.querySelector<HTMLElement>("#auto-rule-cards");
  const addRule = document.querySelector<HTMLButtonElement>("#auto-rule-add");
  if (!textarea || !visualTab || !textTab || !visualPanel || !textPanel || !cards || !addRule)
    return;

  let drafts: EditableAutoDownloadRule[] = [];
  let visual = true;
  let committing = false;

  const commit = (rerender = false) => {
    const source = serializeAutoDownloadRules(drafts);
    if (source !== textarea.value) {
      committing = true;
      textarea.value = source;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
      committing = false;
    }
    if (rerender) render();
  };

  const matcherRow = (
    rule: EditableAutoDownloadRule,
    matcherIndex: number,
    rerender: () => void,
  ): HTMLElement => {
    const matcher = rule.matchers[matcherIndex]!;
    const row = document.createElement("div");
    row.className = "auto-rule-condition";

    const name = document.createElement("select");
    name.setAttribute("aria-label", localize("autoDownloadCondition", "Condition"));
    AUTO_DOWNLOAD_MATCHERS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      name.append(option);
    });
    name.value = matcher.name;
    name.addEventListener("change", () => {
      matcher.name = name.value as AutoDownloadMatcherName;
      commit();
    });

    const pattern = document.createElement("input");
    pattern.type = "text";
    pattern.value = matcher.pattern;
    pattern.spellcheck = false;
    pattern.placeholder = ".*";
    pattern.setAttribute("aria-label", localize("autoDownloadPattern", "Pattern"));
    pattern.addEventListener("input", () => {
      matcher.pattern = pattern.value;
      commit();
    });

    const ignoreCase = document.createElement("label");
    ignoreCase.className = "auto-rule-ignore-case";
    ignoreCase.title = localize("autoDownloadIgnoreCaseHelp", "Match uppercase and lowercase");
    const insensitive = document.createElement("input");
    insensitive.type = "checkbox";
    insensitive.checked = matcher.flags.includes("i");
    insensitive.setAttribute("aria-label", localize("autoDownloadIgnoreCase", "Ignore case"));
    insensitive.addEventListener("change", () => {
      matcher.flags = insensitive.checked ? "i" : "";
      commit();
    });
    ignoreCase.append(insensitive, document.createTextNode(" Aa"));

    const remove = actionButton("×", localize("autoDownloadDeleteCondition", "Delete condition"));
    remove.addEventListener("click", () => {
      rule.matchers.splice(matcherIndex, 1);
      commit();
      rerender();
    });
    row.append(name, pattern, ignoreCase, remove);
    return row;
  };

  const render = () => {
    cards.replaceChildren();
    const parsedDrafts = editableRules(textarea.value);
    if (!committing && parsedDrafts) drafts = parsedDrafts;
    if (!parsedDrafts && textarea.value.trim()) {
      const warning = document.createElement("div");
      warning.className = "auto-rule-visual-warning";
      warning.textContent = localize(
        "autoDownloadVisualInvalid",
        "Fix the text-rule errors before returning to Visual mode.",
      );
      cards.append(warning);
      return;
    }
    if (drafts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "auto-rule-empty";
      empty.textContent = localize(
        "autoDownloadEmpty",
        "No automation rules yet. Add a disabled starter rule and scope it to a site.",
      );
      cards.append(empty);
      return;
    }

    drafts.forEach((rule, ruleIndex) => {
      const card = document.createElement("section");
      card.className = "auto-rule-card";
      card.classList.toggle("is-disabled", !rule.enabled);

      const header = document.createElement("header");
      const enabled = document.createElement("label");
      enabled.className = "auto-rule-enabled";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = rule.enabled;
      checkbox.addEventListener("change", () => {
        rule.enabled = checkbox.checked;
        card.classList.toggle("is-disabled", !rule.enabled);
        commit();
      });
      const identity = document.createElement("span");
      identity.textContent = localize("autoDownloadRule", "Rule").concat(` ${ruleIndex + 1}`);
      enabled.append(checkbox, identity);

      const actions = document.createElement("div");
      actions.className = "auto-rule-actions";
      const up = actionButton("↑", localize("autoDownloadMoveUp", "Move rule up"));
      up.disabled = ruleIndex === 0;
      up.addEventListener("click", () => {
        drafts.splice(ruleIndex - 1, 0, ...drafts.splice(ruleIndex, 1));
        commit(true);
      });
      const down = actionButton("↓", localize("autoDownloadMoveDown", "Move rule down"));
      down.disabled = ruleIndex === drafts.length - 1;
      down.addEventListener("click", () => {
        drafts.splice(ruleIndex + 1, 0, ...drafts.splice(ruleIndex, 1));
        commit(true);
      });
      const remove = actionButton("×", localize("autoDownloadDeleteRule", "Delete rule"));
      remove.addEventListener("click", () => {
        drafts.splice(ruleIndex, 1);
        commit(true);
      });
      actions.append(up, down, remove);
      header.append(enabled, actions);

      const body = document.createElement("div");
      body.className = "auto-rule-body";
      const nameLabel = document.createElement("label");
      nameLabel.className = "auto-rule-name";
      const nameText = document.createElement("span");
      nameText.textContent = localize("autoDownloadRuleName", "Rule name");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = rule.name;
      nameInput.addEventListener("input", () => {
        rule.name = nameInput.value;
        commit();
      });
      nameLabel.append(nameText, nameInput);
      body.append(nameLabel);

      const conditions = document.createElement("div");
      conditions.className = "auto-rule-conditions";
      const rerender = () => render();
      rule.matchers.forEach((_matcher, matcherIndex) =>
        conditions.append(matcherRow(rule, matcherIndex, rerender)),
      );
      const addCondition = document.createElement("button");
      addCondition.type = "button";
      addCondition.className = "auto-rule-add-condition";
      addCondition.textContent = `+ ${localize("autoDownloadAddCondition", "Add condition")}`;
      addCondition.addEventListener("click", () => {
        const hasPage = rule.matchers.some(({ name }) => name.startsWith("page"));
        rule.matchers.push({
          name: hasPage ? "sourcekind" : "pageurl",
          pattern: hasPage ? "image" : "^https://example\\.com/",
          flags: "",
        });
        commit(true);
      });
      conditions.append(addCondition);
      body.append(conditions);

      const destinationLabel = document.createElement("label");
      destinationLabel.className = "auto-rule-destination";
      const destinationText = document.createElement("span");
      destinationText.textContent = localize("autoDownloadDestination", "Save to");
      const destination = document.createElement("input");
      destination.type = "text";
      destination.value = rule.destination;
      destination.placeholder = "automatic/:pagedomain:/";
      destination.addEventListener("input", () => {
        rule.destination = destination.value;
        commit();
      });
      destinationLabel.append(destinationText, destination);
      body.append(destinationLabel);
      card.append(header, body);
      cards.append(card);
    });
  };

  const setMode = (nextVisual: boolean) => {
    visual = nextVisual;
    visualTab.classList.toggle("active", visual);
    textTab.classList.toggle("active", !visual);
    visualTab.setAttribute("aria-selected", String(visual));
    textTab.setAttribute("aria-selected", String(!visual));
    visualPanel.hidden = !visual;
    textPanel.hidden = visual;
    if (visual) render();
    try {
      localStorage.setItem("saveInAutoRulesEditorMode", visual ? "visual" : "text");
    } catch {
      // Storage may be unavailable in hardened extension contexts.
    }
  };

  visualTab.addEventListener("click", () => setMode(true));
  textTab.addEventListener("click", () => setMode(false));
  textarea.addEventListener("input", () => {
    if (!committing && visual) render();
  });
  document.addEventListener("options-restored", () => render());
  addRule.addEventListener("click", () => {
    drafts.push({
      name: localize("autoDownloadNewRule", "New automatic rule"),
      enabled: false,
      matchers: [
        { name: "pageurl", pattern: "^https://example\\.com/", flags: "" },
        { name: "sourcekind", pattern: "image", flags: "" },
      ],
      destination: "automatic/:pagedomain:/",
    });
    commit(true);
  });

  let preferred = "visual";
  try {
    preferred = localStorage.getItem("saveInAutoRulesEditorMode") || preferred;
  } catch {
    // Use the visual default.
  }
  setMode(preferred !== "text");
};
