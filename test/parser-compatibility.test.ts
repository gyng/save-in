import {
  parsePathLine,
  parsePathMetadataEntries,
  type PathMetadataEntry,
  type PathRow,
} from "../src/config/path-syntax.ts";
import { parseRoutingRuleAst } from "../src/routing/rule-syntax.ts";

type LegacyRuleToken = [fullClause: string, name: string, value: string];

const legacyParsePathLine = (line: string): PathRow => {
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

const legacyParseMetadataEntries = (comment: string): PathMetadataEntry[] => {
  const entries: PathMetadataEntry[] = [];
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

const legacyTokenize = (source: string): { tokens: LegacyRuleToken[]; invalid: string[] } => {
  const tokens: LegacyRuleToken[] = [];
  const invalid: string[] = [];
  source.split("\n").forEach((line) => {
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
    .split("\n")
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
      expect(parsePathLine(source), JSON.stringify(source)).toEqual(legacyParsePathLine(source));
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
      expect(parsePathMetadataEntries(source), JSON.stringify(source)).toEqual(
        legacyParseMetadataEntries(source),
      );
    });
  });

  test("routing rule grouping and tokens match normalized legacy documents", () => {
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
