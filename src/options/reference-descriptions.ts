import { getMessage } from "../platform/localization.ts";

type ReferenceKind = "variables" | "clauses";

const panelSelector = (kind: ReferenceKind): string => `#options-reference-${kind}`;

const normalizedSyntax = (value: string): string => value.trim().toLocaleLowerCase();

export const referenceDescription = (
  kind: ReferenceKind,
  syntax: string,
  root: ParentNode = document,
): string => {
  const expected = normalizedSyntax(syntax);
  const rows = root.querySelectorAll<HTMLTableRowElement>(`${panelSelector(kind)} tr`);
  for (const row of rows) {
    const syntaxCell = row.cells[0];
    if (!syntaxCell) continue;
    const hasSyntax = [...syntaxCell.querySelectorAll("code")].some(
      (code) => normalizedSyntax(code.textContent ?? "") === expected,
    );
    if (!hasSyntax) continue;
    const description = row.cells.item(row.cells.length - 1)?.textContent;
    if (description) return description.replace(/\s+/g, " ").trim();
  }
  const fallbackKey =
    kind === "variables" ? "referenceRuntimeVariable" : "referenceRuntimeRuleMatcher";
  return (
    getMessage(fallbackKey) || (kind === "variables" ? "Runtime variable" : "Runtime rule matcher")
  );
};
