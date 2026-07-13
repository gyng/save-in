import {
  analyzeSyntax,
  completeDirectorySyntax,
  completeRoutingSyntax,
  validationErrorsToDiagnostics,
} from "../src/options/syntax-editor-model.ts";

const tokenText = (source: string, start: number, end: number) => source.slice(start, end);

describe("syntax editor model", () => {
  test("highlights directory grammar tokens and locates invalid lines", () => {
    const source = "  >> images/:date: // note (alias: Images)\n// missing";
    const snapshot = analyzeSyntax("directories", source);
    const byKind = (kind: string) =>
      snapshot.tokens
        .filter((candidate) => candidate.kind === kind)
        .map(({ start, end }) => tokenText(source, start, end));

    expect(snapshot.lines.map((line) => line.number)).toEqual([1, 2]);
    expect(byKind("nesting")).toEqual([">>"]);
    expect(byKind("variable")).toEqual([":date:"]);
    expect(byKind("comment-delimiter")).toEqual(["//", "//"]);
    expect(byKind("metadata")).toEqual(["(alias: Images)"]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: 0, message: "html_required" }),
    ]);
    expect(source.slice(snapshot.diagnostics[0]!.start, snapshot.diagnostics[0]!.end)).toBe("/");
  });

  test("highlights routing clauses, regexes, destinations, and variables", () => {
    const source = "filename/i: \\.png$\ninto: images/:date:\n\nbroken";
    const snapshot = analyzeSyntax("routing", source);
    const values = Object.fromEntries(
      snapshot.tokens.map((candidate) => [
        candidate.kind,
        tokenText(source, candidate.start, candidate.end),
      ]),
    );

    expect(values).toEqual(
      expect.objectContaining({
        matcher: "filename",
        flags: "i",
        regex: "\\.png$",
        destination: "into",
        variable: ":date:",
        invalid: "broken",
      }),
    );
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ line: 4, column: 6, message: "ruleBadClause" }),
    ]);
  });

  test("uses grammar context for directory and routing completions", () => {
    const variables = [":date:", ":day:", ":filename:"];
    const matchers = ["into", "capturegroups", "fileext", "filename"];

    expect(completeDirectorySyntax("images/:da", 10, variables)).toEqual({
      start: 7,
      end: 10,
      suggestions: [":date:", ":day:"],
      suffix: "",
    });
    expect(completeDirectorySyntax("images // :da", 13, variables)).toBeNull();

    expect(completeRoutingSyntax("fil", 3, { matchers, variables })).toEqual({
      start: 0,
      end: 3,
      suggestions: ["fileext", "filename"],
      suffix: ": ",
    });
    expect(completeRoutingSyntax("into: images/:da", 16, { matchers, variables })).toEqual({
      start: 13,
      end: 16,
      suggestions: [":date:", ":day:"],
      suffix: "",
    });
    expect(completeRoutingSyntax("capturegroups: fil", 18, { matchers, variables })).toEqual({
      start: 15,
      end: 18,
      suggestions: ["fileext", "filename"],
      suffix: "",
    });
    expect(completeRoutingSyntax("filename: fil", 13, { matchers, variables })).toBeNull();
    expect(completeRoutingSyntax("", 0, { matchers, variables })).toBeNull();
    expect(completeRoutingSyntax("", 0, { matchers, variables }, true)?.suggestions).toEqual(
      matchers,
    );
  });

  test("turns path indexes and routing locations into editor diagnostics", () => {
    expect(
      validationErrorsToDiagnostics("directories", "  first\n\n  second  ", [
        { sourceIndex: 1, message: "Invalid path", error: "second" },
      ]),
    ).toEqual([
      {
        start: 11,
        end: 17,
        line: 3,
        column: 2,
        message: "Invalid path: second",
        severity: "error",
      },
    ]);
    expect(
      validationErrorsToDiagnostics("routing", "filename: [[\ninto: x", [
        {
          message: "Invalid regular expression",
          error: "SyntaxError",
          warning: true,
          location: { start: 10, end: 12, line: 1, column: 10 },
        },
      ]),
    ).toEqual([
      {
        start: 10,
        end: 12,
        line: 1,
        column: 10,
        message: "Invalid regular expression: SyntaxError",
        severity: "warning",
      },
    ]);
  });
});
