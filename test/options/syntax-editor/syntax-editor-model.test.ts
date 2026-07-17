import {
  analyzeSyntax,
  completeDirectorySyntax,
  completeRoutingSyntax,
  directoryValidationLocation,
  validationErrorsToDiagnostics,
} from "../../../src/options/syntax-editor/syntax-editor-model.ts";

const tokenText = (source: string, start: number, end: number) => source.slice(start, end);

describe("syntax editor model", () => {
  test("maps a path-relative validation range to an exact source location", () => {
    expect(
      directoryValidationLocation("first\n\n  docs/:year:/:modnthname:  ", 1, {
        start: 12,
        end: 24,
      }),
    ).toEqual({ start: 21, end: 33, line: 3, column: 14 });
  });

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

  test("highlights blank, separator, plain, comment, and capture syntax", () => {
    const directories = "\n---\nplain\n// note";
    const directorySnapshot = analyzeSyntax("directories", directories);
    expect(
      directorySnapshot.tokens.map(({ kind, start, end }) => [
        kind,
        tokenText(directories, start, end),
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["separator", "---"],
        ["path", "plain"],
        ["comment-delimiter", "//"],
        ["comment", " note"],
      ]),
    );

    const routing = "// note\n//\ncapture: filename\ninto: :filename:";
    const routingSnapshot = analyzeSyntax("routing", routing);
    expect(
      routingSnapshot.tokens.map(({ kind, start, end }) => [kind, tokenText(routing, start, end)]),
    ).toEqual(
      expect.arrayContaining([
        ["comment-delimiter", "//"],
        ["comment", " note"],
        ["capture", "capture"],
        ["capture-value", "filename"],
        ["destination-value", ":filename:"],
      ]),
    );
  });

  test("highlights and validates WebExtension match-pattern lists", () => {
    const source = "  *://*.example.com/files/*  \nnot a pattern\n\nfile:///*";
    const snapshot = analyzeSyntax("match-patterns", source);
    const byKind = (kind: string) =>
      snapshot.tokens
        .filter((candidate) => candidate.kind === kind)
        .map(({ start, end }) => tokenText(source, start, end));

    expect(byKind("matcher")).toEqual(["*", "file"]);
    expect(byKind("punctuation")).toEqual(["://", "://"]);
    expect(byKind("destination-value")).toEqual(["*.example.com"]);
    expect(byKind("regex")).toEqual(["/files/*", "/*"]);
    expect(byKind("invalid")).toEqual(["not a pattern"]);
    expect(snapshot.diagnostics).toEqual([
      {
        start: 30,
        end: 43,
        line: 2,
        column: 0,
        message: "matchPatternInvalid",
        severity: "error",
      },
    ]);
  });

  test("highlights each regular expression and locates invalid lines", () => {
    const source = " example\\.com \n  (  \n/files/";
    const snapshot = analyzeSyntax("regular-expressions", source);

    expect(
      snapshot.tokens.map(({ kind, start, end }) => [kind, tokenText(source, start, end)]),
    ).toEqual([
      ["regex", "example\\.com"],
      ["regex", "/files/"],
      ["invalid", "("],
    ]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: 2, message: "regularExpressionInvalid" }),
    ]);
  });

  test("highlights webhook endpoints and blames each bad line for its own reason", () => {
    const source =
      "  https://hooks.example.com/save?token=1  \nhttp://insecure.example.com/save\n\nnot a URL";
    const snapshot = analyzeSyntax("webhook-endpoints", source);
    const byKind = (kind: string) =>
      snapshot.tokens
        .filter((candidate) => candidate.kind === kind)
        .map(({ start, end }) => tokenText(source, start, end));

    expect(byKind("matcher")).toEqual(["https"]);
    expect(byKind("punctuation")).toEqual(["://"]);
    expect(byKind("destination-value")).toEqual(["hooks.example.com"]);
    expect(byKind("path")).toEqual(["/save?token=1"]);
    expect(byKind("invalid")).toEqual(["http://insecure.example.com/save", "not a URL"]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: 0, message: "webhookEndpointNotHttps" }),
      expect.objectContaining({ line: 4, column: 0, message: "webhookEndpointMalformed" }),
    ]);
  });

  test("highlights an accepted endpoint that has no :// as one span", () => {
    // new URL() accepts this and normalizes it to https://hooks.example.com/save,
    // so the endpoint is valid but has no scheme separator to split on.
    const source = "https:/hooks.example.com/save";
    const snapshot = analyzeSyntax("webhook-endpoints", source);

    expect(
      snapshot.tokens.map(({ kind, start, end }) => [kind, tokenText(source, start, end)]),
    ).toEqual([["destination-value", "https:/hooks.example.com/save"]]);
    expect(snapshot.diagnostics).toEqual([]);
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

  test("rejects completion outside grammar slots and filters explicit capture values", () => {
    const variables = [":date:", ":day:"];
    const matchers = ["into", "capturegroups", "fileext", "filename"];
    const vocabulary = { matchers, variables };

    expect(completeDirectorySyntax("  >> :da", 1, variables)).toBeNull();
    expect(completeDirectorySyntax("plain", 5, variables)).toBeNull();
    expect(completeDirectorySyntax(":zz", 3, variables)).toBeNull();
    expect(completeDirectorySyntax("first\n:da\nlast", 9, variables)?.suggestions).toEqual([
      ":date:",
      ":day:",
    ]);

    expect(completeRoutingSyntax("// fil", 6, vocabulary)).toBeNull();
    expect(completeRoutingSyntax("fi-", 3, vocabulary)).toBeNull();
    expect(completeRoutingSyntax("zzz", 3, vocabulary)).toBeNull();
    expect(completeRoutingSyntax("  fil", 5, vocabulary)).toEqual({
      start: 2,
      end: 5,
      suggestions: ["fileext", "filename"],
      suffix: ": ",
    });
    expect(completeRoutingSyntax("capture:", 8, vocabulary)).toBeNull();
    expect(completeRoutingSyntax("capture:", 8, vocabulary, true)?.suggestions).toEqual([
      "fileext",
      "filename",
    ]);
    expect(completeRoutingSyntax("capture: nope", 13, vocabulary)).toBeNull();
    expect(completeRoutingSyntax("capture: fileext, fil", 21, vocabulary)?.suggestions).toEqual([
      "fileext",
      "filename",
    ]);
    expect(completeRoutingSyntax("filename: fil", 8, vocabulary)?.suggestions).toEqual([
      "filename",
    ]);
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
      validationErrorsToDiagnostics("directories", "docs/:year:/:modnthname:", [
        {
          sourceIndex: 0,
          message: "Path variable is not supported",
          error: ":modnthname:",
          sourceRange: { start: 12, end: 24 },
        },
      ]),
    ).toEqual([
      {
        start: 12,
        end: 24,
        line: 1,
        column: 12,
        message: "Path variable is not supported: :modnthname:",
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

  test("drops unlocatable validation errors and preserves message-only errors", () => {
    expect(
      validationErrorsToDiagnostics("directories", "first", [
        { message: "Missing index", error: "" },
        { message: "Past end", error: "", sourceIndex: 4 },
      ]),
    ).toEqual([]);
    expect(
      validationErrorsToDiagnostics("routing", "filename: x", [
        { message: "No location", error: "" },
        {
          message: "Invalid matcher",
          error: "",
          location: { start: 0, end: 8, line: 1, column: 0 },
        },
      ]),
    ).toEqual([
      {
        start: 0,
        end: 8,
        line: 1,
        column: 0,
        message: "Invalid matcher",
        severity: "error",
      },
    ]);
  });

  test("highlights a fetch clause like a destination with variable tokens", () => {
    const source = "filename: a\nfetch: https://x.example/:$1:";
    const snapshot = analyzeSyntax("routing", source);
    const byKind = (kind: string) =>
      snapshot.tokens
        .filter((candidate) => candidate.kind === kind)
        .map(({ start, end }) => tokenText(source, start, end));

    expect(byKind("destination")).toContain("fetch");
    expect(byKind("destination-value")).toContain("https://x.example/:$1:");
    expect(byKind("variable")).toContain(":$1:");
  });

  test("completes fetch as a clause name and excludes fetch-incompatible variables", () => {
    const matchers = ["fetch", "into", "filename"];
    const variables = [":pagedomain:", ":mime:", ":sha256:", ":sha256full:"];
    const vocabulary = { matchers, variables };

    expect(completeRoutingSyntax("fet", 3, vocabulary)).toEqual({
      start: 0,
      end: 3,
      suggestions: ["fetch"],
      suffix: ": ",
    });

    const fetchValue = "fetch: https://x.example/:";
    expect(completeRoutingSyntax(fetchValue, fetchValue.length, vocabulary)?.suggestions).toEqual([
      ":pagedomain:",
    ]);

    const intoValue = "into: :";
    expect(completeRoutingSyntax(intoValue, intoValue.length, vocabulary)?.suggestions).toEqual([
      ":pagedomain:",
      ":mime:",
      ":sha256:",
      ":sha256full:",
    ]);
  });

  test("highlights a rename clause as regex, separator, and replacement", () => {
    const source = "filename: a\nrename/gi: ^img_(\\d+) -> photo-:$1:";
    const snapshot = analyzeSyntax("routing", source);
    const byKind = (kind: string) =>
      snapshot.tokens
        .filter((candidate) => candidate.kind === kind)
        .map(({ start, end }) => tokenText(source, start, end));

    expect(byKind("destination")).toContain("rename");
    expect(byKind("flags")).toContain("gi");
    expect(byKind("regex")).toContain("^img_(\\d+)");
    expect(byKind("punctuation")).toContain(" -> ");
    expect(byKind("destination-value")).toContain("photo-:$1:");
    expect(byKind("variable")).toContain(":$1:");
  });

  test("a rename clause without a separator highlights the value as one regex", () => {
    const source = "rename: no-separator";
    const snapshot = analyzeSyntax("routing", source);
    const regexToken = snapshot.tokens.find((candidate) => candidate.kind === "regex");
    expect(regexToken && source.slice(regexToken.start, regexToken.end)).toBe("no-separator");
  });

  test("completes variables only in the rename replacement side", () => {
    const vocabulary = {
      matchers: ["filename"],
      variables: [":pagedomain:", ":mime:"],
    };

    // Metadata-dependent variables stay available: the rename applies at the
    // filename stage, where the pipeline can resolve them.
    const replacement = "rename: a -> :";
    expect(completeRoutingSyntax(replacement, replacement.length, vocabulary)?.suggestions).toEqual(
      [":pagedomain:", ":mime:"],
    );

    // The find side is a regex, so ":" there must not open variable completion.
    const find = "rename: :m -> x";
    expect(completeRoutingSyntax(find, "rename: :".length, vocabulary)).toBeNull();

    const missingSeparator = "rename: a:";
    expect(completeRoutingSyntax(missingSeparator, missingSeparator.length, vocabulary)).toBeNull();
  });
});
