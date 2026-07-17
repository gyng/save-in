import {
  applySourceEdits,
  choice,
  defineGrammar,
  end,
  lazy,
  literal,
  located,
  map,
  optional,
  parseSyntax,
  repeat,
  rest,
  sequence,
  sourceSpan,
  token,
  type SyntaxParser,
} from "../../src/shared/syntax-parser.ts";

describe("syntax parser combinators", () => {
  test("builds typed values and source spans from a deterministic grammar", () => {
    const assignment = defineGrammar(
      map(
        sequence(
          located(token(/[a-z]+/, "name")),
          literal(":"),
          optional(literal(" ")),
          located(rest()),
        ),
        ([name, , , value]) => ({ name, value }),
      ),
    );

    const parsed = parseSyntax(assignment, "route: images/file.png");

    expect(parsed).toEqual(
      expect.objectContaining({
        ok: true,
        value: {
          name: expect.objectContaining({ value: "route" }),
          value: expect.objectContaining({ value: "images/file.png" }),
        },
      }),
    );
    if (!parsed.ok) throw new Error("expected assignment to parse");
    expect(parsed.value.name.span).toEqual({
      start: { offset: 0, line: 1, column: 0 },
      end: { offset: 5, line: 1, column: 5 },
    });
    expect(parsed.value.value.span.start.offset).toBe(7);
  });

  test("reports the furthest committed failure without general backtracking", () => {
    const grammar = choice(sequence(literal("route"), literal(":")), literal("rule"));

    const parsed = parseSyntax(grammar, "route value");

    expect(parsed).toEqual({
      ok: false,
      offset: 5,
      diagnostic: {
        code: "expected",
        expected: '":"',
        position: { offset: 5, line: 1, column: 5 },
      },
    });
  });

  test("repeat stops before a non-matching token", () => {
    const parsed = parseSyntax(repeat(literal(">")), ">>>path");

    expect(parsed).toEqual(
      expect.objectContaining({ ok: true, value: [">", ">", ">"], offset: 3 }),
    );
  });

  test("handles empty alternatives and zero-width repetition safely", () => {
    expect(parseSyntax(choice(), "value")).toEqual(
      expect.objectContaining({
        ok: false,
        diagnostic: expect.objectContaining({ expected: "alternative" }),
      }),
    );
    expect(parseSyntax(repeat(optional(literal("x"))), "value")).toEqual(
      expect.objectContaining({ ok: true, value: [], offset: 0 }),
    );
  });

  test("propagates committed optional failures and invalid parser ranges", () => {
    const committedFailure: SyntaxParser<string> = (state) => ({
      ok: false,
      offset: state.offset + 1,
      diagnostic: {
        code: "expected",
        expected: "committed token",
        position: { offset: state.offset + 1, line: 1, column: state.offset + 1 },
      },
    });

    expect(parseSyntax(optional(committedFailure), "value")).toEqual(
      expect.objectContaining({ ok: false, offset: 1 }),
    );
    expect(parseSyntax(rest("remaining text"), "value", { offset: 2, limit: 1 })).toEqual(
      expect.objectContaining({
        ok: false,
        diagnostic: expect.objectContaining({ expected: "remaining text" }),
      }),
    );
  });

  test("supports recursive grammars with explicit full-input validation", () => {
    const expression: SyntaxParser<string> = lazy(() =>
      choice(
        token(/[a-z]+/, "name"),
        map(
          sequence(literal("("), expression, literal(")")),
          ([open, value, close]) => `${open}${value}${close}`,
        ),
      ),
    );
    const grammar = sequence(expression, end());

    expect(parseSyntax(grammar, "((route))")).toEqual(
      expect.objectContaining({ ok: true, value: ["((route))", undefined] }),
    );
    expect(parseSyntax(grammar, "route trailing")).toEqual(
      expect.objectContaining({ ok: false, offset: 5 }),
    );
  });

  test("applies non-overlapping source edits without shifting earlier spans", () => {
    const source = "abcdef";

    expect(
      applySourceEdits(source, [
        { span: sourceSpan(source, 1, 3), text: "XX" },
        { span: sourceSpan(source, 4, 6), text: "" },
      ]),
    ).toBe("aXXd");
    expect(
      applySourceEdits(source, [
        { span: sourceSpan(source, 1, 1), text: ">" },
        { span: sourceSpan(source, 1, 3), text: "XX" },
      ]),
    ).toBe("a>XXdef");
    expect(
      applySourceEdits(source, [
        { span: sourceSpan(source, 1, 1), text: ">" },
        { span: sourceSpan(source, 1, 1), text: "path" },
        { span: sourceSpan(source, 1, 1), text: " // note" },
      ]),
    ).toBe("a>path // notebcdef");
    expect(() =>
      applySourceEdits(source, [
        { span: sourceSpan(source, 1, 4), text: "x" },
        { span: sourceSpan(source, 3, 5), text: "y" },
      ]),
    ).toThrow("Source edits must not overlap");
  });
});
