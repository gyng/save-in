import {
  parseRoutingRuleAst,
  type RoutingClauseNode,
  type RoutingLineNode,
  type RoutingTriviaNode,
  type RuleSyntaxIssue,
} from "../routing/rule-syntax.ts";

export type VisualRoutingClause = {
  index: number;
  kind: RoutingClauseNode["clauseKind"];
  name: string;
  flags: string;
  value: string;
  line: number;
};

export type VisualRoutingRule = {
  index: number;
  line: number;
  comment: string;
  enabled: boolean;
  clauses: VisualRoutingClause[];
  editable: boolean;
  issues: RuleSyntaxIssue[];
  source: string;
};

export type VisualRoutingDocument = {
  source: string;
  rules: VisualRoutingRule[];
  issues: RuleSyntaxIssue[];
};

export type NewRoutingClause = {
  name: string;
  value: string;
  caseInsensitive?: boolean;
};

export type NewRoutingRule = NewRoutingClause & {
  destination: string;
};

export type RoutingClauseUpdate = {
  name?: string;
  value?: string;
  caseInsensitive?: boolean;
};

type RuleUnit = {
  start: number;
  end: number;
  content: string;
};

const newlineFor = (source: string): "\r\n" | "\n" => (source.includes("\r\n") ? "\r\n" : "\n");

const lineNodesWithin = (lines: RoutingLineNode[], start: number, end: number): RoutingLineNode[] =>
  lines.filter((line) => line.span.start.offset >= start && line.span.end.offset <= end);

const attachedCommentNodes = (
  lines: RoutingLineNode[],
  firstLineStart: number,
): Array<RoutingTriviaNode & { kind: "comment" }> => {
  const firstIndex = lines.findIndex((line) => line.cst.line.span.start.offset === firstLineStart);
  if (firstIndex < 1) return [];
  const comments: Array<RoutingTriviaNode & { kind: "comment" }> = [];
  for (let index = firstIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || line.kind !== "comment") break;
    comments.unshift({ ...line, kind: "comment" });
  }
  return comments;
};

const parseWithUnits = (source: string) => {
  const parsed = parseRoutingRuleAst(source);
  const units = parsed.ast.rules.flatMap((rule) => {
    const ruleLines = lineNodesWithin(
      parsed.ast.lines,
      rule.span.start.offset,
      rule.span.end.offset,
    );
    const firstLine = ruleLines[0];
    const lastLine = ruleLines.at(-1);
    if (!firstLine || !lastLine) return [];
    const attached = attachedCommentNodes(parsed.ast.lines, firstLine.cst.line.span.start.offset);
    const start = attached[0]?.cst.line.span.start.offset ?? firstLine.cst.line.span.start.offset;
    const end = lastLine.cst.line.span.end.offset;
    return [
      {
        start,
        end,
        content: source.slice(start, end),
        attached,
        rule,
      },
    ];
  });
  return { parsed, units };
};

const issueInRule = (issue: RuleSyntaxIssue, unit: RuleUnit): boolean =>
  issue.span.start.offset >= unit.start && issue.span.end.offset <= unit.end;

const sourceLine = (source: string, offset: number): number =>
  source.slice(0, offset).split("\n").length;

const disabledControls = (clauses: RoutingClauseNode[]): RoutingClauseNode[] =>
  clauses.filter((clause) => clause.name === "disabled");

const supportsDisabledControl = (clauses: RoutingClauseNode[]): boolean => {
  const controls = disabledControls(clauses);
  return (
    controls.length <= 1 &&
    controls.every(
      (control) =>
        control.flags === "" && ["true", "false"].includes(control.value.trim().toLowerCase()),
    )
  );
};

export const parseVisualRoutingRules = (source: string): VisualRoutingDocument => {
  const { parsed, units } = parseWithUnits(source);
  return {
    source,
    issues: parsed.issues,
    rules: units.map((unit, index) => {
      const issues = parsed.issues.filter((issue) => issueInRule(issue, unit));
      const unsupportedFlags = unit.rule.clauses.some(
        (clause) => clause.flags !== "" && clause.flags !== "i",
      );
      const controls = disabledControls(unit.rule.clauses);
      return {
        index,
        line: sourceLine(source, unit.rule.span.start.offset),
        comment: unit.attached
          .map((line) => line.cst.content?.raw.trim() ?? "")
          .filter(Boolean)
          .join(" · "),
        enabled: controls.every((control) => control.value.trim().toLowerCase() !== "true"),
        clauses: unit.rule.clauses
          .map((clause, clauseIndex) => ({ clause, clauseIndex }))
          .filter(({ clause }) => clause.name !== "disabled")
          .map(({ clause, clauseIndex }) => ({
            index: clauseIndex,
            kind: clause.clauseKind,
            name: clause.name,
            flags: clause.flags,
            value: clause.value.trimEnd(),
            line: clause.span.start.line,
          })),
        editable:
          issues.length === 0 && !unsupportedFlags && supportsDisabledControl(unit.rule.clauses),
        issues,
        source: unit.content,
      };
    }),
  };
};

const editableRule = (source: string, ruleIndex: number) => {
  const result = parseWithUnits(source);
  const unit = result.units[ruleIndex];
  if (!unit) throw new RangeError(`Routing rule ${ruleIndex + 1} does not exist.`);
  const issues = result.parsed.issues.filter((issue) => issueInRule(issue, unit));
  const unsupportedFlags = unit.rule.clauses.some(
    (clause) => clause.flags !== "" && clause.flags !== "i",
  );
  if (issues.length > 0 || unsupportedFlags || !supportsDisabledControl(unit.rule.clauses)) {
    throw new Error("Edit this rule in Text mode before using visual controls.");
  }
  return { ...result, unit };
};

export const setRoutingRuleEnabled = (
  source: string,
  ruleIndex: number,
  enabled: boolean,
): string => {
  const { unit } = editableRule(source, ruleIndex);
  const controls = disabledControls(unit.rule.clauses);
  if (enabled) {
    const newline = newlineFor(source);
    return replacePatches(
      source,
      controls.map((control) => {
        let start = control.cst.line.span.start.offset;
        const end = control.cst.terminator.span.end.offset;
        if (
          end === control.cst.line.span.end.offset &&
          source.slice(start - newline.length, start) === newline
        ) {
          start -= newline.length;
        }
        return { start, end, value: "" };
      }),
    );
  }
  if (controls[0]) {
    return updateRoutingClause(source, ruleIndex, unit.rule.clauses.indexOf(controls[0]), {
      value: "true",
    });
  }
  const newline = newlineFor(source);
  /* v8 ignore next -- Every editable rule has at least one parsed clause. */
  const offset = unit.rule.clauses.at(-1)?.span.end.offset ?? unit.end;
  return `${source.slice(0, offset)}${newline}disabled: true${source.slice(offset)}`;
};

export const setRoutingRuleName = (source: string, ruleIndex: number, name: string): string => {
  const { unit } = editableRule(source, ruleIndex);
  const normalizedName = name.replace(/[\r\n]+/g, " ").trim();
  const newline = newlineFor(source);
  const firstComment = unit.attached[0];
  const lastComment = unit.attached.at(-1);

  if (firstComment && lastComment) {
    const start = firstComment.cst.line.span.start.offset;
    const end = lastComment.cst.terminator.span.end.offset;
    const replacement = normalizedName ? `// ${normalizedName}${newline}` : "";
    return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  }

  if (!normalizedName) return source;
  const offset = unit.rule.span.start.offset;
  return `${source.slice(0, offset)}// ${normalizedName}${newline}${source.slice(offset)}`;
};

const replacePatches = (
  source: string,
  patches: Array<{ start: number; end: number; value: string }>,
): string =>
  patches
    .toSorted((left, right) => right.start - left.start)
    .reduce(
      (current, patch) =>
        `${current.slice(0, patch.start)}${patch.value}${current.slice(patch.end)}`,
      source,
    );

export const updateRoutingClause = (
  source: string,
  ruleIndex: number,
  clauseIndex: number,
  update: RoutingClauseUpdate,
): string => {
  const { unit } = editableRule(source, ruleIndex);
  const clause = unit.rule.clauses[clauseIndex];
  if (!clause) throw new RangeError(`Routing clause ${clauseIndex + 1} does not exist.`);
  const patches: Array<{ start: number; end: number; value: string }> = [];
  if (update.name !== undefined || update.caseInsensitive !== undefined) {
    const name =
      update.name ?? source.slice(clause.nameSpan.start.offset, clause.nameSpan.end.offset);
    const caseInsensitive = update.caseInsensitive ?? clause.flags === "i";
    patches.push({
      start: clause.cst.rawName.span.start.offset,
      end: clause.cst.rawName.span.end.offset,
      value: `${name}${caseInsensitive ? "/i" : ""}`,
    });
  }
  if (update.value !== undefined) {
    const trailingWhitespace = clause.value.match(/\s+$/)?.[0].length ?? 0;
    patches.push({
      start: clause.valueSpan.start.offset,
      end: clause.valueSpan.end.offset - trailingWhitespace,
      value: update.value,
    });
  }
  return replacePatches(source, patches);
};

export const addRoutingClause = (
  source: string,
  ruleIndex: number,
  clause: NewRoutingClause,
): string => {
  const { unit } = editableRule(source, ruleIndex);
  const before = unit.rule.clauses.find(
    (candidate) => candidate.clauseKind === "capture" || candidate.clauseKind === "destination",
  );
  const line = `${clause.name}${clause.caseInsensitive ? "/i" : ""}: ${clause.value}`;
  const newline = newlineFor(source);
  if (before) {
    const offset = before.cst.line.span.start.offset;
    return `${source.slice(0, offset)}${line}${newline}${source.slice(offset)}`;
  }
  return `${source.slice(0, unit.end)}${newline}${line}${source.slice(unit.end)}`;
};

export const deleteRoutingClause = (
  source: string,
  ruleIndex: number,
  clauseIndex: number,
): string => {
  const { unit } = editableRule(source, ruleIndex);
  const clause = unit.rule.clauses[clauseIndex];
  if (!clause) throw new RangeError(`Routing clause ${clauseIndex + 1} does not exist.`);
  let start = clause.cst.line.span.start.offset;
  let end = clause.cst.terminator.span.end.offset;
  if (end === clause.cst.line.span.end.offset && start > unit.start) {
    const newline = newlineFor(source);
    start -= newline.length;
  }
  return `${source.slice(0, start)}${source.slice(end)}`;
};

const canonicalRule = (rule: NewRoutingRule, newline: string): string =>
  `${rule.name}${rule.caseInsensitive ? "/i" : ""}: ${rule.value}${newline}into: ${rule.destination}`;

export const addRoutingRule = (source: string, rule: NewRoutingRule): string => {
  const newline = newlineFor(source);
  const separator =
    source.length === 0
      ? ""
      : source.endsWith(`${newline}${newline}`)
        ? ""
        : source.endsWith(newline)
          ? newline
          : `${newline}${newline}`;
  return `${source}${separator}${canonicalRule(rule, newline)}${newline}`;
};

export const addAutomaticRoutingRule = (source: string): string => {
  const newline = newlineFor(source);
  const separator =
    source.length === 0
      ? ""
      : source.endsWith(`${newline}${newline}`)
        ? ""
        : source.endsWith(newline)
          ? newline
          : `${newline}${newline}`;
  return `${source}${separator}${[
    "context: ^auto$",
    "pageurl: ^https://example\\.com/",
    "sourcekind: ^image$",
    "into: automatic/:pagedomain:/",
  ].join(newline)}${newline}`;
};

export const duplicateRoutingRule = (source: string, ruleIndex: number): string => {
  const { unit } = editableRule(source, ruleIndex);
  const newline = newlineFor(source);
  return `${source.slice(0, unit.end)}${newline}${newline}${unit.content}${source.slice(unit.end)}`;
};

export const deleteRoutingRule = (source: string, ruleIndex: number): string => {
  const { units, unit } = editableRule(source, ruleIndex);
  if (units.length === 1) return `${source.slice(0, unit.start)}${source.slice(unit.end)}`;
  const next = units[ruleIndex + 1];
  if (next) return `${source.slice(0, unit.start)}${source.slice(next.start)}`;
  const previous = units[ruleIndex - 1];
  if (!previous) throw new RangeError(`Routing rule ${ruleIndex + 1} does not exist.`);
  return `${source.slice(0, previous.end)}${source.slice(unit.end)}`;
};

export const moveRoutingRule = (source: string, from: number, to: number): string => {
  const { units } = editableRule(source, from);
  if (to < 0 || to >= units.length) throw new RangeError(`Routing rule ${to + 1} does not exist.`);
  if (from === to) return source;
  const first = units[0];
  const last = units.at(-1);
  if (!first || !last) throw new RangeError(`Routing rule ${from + 1} does not exist.`);
  const separators = units
    .slice(0, -1)
    .map((unit, index) => source.slice(unit.end, units[index + 1]?.start ?? unit.end));
  const ordered = [...units];
  const [moved] = ordered.splice(from, 1);
  if (!moved) throw new RangeError(`Routing rule ${from + 1} does not exist.`);
  ordered.splice(to, 0, moved);
  const body = ordered.map((unit, index) => `${unit.content}${separators[index] ?? ""}`).join("");
  return `${source.slice(0, first.start)}${body}${source.slice(last.end)}`;
};
