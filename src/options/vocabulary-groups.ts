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
  "sha256full",
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
    /^(filename|fileext|actualfileext|mime|contenttype|mimeext|finalurl|redirecturl|sha256|sha256full)$/.test(
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
  "capturegroups",
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
  if (name === "capture" || name === "capturegroups") return "Capture setup";
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

export const variableExample = (variable: string): string => {
  const name = variableName(variable);
  if (name === "date") return "2026-07-12";
  if (name === "year") return "2026";
  if (name === "month" || name === "day") return "07";
  if (/^(hour|minute|second)$/.test(name)) return "09";
  if (name === "counter") return "42";
  if (/fileext|mimeext/.test(name)) return "jpg";
  if (/filename/.test(name)) return "photo.jpg";
  if (/domain|tld/.test(name)) return name === "tld" ? "com" : "example.com";
  if (/url/.test(name)) return "https://example.com/file.jpg";
  if (name === "pagetitle") return "Example page";
  if (name === "pagetitleslug") return "example-page";
  if (name === "pagetitlesnake") return "example_page";
  if (/mime|contenttype/.test(name)) return "image/jpeg";
  if (name === "sha256") return "ba7816bf8f01";
  if (name === "sha256full") return "ba7816bf…";
  if (/^\$\d+$/.test(name)) return "captured-text";
  if (name === "uuid") return "f47ac10b-…";
  return "example";
};

export const isLazyVariable = (variable: string): boolean =>
  /^(mime|contenttype|mimeext|finalurl|redirecturl|sha256|sha256full)$/.test(
    variableName(variable),
  );
