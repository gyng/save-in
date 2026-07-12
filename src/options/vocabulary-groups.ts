export const VARIABLE_GROUPS = [
  "Date and time",
  "Page context",
  "Source URL",
  "Resolved file",
  "Generated values",
  "Capture groups",
] as const;

export type VariableGroup = (typeof VARIABLE_GROUPS)[number];

export const variableGroup = (variable: string): VariableGroup => {
  const name = variable.replaceAll(":", "").toLocaleLowerCase();
  if (/^\$\d+$/.test(name)) return "Capture groups";
  if (
    /^(date|isodate|unixdate|year|month|day|hour|minute|second|weekday|monthname|ampm|iso?week)$/.test(
      name,
    )
  )
    return "Date and time";
  if (/^(page|frame|selection|link|title$)/.test(name)) return "Page context";
  if (/^(source|url$|tld|naive|urlfileext)/.test(name)) return "Source URL";
  if (
    /^(filename|fileext|actualfileext|mime|contenttype|mimeext|finalurl|redirecturl|sha256)$/.test(
      name,
    )
  )
    return "Resolved file";
  return "Generated values";
};

export const CLAUSE_GROUPS = [
  "Output",
  "Capture setup",
  "Page and menu context",
  "URL and source matching",
  "Filename and content matching",
] as const;

export type ClauseGroup = (typeof CLAUSE_GROUPS)[number];

export const clauseGroup = (clause: string): ClauseGroup => {
  const name = clause.replace(/:.*/, "").toLocaleLowerCase();
  if (name === "into") return "Output";
  if (name === "capture") return "Capture setup";
  if (/^(context|menuindex|comment|linktext|selectiontext)$/.test(name))
    return "Page and menu context";
  if (/^(page|source|frame)/.test(name)) return "URL and source matching";
  return "Filename and content matching";
};
