import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { compareClauses, CLAUSE_GROUPS, clauseGroup } from "./vocabulary-groups.ts";

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
    .toSorted((a, b) => compareClauses(a.dataset.insertLine || "", b.dataset.insertLine || ""))
    .forEach((button) => button.parentElement?.append(button));
  lineButtons.forEach((button) => {
    button.addEventListener("click", () => {
      insertLine(textarea, button.dataset.insertLine ?? "");
      closeMenu();
    });
  });

  if (!clauseFilter) return;
  const clauseBody = menu.querySelector<HTMLTableSectionElement>(".clause-preview-table tbody");
  const descriptions: Record<string, string> = {
    into: "Set the destination path",
    capture: "Choose regex capture source",
    capturegroups: "Choose continuous regex capture groups",
    context: "Match how the save started",
    menuindex: "Match the selected menu position",
    comment: "Match menu-item metadata",
    linktext: "Match visible link text",
    selectiontext: "Match selected page text",
    pageurl: "Match the page URL",
    pagedomain: "Match the page hostname",
    pagerootdomain: "Match the page root domain",
    pagetitle: "Match the page title",
    frameurl: "Match the frame URL",
    referrerurl: "Match the referrer URL",
    referrerdomain: "Match the referrer hostname",
    sourceurl: "Match the file URL",
    sourcedomain: "Match the file hostname",
    sourcerootdomain: "Match the file root domain",
    filename: "Match the resolved filename",
    naivefilename: "Match the URL-derived filename",
    fileext: "Match the URL-derived extension",
    urlfileext: "Match the URL-derived extension",
    actualfileext: "Match the resolved extension",
    mediatype: "Match image, video, or audio",
    mime: "Match the MIME content type",
    contenttype: "Match the MIME content type",
  };
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
        row.className = "variables-preview-row insertable";
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
        const description = document.createElement("td");
        description.className = "variables-preview-value clause-preview-description";
        description.textContent = descriptions[clause] || "Match this download property";
        row.append(syntaxCell, description);
        clauseBody.append(row);
        button.addEventListener("click", () => {
          insertLine(textarea, button.dataset.insertLine ?? "");
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
        row.hidden = Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query);
      } else {
        button.hidden = Boolean(query) && !button.textContent?.toLocaleLowerCase().includes(query);
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
      menu.removeAttribute("open");
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
