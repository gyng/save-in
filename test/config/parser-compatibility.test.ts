import {
  parsePathLineAst,
  serializeDirectoryLine,
  updateDirectoryLine,
  updateDirectoryMetadata,
} from "../../src/config/path-syntax.ts";
import { parseRoutingRuleAst, serializeRoutingDocument } from "../../src/routing/rule-syntax.ts";

type LegacyRuleToken = [fullClause: string, name: string, value: string];
type LegacyPathRow = { depth: number; body: string; comment: string };
type LegacyMetadataEntry = { key: string; value: string; start: number; end: number };

const legacyParsePathLine = (line: string): LegacyPathRow => {
  const commentIndex = line.indexOf("//");
  const rawBody = commentIndex === -1 ? line : line.slice(0, commentIndex);
  const comment = commentIndex === -1 ? "" : line.slice(commentIndex + 2).trim();
  const depthMatch = rawBody.trim().match(/^(>*)\s*(.*)$/);
  return {
    depth: depthMatch?.[1]?.length ?? 0,
    body: depthMatch?.[2]?.trim() ?? "",
    comment,
  };
};

const legacyParseMetadataEntries = (comment: string): LegacyMetadataEntry[] => {
  const entries: LegacyMetadataEntry[] = [];
  let cursor = 0;
  while (cursor < comment.length) {
    const start = comment.indexOf("(", cursor);
    if (start === -1) break;
    let separator = -1;
    for (let index = start + 1; index < comment.length; index += 1) {
      const character = comment[index];
      if (character === ":") {
        separator = index;
        break;
      }
      if (character === "(" || character === ")") break;
    }
    const key = separator === -1 ? "" : comment.slice(start + 1, separator).trim();
    if (!key) {
      cursor = start + 1;
      continue;
    }
    let depth = 1;
    let closing = -1;
    for (let index = separator + 1; index < comment.length; index += 1) {
      if (comment[index] === "(") depth += 1;
      if (comment[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          closing = index;
          break;
        }
      }
    }
    if (closing === -1) {
      cursor = start + 1;
      continue;
    }
    entries.push({
      key,
      value: comment.slice(separator + 1, closing).trim(),
      start,
      end: closing + 1,
    });
    cursor = closing + 1;
  }
  return entries;
};

const legacySetPathMetadata = (comment: string, key: string, value: string): string => {
  const matching = legacyParseMetadataEntries(comment).filter((entry) => entry.key === key);
  let cleaned = comment;
  for (const entry of matching.toReversed()) {
    const before = cleaned.slice(0, entry.start).trimEnd();
    const after = cleaned.slice(entry.end).trimStart();
    cleaned = before && after ? `${before} ${after}` : before || after;
  }
  cleaned = cleaned.trim();
  if (!value) return cleaned;
  const metadata = `(${key}: ${value})`;
  return cleaned ? `${cleaned} ${metadata}` : metadata;
};

const legacyTokenize = (source: string): { tokens: LegacyRuleToken[]; invalid: string[] } => {
  const tokens: LegacyRuleToken[] = [];
  const invalid: string[] = [];
  source.split(/\r\n|[\n\r\u2028\u2029]/).forEach((line) => {
    const matches = line.match(/^(\S*): ?(.*)/);
    const fullClause = matches?.[0];
    const name = matches?.[1];
    const value = matches?.[2];
    if (fullClause === undefined || name === undefined || value === undefined) invalid.push(line);
    else tokens.push([fullClause, name, value]);
  });
  return { tokens, invalid };
};

const legacyParseRouting = (raw: string): { rules: LegacyRuleToken[][]; invalid: string[] } => {
  const source = raw
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((line) => (line.trim() === "" ? "" : line))
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  if (!source) return { rules: [], invalid: [] };
  const invalid: string[] = [];
  const rules = source
    .replace(/\n\n+/g, "\n\n")
    .split("\n\n")
    .map((block) => {
      const parsed = legacyTokenize(block);
      invalid.push(...parsed.invalid);
      return parsed.tokens;
    });
  return { rules, invalid };
};

const generatedStrings = (seed: number, count: number, maxLength: number): string[] => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const alphabet = [
    "a",
    "Z",
    "0",
    ">",
    "/",
    ":",
    "(",
    ")",
    " ",
    "\t",
    "\r",
    "\n",
    "\u2028",
    "\u2029",
  ];
  return Array.from({ length: count }, () => {
    const length = next() % (maxLength + 1);
    return Array.from({ length }, () => alphabet[next() % alphabet.length]).join("");
  });
};

describe("legacy parser compatibility", () => {
  test("directory rows match the hand-rolled parser over edge cases and generated input", () => {
    const cases = [
      "",
      "images",
      "  >>> images/cats // label (alias: Cats) ",
      ">\tchild",
      "folder // https://example.test/a//b",
      "foo\rbar",
      "foo\nbar",
      "> \n child",
      ...generatedStrings(0x51_41_56_45, 2_000, 40),
    ];
    cases.forEach((source) => {
      const legacy = legacyParsePathLine(source);
      const parsed = parsePathLineAst(source).ast;
      expect(
        {
          depth: parsed.depth,
          body: parsed.path.value,
          comment: parsed.comment?.value ?? "",
        },
        JSON.stringify(source),
      ).toEqual(legacy);
      expect(serializeDirectoryLine(parsed), JSON.stringify(source)).toBe(source);
      if (parsed.cst.valid) {
        const comment = parsed.cst.comment;
        expect(
          [
            parsed.cst.leadingTrivia.raw,
            parsed.cst.nesting.raw,
            parsed.cst.pathLeadingTrivia.raw,
            parsed.path.value,
            parsed.cst.pathTrailingTrivia.raw,
            comment?.delimiter.raw ?? "",
            comment?.leadingTrivia.raw ?? "",
            comment?.content.raw ?? "",
            comment?.trailingTrivia.raw ?? "",
          ].join(""),
          JSON.stringify(source),
        ).toBe(source);
      }
    });
  });

  test("metadata recovery and nesting match the hand-rolled scanner", () => {
    const cases = [
      "",
      "(alias: Cats)",
      "prefix (alias: Work (shared)) suffix (key: w)",
      "(broken (alias: recovered))",
      "(: empty key) (ok: value)",
      "(open: value",
      ...generatedStrings(0x4d_45_54_41, 2_000, 60),
    ];
    cases.forEach((source) => {
      const normalized = source.trim();
      const parsed = parsePathLineAst(`path // ${source}`).ast;
      const contentStart = parsed.comment?.contentSpan.start.offset ?? 0;
      const entries = parsed.metadata.map((entry) => ({
        key: entry.key,
        value: entry.value,
        start: entry.span.start.offset - contentStart,
        end: entry.span.end.offset - contentStart,
      }));
      expect(entries, JSON.stringify(source)).toEqual(legacyParseMetadataEntries(normalized));
    });
  });

  test("AST metadata edits match the hand-rolled updater", () => {
    const cases = [
      "",
      "cute (alias: Cats) (key: c)",
      "(alias: One) middle (alias: Two)",
      "(broken (alias: recovered))",
      "notes (alias: Work (shared))",
      ...generatedStrings(0x45_44_49_54, 1_000, 80),
    ];
    const updates = [
      ["alias", ""],
      ["alias", "Dogs"],
      ["key", "w"],
      ["alias", "Work (shared)"],
    ] as const;
    cases.forEach((source) => {
      const normalized = source.trim();
      updates.forEach(([key, value]) => {
        const parsed = parsePathLineAst(`path${normalized ? ` // ${normalized}` : ""}`).ast;
        const updated = updateDirectoryMetadata(parsed, key, value);
        expect(updated.comment?.value ?? "", `${JSON.stringify(source)} ${key}=${value}`).toBe(
          legacySetPathMetadata(normalized, key, value),
        );
      });
    });
  });

  test("AST edits preserve generated directory trivia combinations", () => {
    const comments = [
      { raw: "", updated: null },
      { raw: "//note", updated: "//changed" },
      { raw: " //  note  ", updated: " //  changed  " },
      { raw: "\t//\tnote\t", updated: "\t//\tchanged\t" },
    ] as const;
    for (const leading of ["", " ", " \t"] as const) {
      for (const nesting of ["", ">", ">>>"] as const) {
        for (const spacing of ["", " ", "\t"] as const) {
          for (const trailing of ["", " ", "  "] as const) {
            for (const comment of comments) {
              const source = `${leading}${nesting}${spacing}path${trailing}${comment.raw}`;
              const parsed = parsePathLineAst(source).ast;
              const updated = updateDirectoryLine(parsed, {
                depth: 2,
                path: "archive",
                comment: "changed",
              });
              const updatedComment = comment.updated ?? `${trailing ? "" : " "}// changed`;
              const expectedLeading = nesting ? leading : `${leading}${spacing}`;
              const expectedSpacing = nesting ? spacing : "";
              expect(serializeDirectoryLine(updated), JSON.stringify(source)).toBe(
                `${expectedLeading}>>${expectedSpacing}archive${trailing}${updatedComment}`,
              );
              if (parsed.cst.comment) {
                expect(
                  serializeDirectoryLine(updateDirectoryLine(parsed, { comment: "" })),
                  JSON.stringify(source),
                ).toBe(source.slice(0, parsed.cst.comment.delimiter.span.start.offset));
              }
            }
          }
        }
      }
    }
  });

  test("routing rule grouping and tokens remain compatible across supported line endings", () => {
    const cases = [
      "",
      "// comment",
      " filename: jpg \n into: images ",
      "filename: jpg\r\ninto: images\r\n\r\npageurl: cat\r\ninto: cats",
      "sourceurl: one\n// transparent comment\ninto: first",
      "sourceurl: one\n \t \ninto: second",
      ...generatedStrings(0x44_4f_43_53, 2_000, 100),
    ];
    cases.forEach((source) => {
      const legacy = legacyParseRouting(source);
      const parsed = parseRoutingRuleAst(source);
      expect(serializeRoutingDocument(parsed.ast), JSON.stringify(source)).toBe(source);
      expect(
        parsed.ast.lines.map((line) => `${line.cst.line.raw}${line.cst.terminator.raw}`).join(""),
        JSON.stringify(source),
      ).toBe(source);
      const tokens = parsed.ast.rules.map((rule) =>
        rule.clauses.map((clause): LegacyRuleToken => [clause.raw, clause.rawName, clause.value]),
      );
      expect(tokens, JSON.stringify(source)).toEqual(legacy.rules);
      expect(
        parsed.issues.map((issue) => issue.source),
        JSON.stringify(source),
      ).toEqual(legacy.invalid);
    });
  });
});
