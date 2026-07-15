import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { PathEditor } from "./path-editor.ts";
import {
  sortVariables,
  VARIABLE_GROUPS,
  isLazyVariable,
  variableExample,
  variableGroup,
} from "./vocabulary-groups.ts";
import { referenceDescription } from "./reference-descriptions.ts";
import { getMessage } from "../platform/localization.ts";
import { closeDetailsAndRestoreFocus, setupOutsideDismiss } from "./dismissible-details.ts";

const stringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

type PathInsertTarget = HTMLInputElement | HTMLTextAreaElement;
let activePathInsertTarget: PathInsertTarget | null = null;
let pathInsertTrackingReady = false;

const visualPathsActive = (): boolean => {
  const panel = document.querySelector<HTMLElement>("#paths-visual");
  return panel !== null && !panel.hidden;
};

const currentPathInsertTarget = (textarea: HTMLTextAreaElement): PathInsertTarget | null => {
  if (!visualPathsActive()) return textarea;
  return activePathInsertTarget instanceof HTMLInputElement &&
    activePathInsertTarget.matches(".path-editor-dir") &&
    activePathInsertTarget.isConnected
    ? activePathInsertTarget
    : null;
};

const updatePathInsertAvailability = (): void => {
  const visual = visualPathsActive();
  const visualTargetReady =
    activePathInsertTarget instanceof HTMLInputElement &&
    activePathInsertTarget.matches(".path-editor-dir") &&
    activePathInsertTarget.isConnected;
  document
    .querySelectorAll<HTMLButtonElement>(
      '.variables-preview[data-insert-target="paths"] .variables-preview-insert',
    )
    .forEach((button) => {
      button.disabled = visual && button.dataset.pathCommand !== "true" && !visualTargetReady;
    });
};

const setupPathInsertTracking = (): void => {
  if (pathInsertTrackingReady) return;
  pathInsertTrackingReady = true;
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement && target.id === "paths") {
      activePathInsertTarget = target;
    } else if (target instanceof HTMLInputElement && target.matches(".path-editor-dir")) {
      activePathInsertTarget = target;
    }
    updatePathInsertAvailability();
  });
  document.addEventListener("visual-editor-rendered", () => {
    if (activePathInsertTarget && !activePathInsertTarget.isConnected) {
      activePathInsertTarget = null;
    }
    updatePathInsertAvailability();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches("#paths-mode-text, #paths-mode-visual")) {
      return;
    }
    window.setTimeout(updatePathInsertAvailability, 0);
  });
};

export const renderVariablesPreview = async () => {
  const panels = document.querySelectorAll<HTMLElement>(".variables-preview");
  if (panels.length === 0) return;
  setupPathInsertTracking();

  try {
    const [keywords, routes] = await Promise.all([
      sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS }),
      sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES }).catch(
        () => null,
      ),
    ]);
    const keywordBody = "variables" in keywords.body ? keywords.body : undefined;
    const variables: string[] = sortVariables(
      Array.isArray(keywordBody?.variables)
        ? keywordBody.variables.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [],
    );
    const values = stringRecord(
      routes && "interpolatedVariables" in routes.body
        ? routes.body.interpolatedVariables
        : undefined,
    );

    panels.forEach((panel) => {
      const container = panel.querySelector(".variables-preview-list");
      if (!container) return;
      container.textContent = "";

      const target = panel.dataset.insertTarget
        ? document.querySelector<HTMLTextAreaElement>(`#${panel.dataset.insertTarget}`)
        : null;
      const filter = document.createElement("input");
      filter.type = "search";
      filter.className = "variables-preview-filter";
      filter.name = "variable-filter";
      const filterLabel = getMessage("html_filterVariables") || "Filter variables";
      filter.placeholder = filterLabel;
      filter.setAttribute("aria-label", filterLabel);
      filter.spellcheck = false;
      container.appendChild(filter);

      const table = document.createElement("table");
      table.className = "variables-preview-table";

      if (target?.id === "paths") {
        const commands = [
          {
            syntax: "---",
            label: getMessage("o_bAddSeparator") || "Separator",
          },
          {
            syntax: ">submenu",
            label: getMessage("html_createASubmenu") || "Create a submenu",
          },
        ];
        commands.forEach(({ syntax, label }) => {
          const description = referenceDescription("variables", syntax);
          const row = document.createElement("tr");
          row.className = "variables-preview-row variables-preview-command insertable";
          const cell = document.createElement("td");
          cell.colSpan = 2;
          const insert = document.createElement("button");
          insert.type = "button";
          insert.className = "variables-preview-insert variables-preview-command-insert";
          insert.dataset.pathCommand = "true";
          insert.setAttribute("aria-label", `${label}: ${description}`);
          insert.title = description;
          insert.addEventListener("click", () => {
            if (visualPathsActive()) {
              target.setSelectionRange(target.value.length, target.value.length);
            }
            PathEditor.insertLine(target, syntax);
          });
          const syntaxElement = document.createElement("code");
          syntaxElement.textContent = syntax;
          const labelElement = document.createElement("span");
          labelElement.className = "variables-preview-command-label";
          labelElement.textContent = label;
          const descriptionElement = document.createElement("span");
          descriptionElement.className = "variables-preview-description";
          descriptionElement.textContent = description;
          insert.append(syntaxElement, labelElement, descriptionElement);
          cell.appendChild(insert);
          row.append(cell);
          table.append(row);
        });
      }

      VARIABLE_GROUPS.forEach((group) => {
        const groupedVariables = variables.filter((variable) => variableGroup(variable) === group);
        if (groupedVariables.length === 0) return;
        const headingRow = document.createElement("tr");
        headingRow.className = "variables-preview-group";
        const heading = document.createElement("th");
        heading.colSpan = 2;
        heading.scope = "colgroup";
        heading.textContent = group;
        headingRow.append(heading);
        table.append(headingRow);

        groupedVariables.forEach((variable) => {
          const row = document.createElement("tr");
          row.className = "variables-preview-row variables-preview-reference-row";
          const nameCell = document.createElement("td");
          const name = document.createElement("code");
          name.textContent = variable;
          if (target) {
            row.classList.add("insertable");
            const insert = document.createElement("button");
            insert.type = "button";
            insert.className = "variables-preview-insert";
            const insertLabel =
              getMessage("referenceInsertValue", variable) || `Insert ${variable}`;
            insert.setAttribute("aria-label", insertLabel);
            insert.title = insertLabel;
            insert.addEventListener("click", () => {
              const insertTarget = currentPathInsertTarget(target);
              if (insertTarget) PathEditor.insertAtCursor(insertTarget, variable);
            });
            insert.appendChild(name);
            nameCell.appendChild(insert);
          } else {
            nameCell.appendChild(name);
          }
          row.appendChild(nameCell);
          const valueCell = document.createElement("td");
          valueCell.className = "variables-preview-value";
          const liveValue = values[variable] || "";
          const placeholder = isLazyVariable(variable) ? "(lazy)" : variableExample(variable);
          valueCell.textContent = liveValue || placeholder;
          valueCell.classList.toggle("is-placeholder", !liveValue);
          valueCell.title =
            liveValue ||
            (isLazyVariable(variable)
              ? "Calculated only when this variable is used in a download"
              : "Example — no live value yet");
          row.appendChild(valueCell);
          const descriptionCell = document.createElement("td");
          descriptionCell.className = "variables-preview-description";
          descriptionCell.colSpan = 2;
          descriptionCell.textContent = referenceDescription("variables", variable);
          row.appendChild(descriptionCell);
          table.appendChild(row);
        });
      });
      const scroll = document.createElement("div");
      scroll.className = "variables-preview-scroll";
      scroll.appendChild(table);
      container.appendChild(scroll);

      const rows = [...table.querySelectorAll<HTMLElement>(".variables-preview-row")];
      const applyFilter = () => {
        const query = filter.value.trim().toLocaleLowerCase();
        rows.forEach((row) => {
          row.hidden = Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query);
        });
      };
      filter.addEventListener("input", applyFilter);
      filter.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          if (panel instanceof HTMLDetailsElement) closeDetailsAndRestoreFocus(panel);
          else panel.removeAttribute("open");
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        rows
          .find(
            (row) =>
              !row.hidden &&
              row.querySelector<HTMLButtonElement>(".variables-preview-insert:not(:disabled)"),
          )
          ?.querySelector<HTMLButtonElement>(".variables-preview-insert:not(:disabled)")
          ?.click();
      });
      updatePathInsertAvailability();
    });
  } catch {
    // The background may be restarting; the next download refreshes the panel.
  }
};

export const setupVariablesPreview = () => {
  setupPathInsertTracking();
  document
    .querySelectorAll<HTMLDetailsElement>("details.variables-preview")
    .forEach((panel) => setupOutsideDismiss(panel));
  void renderVariablesPreview();
};
