import { getFilenameFromUrl } from "../routing/filename.ts";
import {
  parseRoutingRuleAst,
  type RoutingClauseNode,
  type RoutingRuleNode,
} from "../routing/rule-syntax.ts";
import { toRootDomain } from "../shared/domain.ts";
import type { PageSourceKind } from "../shared/page-source.ts";
import type { SourceSpan } from "../shared/syntax-parser.ts";

export const AUTO_DOWNLOAD_PAGE_MATCHERS = ["pageurl", "pagedomain", "pagerootdomain"] as const;
export const AUTO_DOWNLOAD_SOURCE_MATCHERS = [
  "sourceurl",
  "sourcedomain",
  "sourcerootdomain",
  "sourcekind",
  "fileext",
] as const;
export const AUTO_DOWNLOAD_MATCHERS = [
  ...AUTO_DOWNLOAD_PAGE_MATCHERS,
  ...AUTO_DOWNLOAD_SOURCE_MATCHERS,
] as const;

export type AutoDownloadMatcherName = (typeof AUTO_DOWNLOAD_MATCHERS)[number];
export type AutoDownloadMatcher = {
  name: AutoDownloadMatcherName;
  pattern: string;
  flags: string;
  regex: RegExp;
};
export type AutoDownloadRule = {
  name: string;
  enabled: boolean;
  matchers: AutoDownloadMatcher[];
  destination: string;
};
export type EditableAutoDownloadRule = Omit<AutoDownloadRule, "matchers"> & {
  matchers: Array<Omit<AutoDownloadMatcher, "regex">>;
};
export type AutoDownloadCandidate = {
  pageUrl: string;
  sourceUrl: string;
  sourceKind: PageSourceKind;
};

export type AutoDownloadRuleErrorCode =
  | "bad-clause"
  | "duplicate-disabled"
  | "duplicate-into"
  | "duplicate-name"
  | "invalid-disabled"
  | "invalid-regex"
  | "missing-into"
  | "missing-page-matcher"
  | "missing-source-matcher"
  | "unknown-clause"
  | "unsafe-page-matcher"
  | "unsafe-source-matcher";

export type AutoDownloadRuleError = {
  code: AutoDownloadRuleErrorCode;
  message: string;
  error: string;
  location: { start: number; end: number; line: number; column: number };
};

const sourceLocation = (span: SourceSpan): AutoDownloadRuleError["location"] => ({
  start: span.start.offset,
  end: span.end.offset,
  line: span.start.line,
  column: span.start.column,
});

const errorFor = (
  code: AutoDownloadRuleErrorCode,
  message: string,
  error: string,
  span: SourceSpan,
): AutoDownloadRuleError => ({ code, message, error, location: sourceLocation(span) });

const isMatcherName = (name: string): name is AutoDownloadMatcherName =>
  AUTO_DOWNLOAD_MATCHERS.includes(name as AutoDownloadMatcherName);
const isPageMatcher = (name: string): boolean =>
  AUTO_DOWNLOAD_PAGE_MATCHERS.includes(name as (typeof AUTO_DOWNLOAD_PAGE_MATCHERS)[number]);
const isSourceMatcher = (name: string): boolean =>
  AUTO_DOWNLOAD_SOURCE_MATCHERS.includes(name as (typeof AUTO_DOWNLOAD_SOURCE_MATCHERS)[number]);
const isMatchAll = (pattern: string): boolean =>
  [".*", "^.*$", ".+", "^.+$"].includes(pattern.trim());

const duplicateError = (
  clauses: RoutingClauseNode[],
  name: "name" | "disabled" | "into",
  code: AutoDownloadRuleErrorCode,
): AutoDownloadRuleError | null => {
  const matches = clauses.filter((clause) => clause.name === name);
  const duplicate = matches[1];
  return duplicate
    ? errorFor(code, `${name} may appear only once`, duplicate.raw, duplicate.span)
    : null;
};

const parseRule = (
  node: RoutingRuleNode,
): { rule: AutoDownloadRule | null; errors: AutoDownloadRuleError[] } => {
  const errors: AutoDownloadRuleError[] = [];
  const duplicateName = duplicateError(node.clauses, "name", "duplicate-name");
  const duplicateDisabled = duplicateError(node.clauses, "disabled", "duplicate-disabled");
  const duplicateInto = duplicateError(node.clauses, "into", "duplicate-into");
  if (duplicateName) errors.push(duplicateName);
  if (duplicateDisabled) errors.push(duplicateDisabled);

  const matchers: AutoDownloadMatcher[] = [];
  let name = "";
  let enabled = true;
  let destination = "";
  for (const clause of node.clauses) {
    if (clause.name === "name") {
      if (!name) name = clause.value.trim();
      continue;
    }
    if (clause.name === "disabled") {
      const value = clause.value.trim().toLocaleLowerCase();
      if (value !== "true" && value !== "false") {
        errors.push(
          errorFor(
            "invalid-disabled",
            "disabled must be true or false",
            clause.raw,
            clause.valueSpan,
          ),
        );
      } else if (value === "true") enabled = false;
      continue;
    }
    if (clause.name === "into") {
      if (!destination) destination = clause.value.replace(/^\.\//, "");
      continue;
    }
    if (!isMatcherName(clause.name)) {
      errors.push(
        errorFor(
          "unknown-clause",
          "Unknown automatic-download clause",
          `${clause.name}:`,
          clause.nameSpan,
        ),
      );
      continue;
    }
    try {
      matchers.push({
        name: clause.name,
        pattern: clause.value,
        flags: clause.flags,
        regex: new RegExp(clause.value, clause.flags),
      });
    } catch (error) {
      errors.push(
        errorFor(
          "invalid-regex",
          "Invalid regular expression",
          String(error),
          clause.flagsSpan ?? clause.valueSpan,
        ),
      );
    }
  }
  if (duplicateInto) errors.push(duplicateInto);

  const pageClauses = node.clauses.filter((clause) => isPageMatcher(clause.name));
  const sourceClauses = node.clauses.filter((clause) => isSourceMatcher(clause.name));
  if (pageClauses.length === 0) {
    errors.push(
      errorFor(
        "missing-page-matcher",
        "Add a page URL or domain constraint",
        "pageurl:",
        node.span,
      ),
    );
  } else if (pageClauses.every((clause) => isMatchAll(clause.value))) {
    errors.push(
      errorFor(
        "unsafe-page-matcher",
        "The page constraint must be narrower than match-all",
        pageClauses[0]!.raw,
        pageClauses[0]!.valueSpan,
      ),
    );
  }
  if (sourceClauses.length === 0) {
    errors.push(
      errorFor(
        "missing-source-matcher",
        "Add a source URL, domain, kind, or extension constraint",
        "sourceurl:",
        node.span,
      ),
    );
  } else if (sourceClauses.every((clause) => isMatchAll(clause.value))) {
    errors.push(
      errorFor(
        "unsafe-source-matcher",
        "The source constraint must be narrower than match-all",
        sourceClauses[0]!.raw,
        sourceClauses[0]!.valueSpan,
      ),
    );
  }
  if (!destination.trim()) {
    errors.push(errorFor("missing-into", "Add a destination", "into:", node.span));
  }

  return {
    rule: errors.length ? null : { name, enabled, matchers, destination },
    errors,
  };
};

export const parseAutoDownloadRules = (
  source: string,
): { rules: AutoDownloadRule[]; errors: AutoDownloadRuleError[] } => {
  const parsed = parseRoutingRuleAst(source);
  const errors = parsed.issues.map((issue) =>
    errorFor("bad-clause", "Write one clause per line", issue.source, issue.span),
  );
  const rules: AutoDownloadRule[] = [];
  parsed.ast.rules.forEach((node) => {
    const result = parseRule(node);
    errors.push(...result.errors);
    if (result.rule) rules.push(result.rule);
  });
  return { rules, errors };
};

const hostname = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
};

const matcherValue = (
  matcher: AutoDownloadMatcherName,
  candidate: AutoDownloadCandidate,
): string => {
  if (matcher === "pageurl") return candidate.pageUrl;
  if (matcher === "pagedomain") return hostname(candidate.pageUrl);
  if (matcher === "pagerootdomain") return toRootDomain(hostname(candidate.pageUrl)) ?? "";
  if (matcher === "sourceurl") return candidate.sourceUrl;
  if (matcher === "sourcedomain") return hostname(candidate.sourceUrl);
  if (matcher === "sourcerootdomain") return toRootDomain(hostname(candidate.sourceUrl)) ?? "";
  if (matcher === "sourcekind") return candidate.sourceKind;
  return getFilenameFromUrl(candidate.sourceUrl).match(/\.([\p{L}\p{M}\p{N}_+-]+)$/u)?.[1] ?? "";
};

export const matchAutoDownloadRule = (
  rules: readonly AutoDownloadRule[],
  candidate: AutoDownloadCandidate,
): AutoDownloadRule | null =>
  rules.find(
    (rule) =>
      rule.enabled &&
      rule.matchers.every((matcher) => {
        matcher.regex.lastIndex = 0;
        return matcher.regex.test(matcherValue(matcher.name, candidate));
      }),
  ) ?? null;

const escapeControlValue = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

export const serializeAutoDownloadRules = (rules: readonly EditableAutoDownloadRule[]): string =>
  rules
    .map((rule) =>
      [
        ...(rule.name ? [`name: ${escapeControlValue(rule.name)}`] : []),
        ...(!rule.enabled ? ["disabled: true"] : []),
        ...rule.matchers.map(
          (matcher) =>
            `${matcher.name}${matcher.flags ? `/${matcher.flags}` : ""}: ${matcher.pattern}`,
        ),
        `into: ${rule.destination}`,
      ].join("\n"),
    )
    .join("\n\n");

export const migrateLegacyAutoDownloadRules = (
  source: string,
): { routingSource: string; errors: AutoDownloadRuleError[] } => {
  const parsed = parseAutoDownloadRules(source);
  if (parsed.errors.length > 0) return { routingSource: "", errors: parsed.errors };
  const routingSource = parsed.rules
    .map((rule) =>
      [
        ...(rule.name ? [`// ${escapeControlValue(rule.name)}`] : []),
        "context: ^auto$",
        ...rule.matchers.map(
          (matcher) =>
            `${matcher.name}${matcher.flags ? `/${matcher.flags}` : ""}: ${matcher.pattern}`,
        ),
        `into: ${rule.destination}`,
        ...(!rule.enabled ? ["disabled: true"] : []),
      ].join("\n"),
    )
    .join("\n\n");
  return { routingSource, errors: [] };
};
