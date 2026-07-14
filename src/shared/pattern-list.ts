export type PatternListEntry<Value> = {
  readonly source: string;
  readonly value: Value;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type PatternListIssue = {
  readonly source: string;
  readonly error: Error;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export type PatternListResult<Value> = {
  readonly entries: readonly PatternListEntry<Value>[];
  readonly issues: readonly PatternListIssue[];
};

type PatternParser<Value> = (source: string) => Value | Error;

// Pattern options are stored as newline-delimited text. Keep whitespace and
// empty-line handling here so background matching and editor diagnostics agree.
export const parsePatternList = <Value>(
  source: string | null | undefined,
  parsePattern: PatternParser<Value>,
): PatternListResult<Value> => {
  const input = source ?? "";
  const entries: PatternListEntry<Value>[] = [];
  const issues: PatternListIssue[] = [];
  let lineStart = 0;

  input.split("\n").forEach((rawLine, index) => {
    const leading = rawLine.length - rawLine.trimStart().length;
    const pattern = rawLine.trim();
    if (pattern) {
      const start = lineStart + leading;
      const end = start + pattern.length;
      const parsed = parsePattern(pattern);
      const located = {
        source: pattern,
        start,
        end,
        line: index + 1,
        column: leading,
      };
      if (parsed instanceof Error) issues.push({ ...located, error: parsed });
      else entries.push({ ...located, value: parsed });
    }
    lineStart += rawLine.length + 1;
  });

  return { entries, issues };
};

export const parseRegularExpressionList = (
  source: string | null | undefined,
): PatternListResult<RegExp> =>
  parsePatternList(source, (pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      // The native RegExp constructor only throws SyntaxError instances.
      return error as Error;
    }
  });
