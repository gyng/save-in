import { clauseGroup, variableGroup } from "./vocabulary-groups.ts";

type CopyText = (text: string) => Promise<void>;

export const groupReferenceRows = (root: ParentNode, kind: "variables" | "clauses") => {
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    let lastGroup = "";
    [...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tr")].forEach(
      (row) => {
        if (row.classList.contains("reference-group-row")) return;
        const syntax = row.querySelector("code")?.textContent?.trim() || "";
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

export const filterReferenceRows = (root: ParentNode, query: string): number => {
  const needle = query.trim().toLocaleLowerCase();
  let visible = 0;
  root
    .querySelectorAll<HTMLTableRowElement>("tbody tr:not(.reference-group-row)")
    .forEach((row) => {
      const matches = !needle || (row.textContent || "").toLocaleLowerCase().includes(needle);
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
  return visible;
};

const defaultCopy: CopyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.hidden = true;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

export const enhanceReferenceTables = (root: Document) => {
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    table.classList.add("reference-table");
    const rows = [
      ...table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr, :scope > tr"),
    ];
    if (rows.length === 0) return;
    let tbody = table.tBodies[0];
    if (!tbody) {
      tbody = root.createElement("tbody");
      rows.forEach((row) => tbody.appendChild(row));
      table.appendChild(tbody);
    }
    const sectionTitle = table.previousElementSibling?.textContent?.trim() || "Reference";
    if (!table.caption) {
      const caption = root.createElement("caption");
      caption.textContent = sectionTitle;
      table.prepend(caption);
    }
    if (!table.tHead) {
      const head = table.createTHead();
      const row = head.insertRow();
      const labels =
        rows[0].cells.length >= 3 ? ["Syntax", "Example", "Meaning"] : ["Syntax", "Meaning"];
      labels.forEach((label) => {
        const th = root.createElement("th");
        th.scope = "col";
        th.textContent = label;
        row.appendChild(th);
      });
    }
    rows.forEach((row) => {
      const first = row.cells[0];
      if (!first || (first instanceof HTMLTableCellElement && first.tagName === "TH")) return;
      const th = root.createElement("th");
      th.scope = "row";
      while (first.firstChild) th.appendChild(first.firstChild);
      first.replaceWith(th);
    });
  });
};

export const setupReferencePage = (root: Document = document, copy: CopyText = defaultCopy) => {
  const variablesPanel = root.querySelector("#reference-variables");
  groupReferenceRows(
    variablesPanel || root,
    variablesPanel
      ? "variables"
      : root.querySelector("#help-clause-list")
        ? "clauses"
        : "variables",
  );
  enhanceReferenceTables(root);
  const search = root.querySelector<HTMLInputElement>(".reference-search");
  const count = root.querySelector<HTMLElement>(".reference-count");
  const status = root.querySelector<HTMLElement>(".reference-copy-status");
  const updateFilter = () => {
    const activePanel = root.querySelector<HTMLElement>(".reference-panel:not([hidden])");
    const visible = filterReferenceRows(activePanel || root, search?.value || "");
    if (count) count.textContent = `${visible} ${visible === 1 ? "result" : "results"}`;
  };

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"][aria-controls]')];
  const selectTab = async (tab: HTMLButtonElement) => {
    const panel = root.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`);
    if (!panel) return;
    if (panel.dataset.source && !panel.dataset.loaded) {
      const response = await fetch(panel.dataset.source);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      panel.innerHTML = source.querySelector("#help-clause-list")?.innerHTML || "";
      panel.dataset.loaded = "true";
      groupReferenceRows(panel, "clauses");
      enhanceReferenceTables(root);
    }
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", String(selected));
      const candidatePanel = root.querySelector<HTMLElement>(
        `#${candidate.getAttribute("aria-controls")}`,
      );
      if (candidatePanel) candidatePanel.hidden = !selected;
    });
    updateFilter();
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => void selectTab(tab)));
  if (location.hash === "#clauses") {
    const clausesTab = tabs.find(
      (tab) => tab.getAttribute("aria-controls") === "reference-clauses",
    );
    if (clausesTab) void selectTab(clausesTab);
  }
  search?.addEventListener("input", updateFilter);
  updateFilter();

  root.querySelectorAll<HTMLElement>(".click-to-copy").forEach((token) => {
    token.tabIndex = 0;
    token.setAttribute("role", "button");
    token.setAttribute("aria-label", `Copy ${token.textContent?.trim() || "value"}`);
  });

  const activate = async (target: EventTarget | null) => {
    const token = target instanceof Element ? target.closest<HTMLElement>(".click-to-copy") : null;
    if (!token) return;
    const value = token.textContent?.trim() || "";
    await copy(value);
    token.classList.add("copied");
    window.setTimeout(() => token.classList.remove("copied"), 1000);
    if (status) status.textContent = `Copied ${value}`;
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

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => setupReferencePage(), { once: true });
}
