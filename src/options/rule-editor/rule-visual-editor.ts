import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { preferredScrollBehavior } from "../../shared/motion-preference.ts";
import { attachAutocomplete } from "../syntax-editor/autocomplete.ts";
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
  setRoutingRuleName,
  updateRoutingClause,
  type VisualRoutingRule,
} from "./rule-visual-editor-model.ts";
import { clauseGroup, sortClauses, sortVariables } from "../core/vocabulary-groups.ts";
import { isAutomaticRuleClauses } from "../../routing/automatic-rule.ts";
import {
  RULE_REACHABILITY_OPTION_IDS,
  ruleReachabilityDiagnostics,
  type ReachabilityOptions,
  type RuleReachabilityDiagnostic,
} from "../core/rule-reachability-model.ts";
import {
  readReachabilityControls,
  subscribeReachabilityControls,
} from "../core/reachability-controls.ts";
import { completeDirectorySyntax } from "../syntax-editor/syntax-editor-model.ts";
import { bindTabInteractions, syncTabSelection } from "../core/tab-controls.ts";
import { attachTypeahead } from "../ui/typeahead.ts";
import { matcherDescription, matcherTestValue } from "../core/matcher-descriptions.ts";
import {
  clearValidationFields,
  EDITOR_VALIDATION_EVENT,
  markValidationField,
  validationFeedbackFromEvent,
  validationFeedbackLabel,
  type EditorValidationFeedback,
} from "../syntax-editor/editor-validation.ts";

const DEFAULT_MATCHERS = [
  "context",
  "menuindex",
  "comment",
  "directory",
  "linktext",
  "selectiontext",
  "referrerurl",
  "referrerdomain",
  "pageurl",
  "pagedomain",
  "pagerootdomain",
  "pagetitle",
  "frameurl",
  "css",
  "sourceurl",
  "sourcedomain",
  "sourcerootdomain",
  "sourcekind",
  "gesture",
  "filename",
  "finalfilename",
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
  variables?: string[];
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
  const browseTemplates = document.querySelector<HTMLButtonElement>(
    "#rule-editor-browse-templates",
  );
  const manageAutomaticRules = document.querySelector<HTMLButtonElement>(
    "#auto-download-manage-rules",
  );
  const manageBrowserDownloadRules = document.querySelector<HTMLButtonElement>(
    "#browser-download-manage-rules",
  );
  if (!textarea || !textButton || !visualButton || !textEditor || !visualEditor || !cards) return;

  const localize = (key: string, fallback: string, substitutions?: MessageSubstitutions): string =>
    (options.localize ? options.localize(key) : getMessage(key, substitutions)) || fallback;
  const contextualLabel = (
    template: string,
    ruleNumber: number,
    conditionNumber?: number,
  ): string =>
    template
      .replace("$RULE$", String(ruleNumber))
      .replace("$CONDITION$", String(conditionNumber ?? ""));
  let matchers = sortClauses([...(options.matchers ?? DEFAULT_MATCHERS)]);
  let variables = sortVariables([...(options.variables ?? [])]);
  let editorControlCleanups: Array<() => void> = [];
  let committing = false;
  let rebuildTimer = 0;
  let visual = false;
  let draggedRuleIndex: number | null = null;
  let validationErrors: readonly EditorValidationFeedback[] = [];
  const openMenuSelector = ".rule-add-menu[open], .rule-editor-card-actions[open]";
  let matcherSuggestions = [...matchers];

  const reachabilityOptions = (): ReachabilityOptions => readReachabilityControls();
  const optionLabel = (id: string): string => localize(id, id);
  const reachabilityText = (diagnostic: RuleReachabilityDiagnostic): string => {
    switch (diagnostic.kind) {
      case "automatic-saves-off": {
        const master = optionLabel("autoDownloadEnabled");
        return localize(
          "ruleReachabilityAutomaticOff",
          `Automatic saving is off, so this rule is idle until “${master}” is on.`,
          [master],
        );
      }
      case "no-kinds":
        return localize(
          "ruleReachabilityNoKinds",
          "The source kind conditions match none of the page source kinds, so this rule can never save.",
        );
      case "link-only":
        return localize(
          "ruleReachabilityLinkOnly",
          "This rule only matches plain links, which automatic saving never adopts.",
        );
      case "empty-variable":
        return localize(
          "ruleReachabilityEmptyVariable",
          `The ${diagnostic.variable} variable is always empty in automatic saves.`,
          [diagnostic.variable],
        );
      case "unreachable-kinds": {
        const [firstOption, secondOption] = diagnostic.unlockOptions;
        const first = optionLabel(firstOption);
        if (secondOption !== undefined) {
          const second = optionLabel(secondOption);
          return localize(
            "ruleReachabilityChannelOffEither",
            `Current settings never discover sources this rule matches. Turn on “${first}” or “${second}” to supply them.`,
            [first, second],
          );
        }
        return localize(
          "ruleReachabilityChannelOff",
          `Current settings never discover sources this rule matches. Turn on “${first}” to supply them.`,
          [first],
        );
      }
    }
  };
  const createReachabilityNotes = (
    rule: VisualRoutingRule,
    reachability: ReachabilityOptions,
  ): HTMLElement | null => {
    // A disabled rule cannot save no matter what the discovery options say;
    // the card is already dimmed, and actionable unlock advice would be
    // false until the rule is re-enabled.
    if (!rule.enabled) return null;
    const diagnostics = ruleReachabilityDiagnostics(rule.clauses, reachability);
    if (diagnostics.length === 0) return null;
    const notes = document.createElement("div");
    notes.className = "rule-editor-reachability";
    diagnostics.forEach((diagnostic) => {
      const note = document.createElement("p");
      note.className = "rule-editor-reachability-note";
      note.dataset.level = diagnostic.level;
      note.dataset.reachability = diagnostic.kind;
      note.textContent = reachabilityText(diagnostic);
      notes.append(note);
    });
    return notes;
  };

  const clearDragAppearance = (): void => {
    cards
      .querySelectorAll(".is-dragging, .is-drop-before, .is-drop-after")
      .forEach((card) => card.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Node;
      document.querySelectorAll<HTMLDetailsElement>(openMenuSelector).forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
    },
    { capture: true },
  );
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openMenus = [...document.querySelectorAll<HTMLDetailsElement>(openMenuSelector)];
    const activeMenu = openMenus.find((menu) => menu.contains(document.activeElement));
    openMenus.forEach((menu) => (menu.open = false));
    activeMenu?.querySelector<HTMLElement>("summary")?.focus();
  });

  const clearValidationAppearance = (): void => {
    cards
      .querySelectorAll<HTMLElement>(
        ".has-validation-error, .has-validation-warning, [data-validation-message]",
      )
      .forEach((element) => {
        element.classList.remove("has-validation-error", "has-validation-warning");
        if (element.dataset.validationMessage !== undefined) {
          element.removeAttribute("title");
          delete element.dataset.validationMessage;
        }
      });
    clearValidationFields(cards);
  };

  const applyValidationAppearance = (): void => {
    clearValidationAppearance();
    const ruleCards = [...cards.querySelectorAll<HTMLElement>(".rule-editor-card")];
    validationErrors.forEach((error) => {
      const line = error.location?.line;
      if (!line) return;
      const row = cards.querySelector<HTMLElement>(`.rule-clause-row[data-line="${line}"]`);
      const card =
        row?.closest<HTMLElement>(".rule-editor-card") ??
        ruleCards.findLast((candidate) => Number(candidate.dataset.line) <= line);
      const target = row ?? card;
      if (!target) return;
      target.classList.add(error.warning ? "has-validation-warning" : "has-validation-error");
      const label = validationFeedbackLabel(error);
      const messages = target.dataset.validationMessage
        ? `${target.dataset.validationMessage}\n${label}`
        : label;
      target.dataset.validationMessage = messages;
      target.title = messages;
      if (!error.warning) {
        markValidationField(
          row?.querySelector<HTMLElement>(".rule-clause-value, .rule-clause-name") ?? null,
          "error-filenamePatterns",
        );
      }
    });
  };

  const setMode = (nextVisual: boolean): void => {
    visual = nextVisual;
    syncTabSelection([textButton, visualButton], [textEditor, visualEditor], visual ? 1 : 0);
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
    const selectedLine = lines[line - 1];
    textarea.focus();
    // A stale line number still switches to the text editor for manual
    // repair; only the selection is skipped.
    if (selectedLine === undefined) return;
    const offset = lines
      .slice(0, Math.max(0, line - 1))
      .reduce((sum, value) => sum + value.length + 1, 0);
    textarea.setSelectionRange(
      offset,
      Math.min(textarea.value.length, offset + selectedLine.length),
    );
  };

  const createMatcherInput = (
    rule: VisualRoutingRule,
    clause: VisualRoutingRule["clauses"][number],
    conditionNumber: number,
  ): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rule-clause-name visual-editor-control-field";
    input.name = "routing-matcher";
    input.value = clause.name;
    input.readOnly = true;
    input.setAttribute("autocomplete", "off");
    input.spellcheck = false;
    input.setAttribute(
      "aria-label",
      contextualLabel(
        localize("routeVisualMatcherAccessible", "Rule $RULE$, condition $CONDITION$: matcher", [
          rule.index + 1,
          conditionNumber,
        ]),
        rule.index + 1,
        conditionNumber,
      ),
    );
    const updateMatcher = (matcher: string): void => {
      const normalized = matcher.trim();
      input.value = normalized;
      if (normalized === clause.name) return;
      commit(
        updateRoutingClause(textarea.value, rule.index, clause.index, { name: normalized }),
        false,
      );
    };
    input.addEventListener("change", () => updateMatcher(input.value));
    editorControlCleanups.push(
      attachTypeahead(input, {
        items: () =>
          matcherSuggestions.map((matcher) => ({
            value: matcher,
            label: matcher,
            group: clauseGroup(matcher),
            description: matcherDescription(matcher),
            meta: matcherTestValue(matcher),
          })),
        onSelect: (item) => updateMatcher(item.value),
        preferredWidth: 360,
        variant: "reference",
      }),
    );
    return input;
  };

  const createClauseRow = (
    rule: VisualRoutingRule,
    clause: VisualRoutingRule["clauses"][number],
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = `visual-editor-row rule-clause-row rule-clause-${clause.kind}`;
    row.dataset.line = String(clause.line);

    const marker = document.createElement("span");
    marker.className = "rule-clause-marker";
    marker.textContent =
      clause.kind === "destination"
        ? "→"
        : clause.kind === "capture"
          ? "$"
          : clause.kind === "fetch"
            ? "⇄"
            : clause.kind === "rename"
              ? "✎"
              : "if";
    marker.setAttribute("aria-hidden", "true");
    row.append(marker);

    const conditionNumber =
      clause.kind === "matcher"
        ? rule.clauses.slice(0, clause.index + 1).filter((item) => item.kind === "matcher").length
        : undefined;

    if (clause.kind === "matcher" && conditionNumber !== undefined && clause.name !== "css") {
      row.append(createMatcherInput(rule, clause, conditionNumber));
    } else {
      const name = document.createElement("span");
      name.className = "rule-clause-fixed-name";
      name.textContent =
        clause.kind === "fetch"
          ? localize("routeVisualFetchLabel", "Rewrite download URL")
          : clause.kind === "rename"
            ? localize("routeVisualRenameLabel", "Rename the file")
            : clause.name;
      row.append(name);
    }

    const value = document.createElement("input");
    value.type = "text";
    value.className = "rule-clause-value";
    value.name = `routing-${clause.kind === "matcher" ? "pattern" : clause.kind}`;
    value.value = clause.value;
    value.spellcheck = false;
    value.placeholder =
      clause.kind === "destination"
        ? "folder/:filename:"
        : clause.kind === "fetch"
          ? "https://example.com/:$1:"
          : clause.kind === "rename"
            ? "find -> replacement"
            : clause.name === "css"
              ? "article img, .gallery video"
              : ".*";
    value.setAttribute(
      "aria-label",
      clause.kind === "destination"
        ? contextualLabel(
            localize("routeVisualDestinationAccessible", "Rule $RULE$ destination", rule.index + 1),
            rule.index + 1,
          )
        : clause.kind === "matcher" && conditionNumber !== undefined
          ? contextualLabel(
              localize(
                "routeVisualPatternAccessible",
                "Rule $RULE$, condition $CONDITION$: pattern",
                [rule.index + 1, conditionNumber],
              ),
              rule.index + 1,
              conditionNumber,
            )
          : clause.kind === "fetch"
            ? contextualLabel(
                localize(
                  "routeVisualFetchAccessible",
                  "Rule $RULE$: rewrite download URL",
                  rule.index + 1,
                ),
                rule.index + 1,
              )
            : clause.kind === "rename"
              ? contextualLabel(
                  localize(
                    "routeVisualRenameAccessible",
                    "Rule $RULE$: rename the file",
                    rule.index + 1,
                  ),
                  rule.index + 1,
                )
              : clause.name,
    );
    value.addEventListener("input", () => {
      commit(
        updateRoutingClause(textarea.value, rule.index, clause.index, { value: value.value }),
        false,
      );
    });
    row.append(value);
    if (clause.kind === "destination" && variables.length > 0) {
      editorControlCleanups.push(
        attachAutocomplete(value, (source, caret) =>
          completeDirectorySyntax(source, caret, variables),
        ),
      );
    }

    if (clause.kind === "matcher" && clause.name !== "css" && conditionNumber !== undefined) {
      const insensitive = document.createElement("label");
      insensitive.className = "rule-clause-flag";
      insensitive.title = localize(
        "routeVisualIgnoreCaseHelp",
        "Match uppercase and lowercase letters",
      );
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "routing-ignore-case";
      checkbox.checked = clause.flags === "i";
      checkbox.setAttribute(
        "aria-label",
        contextualLabel(
          localize(
            "routeVisualIgnoreCaseAccessible",
            "Rule $RULE$, condition $CONDITION$: ignore case",
            [rule.index + 1, conditionNumber],
          ),
          rule.index + 1,
          conditionNumber,
        ),
      );
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
        conditionNumber === undefined
          ? localize("routeVisualDeleteCondition", "Delete condition")
          : contextualLabel(
              localize(
                "routeVisualDeleteConditionAccessible",
                "Delete condition $CONDITION$ from rule $RULE$",
                [rule.index + 1, conditionNumber],
              ),
              rule.index + 1,
              conditionNumber,
            ),
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
    const issueLine = rule.issues[0]?.line ?? rule.line;
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

  const createRuleCard = (
    rule: VisualRoutingRule,
    total: number,
    reachability: ReachabilityOptions,
  ): HTMLElement => {
    const card = document.createElement("section");
    card.className = "visual-editor-card rule-editor-card";
    card.dataset.ruleIndex = String(rule.index);
    card.dataset.line = String(rule.line);
    card.classList.toggle("is-disabled", !rule.enabled);

    const header = document.createElement("header");
    header.className = "visual-editor-card-header rule-editor-card-header";
    const dragHandle = document.createElement("span");
    dragHandle.className = "rule-editor-drag-handle";
    dragHandle.textContent = "⠿";
    dragHandle.draggable = rule.editable;
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.addEventListener("dragstart", (event) => {
      draggedRuleIndex = rule.index;
      card.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(rule.index));
      }
    });
    dragHandle.addEventListener("dragend", () => {
      draggedRuleIndex = null;
      clearDragAppearance();
    });
    const identity = document.createElement("div");
    identity.className = "rule-editor-identity";
    const title = document.createElement("h5");
    title.id = `rule-editor-title-${rule.index}`;
    card.setAttribute("aria-labelledby", title.id);
    title.textContent = localize(
      "routeDebuggerRule",
      `Rule ${rule.index + 1}`,
      rule.index + 1,
    ).replace("$NUMBER$", String(rule.index + 1));
    const nameLabel = document.createElement("span");
    nameLabel.id = `rule-editor-name-label-${rule.index}`;
    nameLabel.className = "visually-hidden";
    nameLabel.textContent = localize("autoDownloadRuleName", "Rule name");
    const name = document.createElement("input");
    name.type = "text";
    name.className = "rule-editor-name";
    name.name = "routing-rule-name";
    name.value = rule.comment;
    name.placeholder = nameLabel.textContent;
    name.disabled = !rule.editable;
    name.setAttribute("aria-labelledby", `${title.id} ${nameLabel.id}`);
    name.addEventListener("change", () => {
      if (name.value === rule.comment) return;
      commit(setRoutingRuleName(textarea.value, rule.index, name.value));
    });
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        name.blur();
      } else if (event.key === "Escape") {
        name.value = rule.comment;
        name.blur();
      }
    });
    identity.append(title, nameLabel, name);
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
    enabled.name = "routing-rule-enabled";
    enabled.checked = rule.enabled;
    enabled.disabled = !rule.editable;
    enabled.setAttribute(
      "aria-label",
      contextualLabel(
        localize("routeVisualRuleEnabledAccessible", "Rule $RULE$ enabled", rule.index + 1),
        rule.index + 1,
      ),
    );
    enabled.addEventListener("change", () =>
      commit(setRoutingRuleEnabled(textarea.value, rule.index, enabled.checked)),
    );
    enabledLabel.append(enabled);
    const actions = document.createElement("details");
    actions.className = "visual-editor-row-actions rule-editor-card-actions details-popup";
    const actionsTrigger = document.createElement("summary");
    actionsTrigger.className =
      "visual-editor-control visual-editor-more-trigger rule-editor-actions-trigger";
    actionsTrigger.textContent = "⋯";
    const actionsLabel = contextualLabel(
      localize("routeVisualRuleActionsAccessible", "More actions for rule $RULE$", rule.index + 1),
      rule.index + 1,
    );
    actionsTrigger.setAttribute("aria-label", actionsLabel);
    actionsTrigger.title = actionsLabel;
    const actionsMenu = document.createElement("div");
    actionsMenu.className = "rule-editor-card-action-menu menu-popover";
    const closeActions = () => (actions.open = false);
    const up = button(
      localize("routeVisualMoveUp", "Move rule up"),
      "up",
      localize("routeVisualMoveUp", "Move rule up"),
    );
    up.disabled = !rule.editable || rule.index === 0;
    up.addEventListener("click", () => {
      commit(moveRoutingRule(textarea.value, rule.index, rule.index - 1));
      closeActions();
    });
    const down = button(
      localize("routeVisualMoveDown", "Move rule down"),
      "down",
      localize("routeVisualMoveDown", "Move rule down"),
    );
    down.disabled = !rule.editable || rule.index === total - 1;
    down.addEventListener("click", () => {
      commit(moveRoutingRule(textarea.value, rule.index, rule.index + 1));
      closeActions();
    });
    const duplicate = button(
      localize("routeVisualDuplicate", "Duplicate rule"),
      "duplicate",
      localize("routeVisualDuplicate", "Duplicate rule"),
    );
    duplicate.disabled = !rule.editable;
    duplicate.addEventListener("click", () => {
      commit(duplicateRoutingRule(textarea.value, rule.index));
      closeActions();
    });
    const remove = button(
      localize("routeVisualDelete", "Delete rule"),
      "delete",
      localize("routeVisualDelete", "Delete rule"),
    );
    remove.classList.add("danger-button");
    remove.disabled = !rule.editable;
    remove.addEventListener("click", () => {
      commit(deleteRoutingRule(textarea.value, rule.index));
      closeActions();
    });
    actionsMenu.append(up, down, duplicate, remove);
    actions.append(actionsTrigger, actionsMenu);
    header.append(dragHandle, enabledLabel, identity, actions);
    card.append(header);

    card.addEventListener("dragover", (event) => {
      if (draggedRuleIndex === null || draggedRuleIndex === rule.index) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const bounds = card.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      card.classList.toggle("is-drop-before", !after);
      card.classList.toggle("is-drop-after", after);
    });
    card.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && card.contains(related)) return;
      card.classList.remove("is-drop-before", "is-drop-after");
    });
    card.addEventListener("drop", (event) => {
      if (draggedRuleIndex === null || draggedRuleIndex === rule.index) return;
      event.preventDefault();
      const source = draggedRuleIndex;
      const bounds = card.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      let destination = rule.index + (after ? 1 : 0);
      if (source < destination) destination -= 1;
      destination = Math.max(0, Math.min(total - 1, destination));
      draggedRuleIndex = null;
      clearDragAppearance();
      if (source !== destination) commit(moveRoutingRule(textarea.value, source, destination));
    });

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
      .forEach((clause) => body.append(createClauseRow(rule, clause)));
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
      .forEach((clause) => body.append(createClauseRow(rule, clause)));
    card.append(body);
    const reachabilityNotes = createReachabilityNotes(rule, reachability);
    if (reachabilityNotes) card.append(reachabilityNotes);
    return card;
  };

  const render = (): void => {
    const documentModel = parseVisualRoutingRules(textarea.value);
    editorControlCleanups.forEach((cleanup) => cleanup());
    editorControlCleanups = [];
    matcherSuggestions = [
      ...new Set([
        ...matchers,
        ...documentModel.rules.flatMap((rule) =>
          rule.clauses.filter((clause) => clause.kind === "matcher").map((clause) => clause.name),
        ),
      ]),
    ];
    matcherSuggestions = sortClauses(matcherSuggestions);
    cards.replaceChildren();
    if (documentModel.rules.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rule-editor-empty";
      empty.textContent = localize(
        "routeVisualEmpty",
        "No routing rules yet. Add one to get started.",
      );
      cards.append(empty);
      textarea.dispatchEvent(new Event("visual-editor-rendered"));
      return;
    }
    // One live-checkbox read serves the whole render pass; every card sees
    // the same option snapshot.
    const reachability = reachabilityOptions();
    documentModel.rules.forEach((rule) =>
      cards.append(createRuleCard(rule, documentModel.rules.length, reachability)),
    );
    applyValidationAppearance();
    textarea.dispatchEvent(new Event("visual-editor-rendered"));
  };

  bindTabInteractions([textButton, visualButton], (index, focus) => {
    setMode(index === 1);
    if (focus) [textButton, visualButton][index]?.focus();
  });
  addRule?.addEventListener("click", () => {
    const nextIndex = parseVisualRoutingRules(textarea.value).rules.length;
    commit(
      addRoutingRule(textarea.value, { name: "filename", value: ".*", destination: ":filename:" }),
    );
    cards.querySelector<HTMLElement>(`[data-rule-index="${nextIndex}"] .rule-clause-name`)?.focus();
  });
  const addRuleMenu = addAutomaticRule?.closest<HTMLDetailsElement>(".rule-add-menu");
  addAutomaticRule?.addEventListener("click", () => {
    const nextIndex = parseVisualRoutingRules(textarea.value).rules.length;
    commit(addAutomaticRoutingRule(textarea.value));
    if (addRuleMenu) addRuleMenu.open = false;
    cards.querySelector<HTMLElement>(`[data-rule-index="${nextIndex}"] .rule-clause-name`)?.focus();
  });
  browseTemplates?.addEventListener("click", () => {
    if (addRuleMenu) addRuleMenu.open = false;
  });
  manageAutomaticRules?.addEventListener("click", () => {
    setMode(true);
    if (addRuleMenu) addRuleMenu.open = true;
    const target = addAutomaticRule ?? visualButton;
    document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
  });
  manageBrowserDownloadRules?.addEventListener("click", () => {
    const target = visual ? visualButton : textarea;
    document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
  });
  textarea.addEventListener("input", () => {
    validationErrors = [];
    clearValidationAppearance();
    if (committing || !visual) return;
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(render, 180);
  });
  textarea.addEventListener(EDITOR_VALIDATION_EVENT, (event) => {
    validationErrors = validationFeedbackFromEvent(event);
    applyValidationAppearance();
  });
  document.addEventListener("options-restored", render);
  // Reachability hints follow the discovery checkboxes live, so toggling a
  // channel updates the open Visual editor without a reload. The
  // options-restored listener above already re-renders after programmatic
  // restores, so the subscription skips its own restore hook.
  subscribeReachabilityControls(
    RULE_REACHABILITY_OPTION_IDS,
    () => {
      if (visual) render();
    },
    false,
  );
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
    const activeClause = card.querySelector<HTMLElement>(`.rule-clause-row[data-line="${line}"]`);
    activeClause?.classList.add("is-active");
    const focusScope = activeClause ?? card.querySelector<HTMLElement>(".rule-editor-card-body");
    focusScope
      ?.querySelector<HTMLElement>(
        "select:not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      )
      ?.focus({ preventScroll: true });
    card.scrollIntoView?.({ block: "nearest", behavior: preferredScrollBehavior() });
  });

  let initialVisual = true;
  try {
    initialVisual = localStorage.getItem("saveInRulesEditorMode") !== "text";
  } catch {}
  setMode(initialVisual);

  if (!options.matchers || !options.variables) {
    void sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
      .then((response) => {
        let changed = false;
        if (!options.matchers && "matchers" in response.body && response.body.matchers.length > 0) {
          matchers = sortClauses(response.body.matchers);
          changed = true;
        }
        if (
          !options.variables &&
          "variables" in response.body &&
          response.body.variables.length > 0
        ) {
          variables = sortVariables(response.body.variables);
          changed = true;
        }
        if (changed && visual) render();
      })
      .catch(() => {});
  }
};
