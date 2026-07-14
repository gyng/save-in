import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import {
  addRoutingClause,
  addAutomaticRoutingRule,
  addRoutingRule,
  deleteRoutingClause,
  deleteRoutingRule,
  duplicateRoutingRule,
  moveRoutingRule,
  parseVisualRoutingRules,
  setRoutingRuleEnabled,
  updateRoutingClause,
  type VisualRoutingRule,
} from "./rule-visual-editor-model.ts";
import { sortClauses } from "./vocabulary-groups.ts";
import { isAutomaticRuleClauses } from "../routing/automatic-rule.ts";

const DEFAULT_MATCHERS = [
  "context",
  "menuindex",
  "comment",
  "linktext",
  "selectiontext",
  "referrerurl",
  "referrerdomain",
  "pageurl",
  "pagedomain",
  "pagerootdomain",
  "pagetitle",
  "frameurl",
  "sourceurl",
  "sourcedomain",
  "sourcerootdomain",
  "sourcekind",
  "filename",
  "naivefilename",
  "fileext",
  "urlfileext",
  "actualfileext",
  "mediatype",
  "mime",
  "contenttype",
];

type RuleVisualEditorOptions = {
  matchers?: string[];
  localize?: (key: string) => string;
};

type MessageSubstitutions = string | number | Array<string | number>;

const button = (label: string, action: string, title = label): HTMLButtonElement => {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "visual-editor-control rule-editor-control";
  control.dataset.ruleAction = action;
  control.textContent = label;
  control.title = title;
  control.setAttribute("aria-label", title);
  return control;
};

export const setupRuleVisualEditor = (options: RuleVisualEditorOptions = {}): void => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");
  const textButton = document.querySelector<HTMLButtonElement>("#rules-mode-text");
  const visualButton = document.querySelector<HTMLButtonElement>("#rules-mode-visual");
  const textEditor = document.querySelector<HTMLElement>("#rules-text-editor");
  const visualEditor = document.querySelector<HTMLElement>("#rules-visual");
  const cards = document.querySelector<HTMLElement>("#rule-editor-cards");
  const addRule = document.querySelector<HTMLButtonElement>("#rule-editor-add");
  const addAutomaticRule = document.querySelector<HTMLButtonElement>("#rule-editor-add-auto");
  const manageAutomaticRules = document.querySelector<HTMLButtonElement>(
    "#auto-download-manage-rules",
  );
  if (!textarea || !textButton || !visualButton || !textEditor || !visualEditor || !cards) return;

  const localize = (key: string, fallback: string, substitutions?: MessageSubstitutions): string =>
    (options.localize ? options.localize(key) : getMessage(key, substitutions)) || fallback;
  let matchers = sortClauses([...(options.matchers ?? DEFAULT_MATCHERS)]);
  let committing = false;
  let rebuildTimer = 0;
  let visual = false;

  const setMode = (nextVisual: boolean): void => {
    visual = nextVisual;
    textButton.classList.toggle("active", !visual);
    visualButton.classList.toggle("active", visual);
    textButton.setAttribute("aria-selected", visual ? "false" : "true");
    visualButton.setAttribute("aria-selected", visual ? "true" : "false");
    textButton.tabIndex = visual ? -1 : 0;
    visualButton.tabIndex = visual ? 0 : -1;
    textEditor.hidden = visual;
    visualEditor.hidden = !visual;
    textarea.dispatchEvent(
      new CustomEvent("syntax-editor-visibility", { detail: { visible: !visual } }),
    );
    if (visual) render();
    try {
      localStorage.setItem("saveInRulesEditorMode", visual ? "visual" : "text");
    } catch {
      // Storage may be unavailable in hardened extension contexts.
    }
  };

  const commit = (source: string, rerender = true): void => {
    if (source === textarea.value) return;
    textarea.value = source;
    committing = true;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    committing = false;
    if (rerender) render();
  };

  const selectTextSource = (line: number): void => {
    setMode(false);
    const lines = textarea.value.split("\n");
    const offset = lines
      .slice(0, Math.max(0, line - 1))
      .reduce((sum, value) => sum + value.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(
      offset,
      Math.min(textarea.value.length, offset + lines[line - 1]!.length),
    );
  };

  const createMatcherSelect = (rule: VisualRoutingRule, clauseIndex: number): HTMLSelectElement => {
    const clause = rule.clauses[clauseIndex]!;
    const select = document.createElement("select");
    select.className = "rule-clause-name visual-editor-control-field";
    select.setAttribute("aria-label", localize("routeVisualCondition", "Condition"));
    const names = [...new Set([...matchers, clause.name])];
    sortClauses(names).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    });
    select.value = clause.name;
    select.addEventListener("change", () => {
      commit(
        updateRoutingClause(textarea.value, rule.index, clause.index, { name: select.value }),
        false,
      );
    });
    return select;
  };

  const createClauseRow = (rule: VisualRoutingRule, clauseIndex: number): HTMLElement => {
    const clause = rule.clauses[clauseIndex]!;
    const row = document.createElement("div");
    row.className = `visual-editor-row rule-clause-row rule-clause-${clause.kind}`;
    row.dataset.line = String(clause.line);

    const marker = document.createElement("span");
    marker.className = "rule-clause-marker";
    marker.textContent =
      clause.kind === "destination" ? "→" : clause.kind === "capture" ? "$" : "if";
    marker.setAttribute("aria-hidden", "true");
    row.append(marker);

    if (clause.kind === "matcher") {
      row.append(createMatcherSelect(rule, clauseIndex));
    } else {
      const name = document.createElement("span");
      name.className = "rule-clause-fixed-name";
      name.textContent = clause.name;
      row.append(name);
    }

    const value = document.createElement("input");
    value.type = "text";
    value.className = "rule-clause-value";
    value.value = clause.value;
    value.spellcheck = false;
    value.placeholder = clause.kind === "destination" ? "folder/:filename:" : ".*";
    value.setAttribute(
      "aria-label",
      clause.kind === "destination"
        ? localize("routeVisualDestination", "Destination")
        : localize("routeVisualPattern", "Pattern"),
    );
    value.addEventListener("input", () => {
      commit(
        updateRoutingClause(textarea.value, rule.index, clause.index, { value: value.value }),
        false,
      );
    });
    row.append(value);

    if (clause.kind === "matcher") {
      const insensitive = document.createElement("label");
      insensitive.className = "rule-clause-flag";
      insensitive.title = localize(
        "routeVisualIgnoreCaseHelp",
        "Match uppercase and lowercase letters",
      );
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = clause.flags === "i";
      checkbox.setAttribute("aria-label", localize("routeVisualIgnoreCase", "Ignore case"));
      checkbox.addEventListener("change", () => {
        commit(
          updateRoutingClause(textarea.value, rule.index, clause.index, {
            caseInsensitive: checkbox.checked,
          }),
          false,
        );
      });
      insensitive.append(checkbox, document.createTextNode(" /i"));
      row.append(insensitive);
    }

    if (clause.kind !== "destination") {
      const remove = button(
        "×",
        "delete-clause",
        localize("routeVisualDeleteCondition", "Delete condition"),
      );
      remove.addEventListener("click", () =>
        commit(deleteRoutingClause(textarea.value, rule.index, clause.index)),
      );
      row.append(remove);
    }
    row.addEventListener("click", () => {
      cards
        .querySelectorAll(".rule-clause-row.is-active")
        .forEach((item) => item.classList.remove("is-active"));
      row.classList.add("is-active");
    });
    return row;
  };

  const createUnsupportedCard = (rule: VisualRoutingRule, card: HTMLElement): void => {
    card.classList.add("rule-editor-card-unsupported");
    const warning = document.createElement("div");
    warning.className = "rule-editor-unsupported";
    const issueLine = rule.issues[0]!.line;
    warning.textContent = localize(
      "routeVisualUnsupported",
      `This rule has syntax Visual mode cannot safely edit near line ${issueLine}.`,
      issueLine,
    ).replace("$LINE$", String(issueLine));
    const source = document.createElement("pre");
    source.className = "rule-editor-source-preview";
    source.textContent = rule.source;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "rule-editor-edit-text";
    edit.textContent = localize("routeVisualEditText", "Edit in Text");
    edit.addEventListener("click", () => selectTextSource(issueLine));
    card.append(warning, source, edit);
  };

  const createRuleCard = (rule: VisualRoutingRule, total: number): HTMLElement => {
    const card = document.createElement("section");
    card.className = "visual-editor-card rule-editor-card";
    card.dataset.ruleIndex = String(rule.index);
    card.dataset.line = String(rule.line);
    card.classList.toggle("is-disabled", !rule.enabled);

    const header = document.createElement("header");
    header.className = "visual-editor-card-header rule-editor-card-header";
    const identity = document.createElement("div");
    identity.className = "rule-editor-identity";
    const title = document.createElement("h4");
    title.id = `rule-editor-title-${rule.index}`;
    card.setAttribute("aria-labelledby", title.id);
    title.textContent = localize(
      "routeDebuggerRule",
      `Rule ${rule.index + 1}`,
      rule.index + 1,
    ).replace("$NUMBER$", String(rule.index + 1));
    const meta = document.createElement("span");
    meta.className = "caption rule-editor-meta";
    meta.textContent = rule.comment ? `L${rule.line} · ${rule.comment}` : `L${rule.line}`;
    identity.append(title, meta);
    if (isAutomaticRuleClauses(rule.clauses)) {
      const badge = document.createElement("span");
      badge.className = "rule-editor-auto-badge";
      badge.textContent = localize("autoDownloadRoutingBadge", "Automatic source");
      identity.append(badge);
    }
    const enabledLabel = document.createElement("label");
    enabledLabel.className = "visual-editor-enabled rule-editor-enabled-label";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.className = "rule-editor-enabled";
    enabled.checked = rule.enabled;
    enabled.disabled = !rule.editable;
    enabled.setAttribute("aria-label", localize("visualEditorEnabled", "Enabled"));
    enabled.addEventListener("change", () =>
      commit(setRoutingRuleEnabled(textarea.value, rule.index, enabled.checked)),
    );
    enabledLabel.append(
      enabled,
      document.createTextNode(localize("visualEditorEnabled", "Enabled")),
    );
    const actions = document.createElement("div");
    actions.className = "visual-editor-row-actions rule-editor-card-actions";
    const up = button("↑", "up", localize("routeVisualMoveUp", "Move rule up"));
    up.disabled = !rule.editable || rule.index === 0;
    up.addEventListener("click", () =>
      commit(moveRoutingRule(textarea.value, rule.index, rule.index - 1)),
    );
    const down = button("↓", "down", localize("routeVisualMoveDown", "Move rule down"));
    down.disabled = !rule.editable || rule.index === total - 1;
    down.addEventListener("click", () =>
      commit(moveRoutingRule(textarea.value, rule.index, rule.index + 1)),
    );
    const duplicate = button("⧉", "duplicate", localize("routeVisualDuplicate", "Duplicate rule"));
    duplicate.disabled = !rule.editable;
    duplicate.addEventListener("click", () =>
      commit(duplicateRoutingRule(textarea.value, rule.index)),
    );
    const remove = button("×", "delete", localize("routeVisualDelete", "Delete rule"));
    remove.disabled = !rule.editable;
    remove.addEventListener("click", () => commit(deleteRoutingRule(textarea.value, rule.index)));
    actions.append(up, down, duplicate, remove);
    header.append(identity, enabledLabel, actions);
    card.append(header);

    if (!rule.editable) {
      createUnsupportedCard(rule, card);
      return card;
    }

    const body = document.createElement("div");
    body.className = "rule-editor-card-body";
    const firstOutput = rule.clauses.findIndex((clause) => clause.kind !== "matcher");
    const conditionEnd = firstOutput < 0 ? rule.clauses.length : firstOutput;
    rule.clauses
      .slice(0, conditionEnd)
      .forEach((_clause, index) => body.append(createClauseRow(rule, index)));
    const addCondition = document.createElement("button");
    addCondition.type = "button";
    addCondition.className = "rule-editor-add-condition";
    addCondition.textContent = `+ ${localize("routeVisualAddCondition", "Add condition")}`;
    addCondition.addEventListener("click", () =>
      commit(
        addRoutingClause(textarea.value, rule.index, {
          name: matchers[0] ?? "filename",
          value: ".*",
        }),
      ),
    );
    body.append(addCondition);
    rule.clauses
      .slice(conditionEnd)
      .forEach((_clause, offset) => body.append(createClauseRow(rule, conditionEnd + offset)));
    card.append(body);
    return card;
  };

  const render = (): void => {
    const documentModel = parseVisualRoutingRules(textarea.value);
    cards.replaceChildren();
    if (documentModel.rules.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rule-editor-empty";
      empty.textContent = localize(
        "routeVisualEmpty",
        "No routing rules yet. Add one to get started.",
      );
      cards.append(empty);
      return;
    }
    documentModel.rules.forEach((rule) =>
      cards.append(createRuleCard(rule, documentModel.rules.length)),
    );
  };

  textButton.addEventListener("click", () => setMode(false));
  visualButton.addEventListener("click", () => setMode(true));
  const onModeKeydown = (event: KeyboardEvent): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextVisual =
      event.key === "End"
        ? true
        : event.key === "Home"
          ? false
          : event.currentTarget === textButton;
    setMode(nextVisual);
    (nextVisual ? visualButton : textButton).focus();
  };
  textButton.addEventListener("keydown", onModeKeydown);
  visualButton.addEventListener("keydown", onModeKeydown);
  addRule?.addEventListener("click", () =>
    commit(
      addRoutingRule(textarea.value, { name: "filename", value: ".*", destination: ":filename:" }),
    ),
  );
  addAutomaticRule?.addEventListener("click", () =>
    commit(addAutomaticRoutingRule(textarea.value)),
  );
  manageAutomaticRules?.addEventListener("click", () => {
    setMode(true);
    const target = addAutomaticRule ?? visualButton;
    document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
  });
  textarea.addEventListener("input", () => {
    if (committing || !visual) return;
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(render, 180);
  });
  document.addEventListener("options-restored", render);
  document.addEventListener("route-debugger-source-selected", (event) => {
    if (!(event instanceof CustomEvent) || !visual) return;
    const detail = event.detail ?? {};
    const ruleIndex = Number(Reflect.get(detail, "ruleIndex"));
    const card = cards.querySelector<HTMLElement>(`[data-rule-index="${ruleIndex}"]`);
    if (!card) return;
    cards
      .querySelectorAll(".rule-editor-card.is-debug-selected")
      .forEach((item) => item.classList.remove("is-debug-selected"));
    card.classList.add("is-debug-selected");
    const line = Number(Reflect.get(detail, "line"));
    card
      .querySelectorAll(".rule-clause-row.is-active")
      .forEach((item) => item.classList.remove("is-active"));
    card
      .querySelector<HTMLElement>(`.rule-clause-row[data-line="${line}"]`)
      ?.classList.add("is-active");
    card.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  });

  let initialVisual = true;
  try {
    initialVisual = localStorage.getItem("saveInRulesEditorMode") !== "text";
  } catch {}
  setMode(initialVisual);

  if (!options.matchers) {
    void sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
      .then((response) => {
        if (!("matchers" in response.body) || response.body.matchers.length === 0) return;
        matchers = sortClauses(response.body.matchers);
        if (visual) render();
      })
      .catch(() => {});
  }
};
