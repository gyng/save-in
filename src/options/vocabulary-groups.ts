export const VARIABLE_GROUPS = [
  "Date and time",
  "Page context",
  "Source URL",
  "Resolved file",
  "Generated values",
  "Capture groups",
] as const;

export type VariableGroup = (typeof VARIABLE_GROUPS)[number];

const VARIABLE_ORDER = [
  "date",
  "isodate",
  "unixdate",
  "year",
  "month",
  "monthname",
  "day",
  "weekday",
  "hour",
  "minute",
  "second",
  "ampm",
  "isoweek",
  "pageurl",
  "pagedomain",
  "pagerootdomain",
  "pagetitle",
  "pagetitleslug",
  "pagetitlesnake",
  "frameurl",
  "linktext",
  "selectiontext",
  "sourceurl",
  "sourcedomain",
  "sourcerootdomain",
  "sourcepath",
  "tld",
  "url",
  "naivefilename",
  "naivefileext",
  "urlfileext",
  "filename",
  "fileext",
  "actualfileext",
  "mime",
  "contenttype",
  "mimeext",
  "finalurl",
  "redirecturl",
  "sha256",
  "counter",
  "uuid",
] as const;

const variableName = (variable: string) => variable.replaceAll(":", "").toLocaleLowerCase();

export const variableGroup = (variable: string): VariableGroup => {
  const name = variableName(variable);
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

const CLAUSE_ORDER = [
  "into",
  "capture",
  "context",
  "menuindex",
  "comment",
  "linktext",
  "selectiontext",
  "pageurl",
  "pagedomain",
  "pagetitle",
  "frameurl",
  "sourceurl",
  "sourcedomain",
  "filename",
  "naivefilename",
  "fileext",
  "urlfileext",
  "actualfileext",
  "mediatype",
] as const;

const clauseName = (clause: string) => clause.replace(/[:/].*/, "").toLocaleLowerCase();

export const clauseGroup = (clause: string): ClauseGroup => {
  const name = clauseName(clause);
  if (name === "into") return "Output";
  if (name === "capture") return "Capture setup";
  if (/^(context|menuindex|comment|linktext|selectiontext)$/.test(name))
    return "Page and menu context";
  if (/^(page|source|frame)/.test(name)) return "URL and source matching";
  return "Filename and content matching";
};

const rank = (name: string, order: readonly string[]): number => {
  const index = order.indexOf(name);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
};

export const compareVariables = (a: string, b: string): number => {
  const group =
    VARIABLE_GROUPS.indexOf(variableGroup(a)) - VARIABLE_GROUPS.indexOf(variableGroup(b));
  if (group) return group;
  const aName = variableName(a);
  const bName = variableName(b);
  const ordered = rank(aName, VARIABLE_ORDER) - rank(bName, VARIABLE_ORDER);
  if (ordered) return ordered;
  if (/^\$\d+$/.test(aName) && /^\$\d+$/.test(bName))
    return Number(aName.slice(1)) - Number(bName.slice(1));
  return aName.localeCompare(bName);
};

export const compareClauses = (a: string, b: string): number => {
  const group = CLAUSE_GROUPS.indexOf(clauseGroup(a)) - CLAUSE_GROUPS.indexOf(clauseGroup(b));
  if (group) return group;
  const aName = clauseName(a);
  const bName = clauseName(b);
  return rank(aName, CLAUSE_ORDER) - rank(bName, CLAUSE_ORDER) || aName.localeCompare(bName);
};

export const sortVariables = (variables: string[]): string[] =>
  variables.toSorted(compareVariables);
export const sortClauses = (clauses: string[]): string[] => clauses.toSorted(compareClauses);
