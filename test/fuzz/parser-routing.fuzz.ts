import { fc, test } from "@fast-check/vitest";
import type { Parameters } from "fast-check";
import {
  getDirectoryMetadata,
  parsePathLineAst,
  serializeDirectoryLine,
  updateDirectoryLine,
  updateDirectoryMetadata,
} from "../../src/config/path-syntax.ts";
import { seedOptions } from "../../src/config/option.ts";
import { options } from "../../src/config/options-data.ts";
import { FORBIDDEN_FILENAME_CHARS, RULE_TYPES } from "../../src/shared/constants.ts";
import { validateWebhookUrl } from "../../src/shared/webhook.ts";
import {
  getFilenameDiagnostics,
  RESERVED_DEVICE_NAME_REGEX,
  sanitizeFilename,
} from "../../src/routing/path.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { parseRoutingRuleAst, serializeRoutingDocument } from "../../src/routing/rule-syntax.ts";
import type { SourceSpan } from "../../src/shared/syntax-parser.ts";

type FuzzParameters = Pick<
  Parameters<never>,
  "interruptAfterTimeLimit" | "markInterruptAsFailure" | "numRuns" | "path" | "seed"
>;

type FuzzTarget = {
  name: string;
  run(parameters: FuzzParameters): FuzzDetails;
};

type FuzzDetails = {
  counterexample: unknown;
  counterexamplePath: string | null;
  errorInstance: unknown;
  failed: boolean;
  numRuns: number;
  numShrinks: number;
  seed: number;
};

const DEFAULT_FUZZ_TIME_MS = 1_000;
const MAX_FUZZ_RUNS = 0x7fff_ffff;

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const assertSpan = (source: string, span: SourceSpan, label: string): void => {
  invariant(Number.isInteger(span.start.offset), `${label} start is not an integer`);
  invariant(Number.isInteger(span.end.offset), `${label} end is not an integer`);
  invariant(span.start.offset >= 0, `${label} starts before the input`);
  invariant(span.start.offset <= span.end.offset, `${label} is reversed`);
  invariant(span.end.offset <= source.length, `${label} ends after the input`);
  invariant(span.start.line >= 1 && span.end.line >= span.start.line, `${label} has invalid lines`);
  invariant(span.start.column >= 0 && span.end.column >= 0, `${label} has invalid columns`);
};

const parseInteger = (name: string, fallback?: number): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value;
};

const codeUnitArbitrary = fc.integer({ min: 0, max: 0xffff }).map(String.fromCharCode);
const sourceTextArbitrary = fc
  .array(codeUnitArbitrary, { maxLength: 512 })
  .map((characters) => characters.join(""));
const lineCodeUnitArbitrary = fc
  .integer({ min: 0, max: 0xffff })
  .filter((value) => ![0x0a, 0x0d, 0x2028, 0x2029].includes(value))
  .map(String.fromCharCode);
const lineTextArbitrary = fc
  .array(lineCodeUnitArbitrary, { maxLength: 256 })
  .map((characters) => characters.join(""));
const editableTextArbitrary = fc
  .array(fc.constantFrom("a", "Z", "0", " ", ".", "_", "-", "/", ":", "(", ")", "é", "界", "😀"), {
    minLength: 1,
    maxLength: 80,
  })
  .map((characters) => characters.join(""))
  .filter((value) => value === value.trim() && value.trim() !== "" && !value.includes("//"));
const metadataAtomArbitrary = fc
  .array(fc.constantFrom("a", "Z", "0", " ", ".", "_", "-", "/", ":", "é", "界", "😀"), {
    minLength: 1,
    maxLength: 40,
  })
  .map((characters) => characters.join(""))
  .filter((value) => value === value.trim() && value.trim() !== "" && !value.includes("//"));
const metadataValueArbitrary = fc.oneof(
  metadataAtomArbitrary,
  fc
    .tuple(metadataAtomArbitrary, metadataAtomArbitrary)
    .map(([outer, nested]) => `${outer} (${nested})`),
);

const directoryLossless: FuzzTarget = {
  name: "directory-lossless",
  run: (parameters) =>
    fc.check(
      fc.property(sourceTextArbitrary, (source) => {
        const parsed = parsePathLineAst(source);
        const { ast } = parsed;
        invariant(serializeDirectoryLine(ast) === source, "directory serialization changed input");
        invariant(ast.raw === source, "directory AST lost its source");
        assertSpan(source, ast.span, "directory");
        assertSpan(source, ast.path.span, "directory path");
        if (ast.comment) {
          assertSpan(source, ast.comment.span, "directory comment");
          assertSpan(source, ast.comment.contentSpan, "directory comment content");
        }
        ast.metadata.forEach((entry, index) =>
          assertSpan(source, entry.span, `directory metadata ${index}`),
        );
        parsed.issues.forEach((issue) => {
          invariant(issue.column >= 0 && issue.column <= source.length, "invalid issue column");
        });
      }),
      parameters,
    ),
};

const directoryEdits: FuzzTarget = {
  name: "directory-edits",
  run: (parameters) =>
    fc.check(
      fc.property(
        fc.record({
          source: lineTextArbitrary,
          depth: fc.integer({ min: 0, max: 12 }),
          path: editableTextArbitrary,
          comment: fc.oneof(fc.constant(""), editableTextArbitrary),
          metadataKey: fc.constantFrom("alias", "key", "note"),
          metadataValue: metadataValueArbitrary,
        }),
        ({ source, depth, path, comment, metadataKey, metadataValue }) => {
          const updated = updateDirectoryLine(parsePathLineAst(source).ast, {
            depth,
            path,
            comment,
          });
          const reparsed = parsePathLineAst(serializeDirectoryLine(updated)).ast;
          invariant(reparsed.depth === depth, "directory edit changed nesting depth");
          invariant(reparsed.path.value === path, "directory edit changed the path");
          invariant((reparsed.comment?.value ?? "") === comment, "directory edit changed comment");
          invariant(
            updateDirectoryLine(reparsed, { depth, path, comment }).raw === reparsed.raw,
            "reapplying a directory edit was not idempotent",
          );

          const withMetadata = updateDirectoryMetadata(reparsed, metadataKey, metadataValue);
          invariant(
            getDirectoryMetadata(withMetadata, metadataKey) === metadataValue,
            "metadata update did not round-trip",
          );
          invariant(
            updateDirectoryMetadata(withMetadata, metadataKey, metadataValue).raw ===
              withMetadata.raw,
            "reapplying metadata was not idempotent",
          );
          invariant(
            getDirectoryMetadata(
              updateDirectoryMetadata(withMetadata, metadataKey, ""),
              metadataKey,
            ) === "",
            "metadata removal left a matching entry",
          );
        },
      ),
      parameters,
    ),
};

const routingLossless: FuzzTarget = {
  name: "routing-lossless",
  run: (parameters) =>
    fc.check(
      fc.property(sourceTextArbitrary, (source) => {
        const parsed = parseRoutingRuleAst(source);
        invariant(
          serializeRoutingDocument(parsed.ast) === source,
          "routing serialization changed input",
        );
        invariant(parsed.ast.source === source, "routing AST lost its source");
        assertSpan(source, parsed.ast.span, "routing document");
        const reconstructed = parsed.ast.lines
          .map((line) => `${line.cst.line.raw}${line.cst.terminator.raw}`)
          .join("");
        invariant(reconstructed === source, "routing CST did not reconstruct the input");
        parsed.ast.lines.forEach((line, index) => {
          assertSpan(source, line.span, `routing line ${index}`);
          assertSpan(source, line.cst.line.span, `routing line content ${index}`);
          assertSpan(source, line.cst.terminator.span, `routing line terminator ${index}`);
        });
        parsed.ast.rules.forEach((rule, index) => {
          assertSpan(source, rule.span, `routing rule ${index}`);
          rule.clauses.forEach((clause, clauseIndex) => {
            assertSpan(source, clause.span, `routing clause ${index}.${clauseIndex}`);
            assertSpan(source, clause.nameSpan, `routing clause name ${index}.${clauseIndex}`);
            assertSpan(source, clause.valueSpan, `routing clause value ${index}.${clauseIndex}`);
          });
        });
        parsed.issues.forEach((issue, index) =>
          assertSpan(source, issue.span, `routing issue ${index}`),
        );
      }),
      parameters,
    ),
};

const semanticSignature = (source: string) => {
  const parsed = parseRulesCollecting(source);
  return {
    errors: parsed.errors,
    rules: parsed.rules.map((rule) =>
      rule.map((clause) => ({
        name: clause.name,
        type: clause.type,
        value:
          clause.value instanceof RegExp
            ? { source: clause.value.source, flags: clause.value.flags }
            : clause.value,
      })),
    ),
  };
};

const routingSemantic: FuzzTarget = {
  name: "routing-semantic",
  run: (parameters) =>
    fc.check(
      fc.property(sourceTextArbitrary, (source) => {
        const first = semanticSignature(source);
        const second = semanticSignature(source);
        const syntax = parseRoutingRuleAst(source);
        invariant(
          JSON.stringify(first) === JSON.stringify(second),
          "semantic parsing was unstable",
        );
        first.errors.forEach((error, index) => {
          invariant(error.location !== undefined, `routing error ${index} has no location`);
          invariant(error.location.start >= 0, `routing error ${index} starts before input`);
          invariant(
            error.location.start <= error.location.end,
            `routing error ${index} is reversed`,
          );
          invariant(error.location.end <= source.length, `routing error ${index} ends after input`);
        });
        first.rules.forEach((rule, index) => {
          invariant(
            rule.filter((clause) => clause.type === RULE_TYPES.DESTINATION).length === 1,
            `routing rule ${index} does not have one destination`,
          );
          invariant(
            rule.some((clause) => clause.type === RULE_TYPES.MATCHER),
            `routing rule ${index} has no matcher`,
          );
        });
        syntax.ast.rules.forEach((rule, index) => {
          const hasFatalSyntax = syntax.issues.some(
            (issue) =>
              issue.span.start.offset >= rule.span.start.offset &&
              issue.span.end.offset <= rule.span.end.offset,
          );
          if (!hasFatalSyntax) return;
          const isolated = source.slice(rule.span.start.offset, rule.span.end.offset);
          invariant(
            parseRulesCollecting(isolated).rules.length === 0,
            `routing rule ${index} remained executable after a syntax error`,
          );
        });
      }),
      parameters,
    ),
};

const filenameSafety: FuzzTarget = {
  name: "filename-safety",
  run: (parameters) =>
    fc.check(
      fc.property(
        sourceTextArbitrary,
        fc.integer({ min: 1, max: 255 }),
        fc.boolean(),
        fc.boolean(),
        (source, maxBytes, leadingDotsForbidden, preserveExtension) => {
          const result = sanitizeFilename(
            source,
            maxBytes,
            leadingDotsForbidden,
            preserveExtension,
          );
          if (!source) {
            invariant(result === source, "empty filename changed");
            return;
          }
          invariant(result.length > 0, "sanitization produced an empty filename");
          invariant(
            !getFilenameDiagnostics(result, maxBytes).exceedsLimit,
            "sanitized filename exceeds its UTF-8 byte limit",
          );
          invariant(
            !FORBIDDEN_FILENAME_CHARS.test(result),
            "sanitized filename has forbidden characters",
          );
          invariant(!/[. ]$/.test(result), "sanitized filename has trailing dots or spaces");
          if (leadingDotsForbidden) {
            invariant(
              !/^[./\\]/.test(result),
              "sanitized filename has a forbidden leading character",
            );
          }
          const base = result.split(".")[0] || result;
          invariant(!RESERVED_DEVICE_NAME_REGEX.test(base), "sanitized filename is a device name");
          invariant(
            sanitizeFilename(result, maxBytes, leadingDotsForbidden, preserveExtension) === result,
            "filename sanitization was not idempotent",
          );
        },
      ),
      parameters,
    ),
};

const safeHttpsArbitrary = fc.webUrl({
  validSchemes: ["https"],
  withQueryParameters: true,
  authoritySettings: { withIPv4: true, withIPv6: true, withPort: true },
});
const endpointArbitrary = fc.oneof(
  safeHttpsArbitrary.map((value) => ({ value, expected: "accept" as const })),
  fc
    .webUrl({ validSchemes: ["http"], withQueryParameters: true })
    .map((value) => ({ value, expected: "reject" as const })),
  safeHttpsArbitrary.map((value) => {
    const url = new URL(value);
    url.username = "user";
    url.password = "secret";
    return { value: url.toString(), expected: "reject" as const };
  }),
  safeHttpsArbitrary.map((value) => {
    const url = new URL(value);
    url.hash = "fragment";
    return { value: url.toString(), expected: "reject" as const };
  }),
  sourceTextArbitrary.map((value) => ({ value, expected: "structural" as const })),
);

const webhookUrlPolicy: FuzzTarget = {
  name: "webhook-url-policy",
  run: (parameters) =>
    fc.check(
      fc.property(endpointArbitrary, ({ value, expected }) => {
        const result = validateWebhookUrl(value);
        if (expected === "accept") invariant(result.ok, "safe HTTPS endpoint was rejected");
        if (expected === "reject") invariant(!result.ok, "unsafe endpoint was accepted");
        if (!result.ok) return;
        const parsed = new URL(result.url);
        invariant(result.url === value.trim(), "accepted endpoint was not trimmed consistently");
        invariant(parsed.protocol === "https:", "accepted endpoint is not HTTPS");
        invariant(!parsed.username && !parsed.password, "accepted endpoint contains credentials");
        invariant(!parsed.hash, "accepted endpoint contains a fragment");
      }),
      parameters,
    ),
};

seedOptions();
options.replacementChar = "_";

const targets: FuzzTarget[] = [
  directoryLossless,
  directoryEdits,
  routingLossless,
  routingSemantic,
  filenameSafety,
  webhookUrlPolicy,
];

test("fuzzes parser, routing, filename, and webhook invariants within the time budget", () => {
  const totalTimeMs = parseInteger("FUZZ_TIME_MS", DEFAULT_FUZZ_TIME_MS);
  invariant(totalTimeMs !== undefined && totalTimeMs > 0, "FUZZ_TIME_MS must be positive");
  const requestedSeed = parseInteger("FUZZ_SEED");
  const requestedPath = process.env.FUZZ_PATH || undefined;
  const requestedProperty = process.env.FUZZ_PROPERTY || undefined;
  invariant(!requestedPath || requestedProperty, "FUZZ_PATH requires FUZZ_PROPERTY");
  invariant(!requestedPath || requestedSeed !== undefined, "FUZZ_PATH requires FUZZ_SEED");

  const selectedTargets = requestedProperty
    ? targets.filter((target) => target.name === requestedProperty)
    : targets;
  invariant(selectedTargets.length > 0, `Unknown FUZZ_PROPERTY: ${requestedProperty}`);

  const timePerTarget = Math.max(1, Math.floor(totalTimeMs / selectedTargets.length));
  const summaries: string[] = [];
  for (const target of selectedTargets) {
    const parameters: FuzzParameters = {
      numRuns: requestedPath ? 1 : MAX_FUZZ_RUNS,
      interruptAfterTimeLimit: timePerTarget,
      markInterruptAsFailure: false,
      ...(requestedSeed === undefined ? {} : { seed: requestedSeed }),
      ...(requestedPath === undefined ? {} : { path: requestedPath }),
    };
    const details = target.run(parameters);
    if (details.failed) {
      const replay = [
        `FUZZ_PROPERTY=${target.name}`,
        `FUZZ_SEED=${details.seed}`,
        ...(details.counterexamplePath ? [`FUZZ_PATH=${details.counterexamplePath}`] : []),
        `FUZZ_TIME_MS=${totalTimeMs}`,
      ].join(" ");
      const cause = details.errorInstance instanceof Error ? details.errorInstance : undefined;
      throw new Error(
        `${target.name} failed after ${details.numRuns} runs and ${details.numShrinks} shrinks.\n` +
          `Counterexample: ${fc.stringify(details.counterexample)}\n` +
          `Replay: node scripts/with-env.js ${replay} -- npm run test:fuzz`,
        { cause },
      );
    }
    summaries.push(`${target.name}=${details.numRuns}`);
  }
  process.stdout.write(`[fuzz] ${totalTimeMs}ms budget; ${summaries.join(", ")}\n`);
});
