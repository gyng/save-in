export type SourcePoint = {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
};

export type SourceSpan = {
  readonly start: SourcePoint;
  readonly end: SourcePoint;
};

export type SourceFragment<Kind extends string> = {
  readonly kind: Kind;
  readonly raw: string;
  readonly span: SourceSpan;
};

export type SourceEdit = {
  readonly span: SourceSpan;
  readonly text: string;
};

export type SyntaxDiagnostic = {
  code: "expected";
  expected: string;
  position: SourcePoint;
};

type ParseState = {
  source: string;
  offset: number;
  limit: number;
};

export type ParseSuccess<Value> = {
  ok: true;
  value: Value;
  offset: number;
  span: SourceSpan;
};

export type ParseFailure = {
  ok: false;
  offset: number;
  diagnostic: SyntaxDiagnostic;
};

export type ParseResult<Value> = ParseSuccess<Value> | ParseFailure;
export type SyntaxParser<Value> = (state: ParseState) => ParseResult<Value>;
export type Located<Value> = { value: Value; span: SourceSpan };

type ParserValue<Parser> = Parser extends SyntaxParser<infer Value> ? Value : never;
type SequenceValues<Parsers extends readonly SyntaxParser<unknown>[]> = {
  [Index in keyof Parsers]: ParserValue<Parsers[Index]>;
};

export const sourcePointAt = (source: string, offset: number): SourcePoint => {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let column = 0;
  for (let index = 0; index < bounded; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { offset: bounded, line, column };
};

export const sourceSpan = (source: string, start: number, end: number): SourceSpan => ({
  start: sourcePointAt(source, start),
  end: sourcePointAt(source, end),
});

export const sourceFragment = <Kind extends string>(
  source: string,
  kind: Kind,
  start: number,
  end: number,
): SourceFragment<Kind> => ({
  kind,
  raw: source.slice(start, end),
  span: sourceSpan(source, start, end),
});

export const applySourceEdits = (source: string, edits: readonly SourceEdit[]): string => {
  let result = source;
  let nextStart = source.length;
  // Equal-position insertions must be applied in reverse to preserve their declared order.
  for (const edit of edits
    .toReversed()
    .toSorted(
      (left, right) =>
        right.span.start.offset - left.span.start.offset ||
        right.span.end.offset - left.span.end.offset,
    )) {
    const { start, end } = edit.span;
    if (end.offset > nextStart) throw new Error("Source edits must not overlap");
    result = `${result.slice(0, start.offset)}${edit.text}${result.slice(end.offset)}`;
    nextStart = start.offset;
  }
  return result;
};

const success = <Value>(
  state: ParseState,
  start: number,
  offset: number,
  value: Value,
): ParseSuccess<Value> => ({
  ok: true,
  value,
  offset,
  span: sourceSpan(state.source, start, offset),
});

const failure = (state: ParseState, expected: string, offset = state.offset): ParseFailure => ({
  ok: false,
  offset,
  diagnostic: {
    code: "expected",
    expected,
    position: sourcePointAt(state.source, offset),
  },
});

export const defineGrammar = <Value>(parser: SyntaxParser<Value>): SyntaxParser<Value> => parser;

export const literal =
  <Value extends string>(value: Value): SyntaxParser<Value> =>
  (state) => {
    const end = state.offset + value.length;
    return end <= state.limit && state.source.slice(state.offset, end) === value
      ? success(state, state.offset, end, value)
      : failure(state, JSON.stringify(value));
  };

export const end = (): SyntaxParser<undefined> => (state) =>
  state.offset === state.limit
    ? success(state, state.offset, state.offset, undefined)
    : failure(state, "end of input");

export const token = (pattern: RegExp, expected = pattern.toString()): SyntaxParser<string> => {
  const flags = pattern.flags.replaceAll("g", "").replaceAll("y", "");
  const anchored = new RegExp(`^(?:${pattern.source})`, flags);
  return (state) => {
    const match = anchored.exec(state.source.slice(state.offset, state.limit));
    if (!match) return failure(state, expected);
    const value = match[0];
    return success(state, state.offset, state.offset + value.length, value);
  };
};

export const rest =
  (expected = "text"): SyntaxParser<string> =>
  (state) =>
    state.offset <= state.limit
      ? success(state, state.offset, state.limit, state.source.slice(state.offset, state.limit))
      : failure(state, expected);

export const sequence =
  <const Parsers extends readonly SyntaxParser<unknown>[]>(
    ...parsers: Parsers
  ): SyntaxParser<SequenceValues<Parsers>> =>
  (state) => {
    const values: unknown[] = [];
    let offset = state.offset;
    for (const parser of parsers) {
      const result = parser({ ...state, offset });
      if (!result.ok) return result;
      values.push(result.value);
      offset = result.offset;
    }
    // The loop appends one value per parser in the same order. TypeScript
    // cannot derive that variadic tuple relationship from a mutable array.
    return success(state, state.offset, offset, values as SequenceValues<Parsers>);
  };

export const choice =
  <const Parsers extends readonly SyntaxParser<unknown>[]>(
    ...parsers: Parsers
  ): SyntaxParser<ParserValue<Parsers[number]>> =>
  (state) => {
    let best: ParseFailure | null = null;
    for (const parser of parsers) {
      const result = parser(state);
      // Each alternative's success value is one member of the inferred union;
      // the generic loop widens the individual parser to SyntaxParser<unknown>.
      if (result.ok) return result as ParseSuccess<ParserValue<Parsers[number]>>;
      if (result.offset !== state.offset) return result;
      best = result;
    }
    return best ?? failure(state, "alternative");
  };

export const lazy =
  <Value>(getParser: () => SyntaxParser<Value>): SyntaxParser<Value> =>
  (state) =>
    getParser()(state);

export const optional =
  <Value>(parser: SyntaxParser<Value>): SyntaxParser<Value | undefined> =>
  (state) => {
    const result = parser(state);
    if (result.ok) return result;
    return result.offset === state.offset
      ? success(state, state.offset, state.offset, undefined)
      : result;
  };

export const repeat =
  <Value>(parser: SyntaxParser<Value>): SyntaxParser<Value[]> =>
  (state) => {
    const values: Value[] = [];
    let offset = state.offset;
    while (offset < state.limit) {
      const result = parser({ ...state, offset });
      if (!result.ok) {
        if (result.offset !== offset) return result;
        break;
      }
      if (result.offset === offset) break;
      values.push(result.value);
      offset = result.offset;
    }
    return success(state, state.offset, offset, values);
  };

export const map =
  <Input, Output>(
    parser: SyntaxParser<Input>,
    transform: (value: Input, span: SourceSpan) => Output,
  ): SyntaxParser<Output> =>
  (state) => {
    const result = parser(state);
    return result.ok
      ? success(state, state.offset, result.offset, transform(result.value, result.span))
      : result;
  };

export const located = <Value>(parser: SyntaxParser<Value>): SyntaxParser<Located<Value>> =>
  map(parser, (value, span) => ({ value, span }));

export const parseSyntax = <Value>(
  parser: SyntaxParser<Value>,
  source: string,
  options: { offset?: number; limit?: number } = {},
): ParseResult<Value> => {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? source.length;
  return parser({ source, offset, limit });
};
