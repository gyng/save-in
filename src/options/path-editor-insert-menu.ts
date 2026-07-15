import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { compareClauses, CLAUSE_GROUPS, clauseGroup } from "./vocabulary-groups.ts";
import { matcherTestValue } from "./matcher-descriptions.ts";
import { referenceDescription } from "./reference-descriptions.ts";
import { closeDetailsAndRestoreFocus } from "./dismissible-details.ts";

export const setupPathInsertMenu = (
  menuSelector: string,
  insertLine: (textarea: HTMLTextAreaElement, line: string) => void,
): void => {
  const menu = document.querySelector<HTMLDetailsElement>(menuSelector);
  if (!menu) return;
  const target = menu.dataset.insertTarget;
  const textarea = target ? document.querySelector<HTMLTextAreaElement>(`#${target}`) : null;
  const clauseFilter = menu.querySelector<HTMLInputElement>(".clause-preview-filter");
  if (!textarea) return;

  const closeMenu = () => {
    menu.open = false;
  };
  const lineButtons = [...menu.querySelectorAll<HTMLElement>("[data-insert-line]")];
  lineButtons
    .toSorted((a, b) =>
      compareClauses(a.dataset.insertLine as string, b.dataset.insertLine as string),
    )
    .forEach((button) => button.parentElement?.append(button));
  lineButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const line = button.dataset.insertLine;
      /* v8 ignore next -- lineButtons contains only elements selected by data-insert-line. */
      if (line === undefined) return;
      insertLine(textarea, line);
      closeMenu();
    });
  });

  if (!clauseFilter) return;
  const clauseBody = menu.querySelector<HTMLTableSectionElement>(".clause-preview-table tbody");
  const clauseButtons: HTMLButtonElement[] = [];

  const renderClauses = (matchers: string[]) => {
    if (!clauseBody) return;
    clauseBody.replaceChildren();
    clauseButtons.length = 0;
    const clauses = ["into", "capture", "capturegroups", ...matchers].toSorted((a, b) =>
      compareClauses(`${a}:`, `${b}:`),
    );
    CLAUSE_GROUPS.forEach((group) => {
      const grouped = clauses.filter((clause) => clauseGroup(`${clause}:`) === group);
      if (!grouped.length) return;
      const headingRow = document.createElement("tr");
      headingRow.className = "variables-preview-group";
      const heading = document.createElement("th");
      heading.colSpan = 2;
      heading.scope = "colgroup";
      heading.textContent = group;
      headingRow.append(heading);
      clauseBody.append(headingRow);

      grouped.forEach((clause) => {
        const row = document.createElement("tr");
        row.className = "variables-preview-row variables-preview-reference-row insertable";
        const syntaxCell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "variables-preview-insert";
        button.dataset.insertLine = `${clause}: `;
        button.setAttribute("aria-label", `Insert ${clause}: clause`);
        const syntax = document.createElement("code");
        syntax.textContent = `${clause}:`;
        button.append(syntax);
        syntaxCell.append(button);
        const currentValue = document.createElement("td");
        currentValue.className = "variables-preview-value";
        const testValue = matcherTestValue(clause);
        currentValue.textContent = testValue;
        currentValue.title = testValue;
        const description = document.createElement("td");
        description.className = "variables-preview-value clause-preview-description";
        description.colSpan = 2;
        description.textContent = referenceDescription("clauses", `${clause}:`);
        row.append(syntaxCell, currentValue, description);
        clauseBody.append(row);
        button.addEventListener("click", () => {
          const line = button.dataset.insertLine;
          /* v8 ignore next -- This button receives data-insert-line immediately above. */
          if (line === undefined) return;
          insertLine(textarea, line);
          closeMenu();
        });
        clauseButtons.push(button);
      });
    });
  };

  const applyClauseFilter = () => {
    const query = clauseFilter.value.trim().toLocaleLowerCase();
    const buttons = clauseButtons.length ? clauseButtons : lineButtons;
    buttons.forEach((button) => {
      const row = button.closest<HTMLTableRowElement>("tr");
      if (row) {
        row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase().includes(query);
      } else {
        button.hidden = Boolean(query) && !button.textContent.toLocaleLowerCase().includes(query);
      }
    });
    clauseBody
      ?.querySelectorAll<HTMLTableRowElement>(".variables-preview-group")
      .forEach((heading) => {
        let row = heading.nextElementSibling;
        let visible = false;
        while (row && !row.classList.contains("variables-preview-group")) {
          if (row instanceof HTMLTableRowElement && !row.hidden) visible = true;
          row = row.nextElementSibling;
        }
        heading.hidden = !visible;
      });
  };
  clauseFilter.addEventListener("input", applyClauseFilter);
  clauseFilter.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDetailsAndRestoreFocus(menu);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    (clauseButtons.length ? clauseButtons : lineButtons)
      .find((button) => {
        const row = button.closest("tr");
        return row ? !row.hasAttribute("hidden") : !button.hidden;
      })
      ?.click();
  });
  sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
    .then((response) => {
      const matchers = "matchers" in response.body ? response.body.matchers : [];
      renderClauses(
        Array.isArray(matchers)
          ? matchers.filter((matcher: unknown): matcher is string => typeof matcher === "string")
          : [],
      );
      applyClauseFilter();
    })
    .catch(() => renderClauses([]));
};
