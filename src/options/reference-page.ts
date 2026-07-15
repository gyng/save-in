import {
  clauseGroup,
  compareClauses,
  compareVariables,
  variableGroup,
} from "./vocabulary-groups.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { getMessage } from "../platform/localization.ts";
import { copyText, type CopyText } from "./clipboard.ts";

type ReferenceKind = "variables" | "clauses";
type RuntimeVocabulary = { variables: string[]; matchers: string[] };
type GetMessage = (key: string, substitutions?: string | number | (string | number)[]) => string;

const referenceSyntax = (row: HTMLTableRowElement) =>
  row.querySelector("code")?.textContent?.trim() || "";

export const syncReferenceVocabulary = (
  root: ParentNode,
  kind: ReferenceKind,
  runtimeTerms: string[],
  localize: GetMessage = getMessage,
) => {
  const rows = [
    ...root.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.reference-group-row), table > tr"),
  ];
  const target = rows[0]?.parentElement;
  if (!target) return;
  const bySyntax = new Map(rows.map((row) => [referenceSyntax(row), row]));
  const required = new Set(runtimeTerms);
  if (kind === "variables") required.add(":$1:");
  else {
    required.add("into:");
    required.add("capture:");
    required.add("fetch:");
  }

  rows.forEach((row) => {
    if (!required.has(referenceSyntax(row))) row.remove();
  });

  for (const syntax of required) {
    if (bySyntax.has(syntax)) continue;
    const row = target.ownerDocument.createElement("tr");
    const syntaxCell = target.ownerDocument.createElement("td");
    const code = target.ownerDocument.createElement("code");
    code.className = "click-to-copy";
    code.textContent = syntax;
    syntaxCell.append(code);
    const example = target.ownerDocument.createElement("td");
    if (kind === "variables") example.textContent = "value";
    const meaning = target.ownerDocument.createElement("td");
    meaning.textContent =
      kind === "variables"
        ? localize("referenceRuntimeVariable") || "Runtime variable"
        : localize("referenceRuntimeRuleMatcher") || "Runtime rule matcher";
    row.append(syntaxCell, example, meaning);
    target.append(row);
  }
};

const loadRuntimeVocabulary = async (): Promise<RuntimeVocabulary | null> => {
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.GET_KEYWORDS,
    });
    if (!("variables" in response.body) || !("matchers" in response.body)) return null;
    const body = response.body;
    if (!Array.isArray(body.variables) || !Array.isArray(body.matchers)) return null;
    return { variables: body.variables, matchers: body.matchers };
  } catch {
    // The authored rows remain a complete offline fallback if the background is unavailable.
    return null;
  }
};

export const groupReferenceRows = (root: ParentNode, kind: ReferenceKind) => {
  root.querySelectorAll(".reference-group-row").forEach((row) => row.remove());
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const rows = [
      ...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tr"),
    ];
    rows
      .toSorted((a, b) => {
        const aSyntax = referenceSyntax(a);
        const bSyntax = referenceSyntax(b);
        return kind === "variables"
          ? compareVariables(aSyntax, bSyntax)
          : compareClauses(aSyntax, bSyntax);
      })
      .forEach((row) => row.parentElement?.append(row));
    let lastGroup = "";
    [...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tr")].forEach(
      (row) => {
        const syntax = referenceSyntax(row);
        const group = kind === "variables" ? variableGroup(syntax) : clauseGroup(syntax);
        if (group === lastGroup) return;
        lastGroup = group;
        const headingRow = table.ownerDocument.createElement("tr");
        headingRow.className = "reference-group-row";
        const heading = table.ownerDocument.createElement("th");
        heading.colSpan = Math.max(2, row.cells.length);
        heading.scope = "colgroup";
        heading.textContent = group;
        headingRow.append(heading);
        row.before(headingRow);
      },
    );
  });
};

const wrapReferenceSection = (table: HTMLTableElement): HTMLElement | null => {
  const existing = table.closest<HTMLElement>(".reference-section");
  if (existing) return existing;

  let heading = table.previousElementSibling;
  while (heading && heading.tagName !== "H3") {
    if (heading.matches("table, .reference-table-scroll")) return null;
    heading = heading.previousElementSibling;
  }
  if (!(heading instanceof HTMLHeadingElement)) return null;

  const section = table.ownerDocument.createElement("section");
  section.className = "reference-section";
  heading.before(section);
  let node: Node | null = heading;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    section.append(node);
    if (node === table) break;
    node = next;
  }
  return section;
};

export const ensureReferenceEmptyState = (
  root: ParentNode,
  localize: GetMessage = getMessage,
): HTMLElement | null => {
  const existing = root.querySelector<HTMLElement>(".reference-empty-state");
  if (existing) return existing;
  const container =
    root instanceof Document ? root.body : root instanceof HTMLElement ? root : null;
  if (!container) return null;
  const empty = container.ownerDocument.createElement("p");
  empty.className = "reference-empty-state";
  empty.hidden = true;
  empty.setAttribute("role", "status");
  empty.textContent = localize("o_lRoutingNoMatches") || "No matches";
  container.append(empty);
  return empty;
};

export const filterReferenceRows = (root: ParentNode, query: string): number => {
  const needle = query.trim().toLocaleLowerCase();
  let visible = 0;
  root
    .querySelectorAll<HTMLTableRowElement>("tbody tr:not(.reference-group-row)")
    .forEach((row) => {
      const matches = !needle || row.textContent.toLocaleLowerCase().includes(needle);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
  root.querySelectorAll<HTMLTableRowElement>(".reference-group-row").forEach((heading) => {
    let row = heading.nextElementSibling;
    let hasVisibleRow = false;
    while (row && !row.classList.contains("reference-group-row")) {
      if (row instanceof HTMLTableRowElement && !row.hidden) hasVisibleRow = true;
      row = row.nextElementSibling;
    }
    heading.hidden = !hasVisibleRow;
  });
  root.querySelectorAll<HTMLTableElement>("table.reference-table").forEach((table) => {
    table.hidden = !table.querySelector("tbody tr:not(.reference-group-row):not([hidden])");
    const section = table.closest<HTMLElement>(".reference-section");
    if (section) section.hidden = table.hidden;
  });
  root.querySelectorAll<HTMLElement>(".reference-empty-state").forEach((empty) => {
    empty.hidden = visible !== 0;
  });
  return visible;
};

export const enhanceReferenceTables = (root: ParentNode, localize: GetMessage = getMessage) => {
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const section = wrapReferenceSection(table);
    table.classList.add("reference-table");
    const rows = [
      ...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tr"),
    ];
    if (rows.length === 0) return;
    const existingBody = table.tBodies[0];
    if (!existingBody) {
      const tbody = table.ownerDocument.createElement("tbody");
      rows.forEach((row) => tbody.appendChild(row));
      table.appendChild(tbody);
    }
    const dataRows = rows.filter((row) => !row.classList.contains("reference-group-row"));
    if (table.closest("#help-clause-list, #reference-clauses")) {
      dataRows.forEach((row) => {
        row.cells[1]
          ?.querySelectorAll("code")
          .forEach((code) => code.replaceWith(code.textContent ?? ""));
      });
    }
    const sectionTitle =
      section?.querySelector("h3")?.textContent?.trim() ||
      table.previousElementSibling?.textContent?.trim() ||
      localize("referenceCaption") ||
      "Reference";
    if (!table.caption) {
      const caption = table.ownerDocument.createElement("caption");
      caption.textContent = sectionTitle;
      table.prepend(caption);
    }
    let headerRow = table.tHead?.rows[0];
    if (!headerRow) {
      const head = table.tHead ?? table.createTHead();
      const createdHeaderRow = head.insertRow();
      headerRow = createdHeaderRow;
      const columnCount = Math.max(...dataRows.map((dataRow) => dataRow.cells.length));
      const syntax = localize("referenceColumnSyntax") || "Syntax";
      const meaning = localize("referenceColumnMeaning") || "Meaning";
      const labels =
        columnCount >= 3
          ? [syntax, localize("referenceColumnExample") || "Example", meaning]
          : [syntax, meaning];
      labels.forEach((label) => {
        const th = table.ownerDocument.createElement("th");
        th.scope = "col";
        th.textContent = label;
        createdHeaderRow.appendChild(th);
      });
    }
    rows.forEach((row) => {
      const first = row.cells[0];
      if (!first || (first instanceof HTMLTableCellElement && first.tagName === "TH")) return;
      const th = table.ownerDocument.createElement("th");
      th.scope = "row";
      while (first.firstChild) th.appendChild(first.firstChild);
      first.replaceWith(th);
    });
    const labels = [...headerRow.cells].map((cell) => cell.textContent.trim());
    dataRows.forEach((row) => {
      [...row.cells].forEach((cell, index) => {
        if (!cell.querySelector(":scope > .reference-cell-content")) {
          const content = table.ownerDocument.createElement("span");
          content.className = "reference-cell-content";
          while (cell.firstChild) content.append(cell.firstChild);
          cell.append(content);
        }
        cell.dataset.referenceLabel = labels[index] || "";
      });
    });
    if (!table.parentElement?.classList.contains("reference-table-scroll")) {
      const scroller = table.ownerDocument.createElement("div");
      scroller.className = "reference-table-scroll";
      table.before(scroller);
      scroller.append(table);
    }
  });
};

export const setupReferencePage = (
  root: Document = document,
  copy: CopyText = copyText,
  localize: GetMessage = getMessage,
) => {
  const referenceRoot = root.querySelector("#help-clause-list") || root;
  const kind: ReferenceKind = root.querySelector("#help-clause-list") ? "clauses" : "variables";
  groupReferenceRows(referenceRoot, kind);
  enhanceReferenceTables(referenceRoot, localize);
  ensureReferenceEmptyState(referenceRoot, localize);
  const search = root.querySelector<HTMLInputElement>(".reference-search");
  const count = root.querySelector<HTMLElement>(".reference-count");
  const status = root.querySelector<HTMLElement>(".reference-copy-status");
  const updateFilter = () => {
    const visible = filterReferenceRows(referenceRoot, search?.value || "");
    if (count) {
      count.textContent =
        (visible === 1
          ? localize("referenceResult", visible)
          : localize("referenceResults", visible)) ||
        `${visible} ${visible === 1 ? "result" : "results"}`;
    }
  };

  void loadRuntimeVocabulary().then((vocabulary) => {
    if (!vocabulary) return;
    const terms =
      kind === "variables" ? vocabulary.variables : vocabulary.matchers.map((x) => `${x}:`);
    syncReferenceVocabulary(referenceRoot, kind, terms);
    groupReferenceRows(referenceRoot, kind);
    enhanceReferenceTables(root, localize);
    updateFilter();
  });
  search?.addEventListener("input", updateFilter);
  updateFilter();

  root.querySelectorAll<HTMLElement>(".click-to-copy").forEach((token) => {
    token.tabIndex = 0;
    token.setAttribute("role", "button");
    const value = token.textContent?.trim() || "value";
    token.setAttribute("aria-label", localize("referenceCopyValue", value) || `Copy ${value}`);
  });

  const activate = async (target: EventTarget | null) => {
    const token = target instanceof Element ? target.closest<HTMLElement>(".click-to-copy") : null;
    if (!token) return;
    const value = token.textContent?.trim() || "";
    await copy(value);
    token.classList.add("copied");
    window.setTimeout(() => token.classList.remove("copied"), 1000);
    if (status) {
      status.textContent = localize("referenceCopiedValue", value) || `Copied ${value}`;
    }
  };
  root.addEventListener("click", (event) => void activate(event.target));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target instanceof Element ? event.target.closest(".click-to-copy") : null;
    if (!target) return;
    event.preventDefault();
    void activate(target);
  });

  root.querySelectorAll<HTMLAnchorElement>("a.external").forEach((link) => {
    link.target = "_blank";
    link.relList.add("noreferrer");
  });
};
