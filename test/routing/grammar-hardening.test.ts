import { matchRulesDetailed } from "../../src/routing/rule-matcher.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";

const destinationFor = (source: string, filename = "report.jpg"): string | null => {
  const parsed = parseRulesCollecting(source);
  return matchRulesDetailed(parsed.rules, { filename })?.destination ?? null;
};

describe("routing grammar hardening", () => {
  test("a malformed line makes only its containing rule inert", () => {
    const parsed = parseRulesCollecting(
      [
        "filename: .*",
        "this is broken",
        "into: broad/:filename:",
        "",
        "filename: \\.pdf$",
        "into: documents/:filename:",
      ].join("\n"),
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleBadClause", error: "this is broken" }),
    );
    expect(parsed.rules).toHaveLength(1);
    expect(matchRulesDetailed(parsed.rules, { filename: "photo.jpg" })).toBeNull();
    expect(matchRulesDetailed(parsed.rules, { filename: "report.pdf" })?.destination).toBe(
      "documents/:filename:",
    );
  });

  test.each(["\r", "\u2028", "\u2029"])(
    "treats %j as a line terminator instead of silently ignoring the rest of a clause",
    (terminator) => {
      const parsed = parseRulesCollecting(
        `filename: jpg${terminator}this is broken\ninto: broad\n\nfilename: pdf\ninto: safe`,
      );

      expect(parsed.errors).toContainEqual(
        expect.objectContaining({ message: "ruleBadClause", error: "this is broken" }),
      );
      expect(parsed.rules).toHaveLength(1);
      expect(matchRulesDetailed(parsed.rules, { filename: "report.pdf" })?.destination).toBe(
        "safe",
      );
    },
  );

  test.each([
    "disabled: true\nfilename: [[\ninto: x",
    "disabled: true\nfilename: .*\ninto: :typo:",
    "disabled: true\nfilename: .*\ninto: ../outside/:filename:",
  ])("validates a disabled rule without making it executable: %s", (source) => {
    const parsed = parseRulesCollecting(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors.some((error) => !error.warning)).toBe(true);
  });

  test("keeps a valid disabled rule without executing or rejecting it", () => {
    expect(parseRulesCollecting("disabled: true\nfilename: .*\ninto: held/:filename:")).toEqual({
      rules: [],
      errors: [],
    });
  });

  test.each([
    "/absolute/:filename:",
    "\\\\server\\share\\:filename:",
    "C:\\outside\\:filename:",
    "../outside/:filename:",
    "./../outside/:filename:",
    "inside/../outside/:filename:",
    "inside\\..\\outside\\:filename:",
  ])("rejects a non-relative destination: %s", (destination) => {
    const parsed = parseRulesCollecting(`filename: .*\ninto: ${destination}`);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleDestinationMustBeRelative", error: destination }),
    );
  });

  test("continues accepting and normalizing an explicit relative prefix", () => {
    const parsed = parseRulesCollecting("filename: .*\ninto: ./inside/:filename:");
    expect(parsed.errors).toEqual([]);
    expect(matchRulesDetailed(parsed.rules, { filename: "x" })?.destination).toBe(
      "inside/:filename:",
    );
  });

  test("locates a parent component after a normalized relative prefix", () => {
    const source = "filename: .*\ninto: ./../outside";
    const error = parseRulesCollecting(source).errors.find(
      (candidate) => candidate.message === "ruleDestinationMustBeRelative",
    );
    expect(error?.location?.start).toBe(source.indexOf(".."));
  });

  test.each(["/absolute", "C:\\outside", "safe/../outside", "safe\\..\\outside"])(
    "skips a rule when capture expansion creates a non-relative destination: %s",
    (captured) => {
      const parsed = parseRulesCollecting(
        "filename: ^(.*)$\ncapturegroups: filename\ninto: :$1:\n\nfilename: .*\ninto: fallback",
      );
      expect(parsed.errors).toEqual([]);
      expect(matchRulesDetailed(parsed.rules, { filename: captured })?.destination).toBe(
        "fallback",
      );
    },
  );

  test("warns that an empty matcher is an explicit match-all and detects its shadow", () => {
    const parsed = parseRulesCollecting(
      "filename:\ninto: first/:filename:\n\nfilename: \\.jpg$\ninto: second/:filename:",
    );

    expect(parsed.rules).toHaveLength(2);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleEmptyMatcher", warning: true }),
    );
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleShadowed", error: "rule 2", warning: true }),
    );
    expect(destinationFor("filename:\ninto: first/:filename:")).toBe("first/:filename:");
  });

  test("reports a shadowed rule by its source ordinal after inert rules", () => {
    const parsed = parseRulesCollecting(
      "disabled: true\nfilename: z\ninto: z\n\nfilename: .*\ninto: first\n\nfilename: jpg\ninto: second",
    );

    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleShadowed", error: "rule 3", warning: true }),
    );
  });

  test.each([
    "into/i: x",
    "fetch/i: https://example.test/x",
    "capture/i: filename",
    "capturegroups/i: filename",
    "disabled/i: false",
  ])("rejects flags on a non-regex clause: %s", (clause) => {
    const source = `filename: (jpg)\n${clause}\n${clause.startsWith("into") ? "" : "into: x"}`;
    const parsed = parseRulesCollecting(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(expect.objectContaining({ message: "ruleClauseFlags" }));
  });

  test("rejects an empty flag suffix but accepts flags on matchers and rename", () => {
    expect(parseRulesCollecting("filename/: jpg\ninto: x").rules).toEqual([]);
    expect(parseRulesCollecting("filename/: jpg\ninto: x").errors).toContainEqual(
      expect.objectContaining({ message: "ruleInvalidRegex" }),
    );
    expect(parseRulesCollecting("filename/i: JPG\nrename/gi: jpg -> jpeg\ninto: x").errors).toEqual(
      [],
    );
  });

  test.each(["filename:  jpg$\ninto: x", "filename: jpg$  \ninto: x"])(
    "warns when regex-edge whitespace changes matching: %s",
    (source) => {
      const parsed = parseRulesCollecting(source);
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.errors).toContainEqual(
        expect.objectContaining({ message: "ruleSuspiciousWhitespace", warning: true }),
      );
    },
  );

  test.each([
    "filename: (jpg)\ninto: :$1:",
    "filename: (jpg)\nfetch: https://example.test/:$1:\ninto: x",
    "filename: (jpg)\nrename: jpg -> :$1:\ninto: x",
  ])("makes an unresolved capture reference execution-fatal: %s", (source) => {
    const parsed = parseRulesCollecting(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleMissingCapture" }),
    );
  });

  test.each([":file-name:", ":filename", ":$capture:"])(
    "rejects malformed variable syntax in destinations: %s",
    (variable) => {
      const parsed = parseRulesCollecting(`filename: .*\ninto: output/${variable}`);
      expect(parsed.rules).toEqual([]);
      expect(parsed.errors).toContainEqual(
        expect.objectContaining({ message: "ruleUnknownDestinationVariable", error: variable }),
      );
    },
  );

  test.each([":filename.txt", ":filename?download", ":$1.jpg"])(
    "rejects a known variable or capture missing its closing colon before punctuation: %s",
    (variable) => {
      const parsed = parseRulesCollecting(`filename: .*\ninto: output/${variable}`);
      expect(parsed.rules).toEqual([]);
      expect(parsed.errors).toContainEqual(
        expect.objectContaining({ message: "ruleUnknownDestinationVariable" }),
      );
    },
  );

  test("reports multiple malformed destination variables in source order", () => {
    const parsed = parseRulesCollecting("filename: .*\ninto: output/:$1.jpg/:filename.txt");
    expect(parsed.rules).toEqual([]);
    expect(
      parsed.errors
        .filter((error) => error.message === "ruleUnknownDestinationVariable")
        .map((error) => error.error),
    ).toEqual([":$1", ":filename"]);
  });

  test("does not reinterpret an IPv6 host segment as a variable", () => {
    const parsed = parseRulesCollecting(
      "filename: .*\nfetch: https://[2001:db8::1]/file\ninto: output/:filename:",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
  });

  test("warns locally about a potentially expensive expression", () => {
    const parsed = parseRulesCollecting("filename: (a+)+$\ninto: output/:filename:");
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({ message: "ruleUnsafeRegex", warning: true }),
    );

    const rename = parseRulesCollecting("filename: .*\nrename: (a+)+$ -> x\ninto: output");
    expect(rename.rules).toHaveLength(1);
    expect(rename.errors).toContainEqual(
      expect.objectContaining({ message: "ruleUnsafeRegex", warning: true }),
    );
  });

  test("accepts case-insensitive HTTP schemes but rejects statically unusable addresses", () => {
    expect(
      parseRulesCollecting("filename: .*\nfetch: HTTPS://example.test/file\ninto: output").errors,
    ).toEqual([]);
    for (const address of [
      "https:///file",
      "https://exa mple.test/file",
      "https://host:bad/file",
    ]) {
      const invalid = parseRulesCollecting(`filename: .*\nfetch: ${address}\ninto: output`);
      expect(invalid.rules).toEqual([]);
      expect(invalid.errors).toContainEqual(
        expect.objectContaining({ message: "ruleFetchNotHttp" }),
      );
    }
  });
});
