import { RULE_TYPES } from "../shared/constants.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import type { RoutingRule } from "../routing/rule-types.ts";
import { isSafeRoutingRegex } from "../routing/regex-safety.ts";

const MAX_RULE_CHARACTERS = 32_768;
const MAX_PATH_CHARACTERS = 32_768;
const MAX_SAMPLE_FIELD_CHARACTERS = 4_096;
const MAX_URL_CHARACTERS = 8_192;
const MAX_FILENAME_CHARACTERS = 1_024;
const MAX_TOTAL_CHARACTERS = 65_536;

type ExternalValidationBody = {
  paths?: string | undefined;
  filenamePatterns?: string | undefined;
  info?: unknown;
  automaticCandidate?: unknown;
};

const stringCharacterCount = (value: unknown): number => {
  const pending = [value];
  const seen = new WeakSet<object>();
  let total = 0;
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      total += current.length;
      continue;
    }
    if (current == null || typeof current !== "object") continue;
    if (seen.has(current)) return Number.POSITIVE_INFINITY;
    seen.add(current);
    visited += 1;
    if (visited > 4_096) return Number.POSITIVE_INFINITY;
    if (Array.isArray(current)) {
      if (current.length > 1_024) return Number.POSITIVE_INFINITY;
      pending.push(...current);
      continue;
    }
    const entries = Object.entries(current);
    if (entries.length > 1_024) return Number.POSITIVE_INFINITY;
    for (const [key, item] of entries) {
      total += key.length;
      pending.push(item);
    }
  }
  return total;
};

export const externalValidationRequestError = (
  body: ExternalValidationBody | undefined,
): string | null => {
  if (!body) return null;
  if (typeof body.paths === "string" && body.paths.length > MAX_PATH_CHARACTERS) {
    return "Validation paths are too large";
  }
  if (
    typeof body.filenamePatterns === "string" &&
    body.filenamePatterns.length > MAX_RULE_CHARACTERS
  ) {
    return "Validation rules are too large";
  }
  if (
    isStringKeyedRecord(body.info) &&
    Object.values(body.info).some((value) => {
      if (typeof value === "string") return value.length > MAX_SAMPLE_FIELD_CHARACTERS;
      if (Array.isArray(value)) {
        return (
          value.length > 32 ||
          value.some(
            (item) => typeof item === "string" && item.length > MAX_SAMPLE_FIELD_CHARACTERS,
          )
        );
      }
      return (
        isStringKeyedRecord(value) &&
        Object.values(value).some(
          (item) => typeof item === "string" && item.length > MAX_SAMPLE_FIELD_CHARACTERS,
        )
      );
    })
  ) {
    return "Validation sample fields are too large";
  }
  if (isStringKeyedRecord(body.automaticCandidate)) {
    const { pageUrl, sourceUrl, suggestedFilename } = body.automaticCandidate;
    if (
      (typeof pageUrl === "string" && pageUrl.length > MAX_URL_CHARACTERS) ||
      (typeof sourceUrl === "string" && sourceUrl.length > MAX_URL_CHARACTERS) ||
      (typeof suggestedFilename === "string" && suggestedFilename.length > MAX_FILENAME_CHARACTERS)
    ) {
      return "Automatic validation fields are too large";
    }
  }
  return stringCharacterCount(body) > MAX_TOTAL_CHARACTERS
    ? "Validation request is too large"
    : null;
};

export const isSafeExternalRegex = isSafeRoutingRegex;

// An untrusted external VALIDATE compiles and executes two classes of
// attacker-supplied regex: matcher clause patterns, and the rename: clause's
// `find` pattern (applyRenameTransform runs it against an attacker-controlled
// filename during traceRules). Both must pass the ReDoS gate. Capture clauses
// store a plain string and fetch templates expand through a fixed variable
// pattern, so neither compiles an attacker regex.
export const hasUnsafeExternalRegex = (rules: RoutingRule[]): boolean =>
  rules.some((rule) =>
    rule.some((clause) => {
      if (clause.type === RULE_TYPES.MATCHER) return !isSafeRoutingRegex(clause.value);
      if (clause.type === RULE_TYPES.RENAME) return !isSafeRoutingRegex(clause.find);
      return false;
    }),
  );

export const createExternalValidationRateLimiter = ({
  maxRequests = 20,
  windowMs = 10_000,
}: {
  maxRequests?: number;
  windowMs?: number;
} = {}) => {
  const requests = new Map<string, number[]>();
  const allow = (senderId: string, now = Date.now()): boolean => {
    const cutoff = now - windowMs;
    const recent = (requests.get(senderId) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= maxRequests) {
      requests.set(senderId, recent);
      return false;
    }
    recent.push(now);
    requests.set(senderId, recent);
    return true;
  };
  allow.reset = (): void => requests.clear();
  return allow;
};
