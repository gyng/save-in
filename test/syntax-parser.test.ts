import {
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
  token,
  type SyntaxParser,
} from "../src/shared/syntax-parser.ts";

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
});
