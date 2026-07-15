import { RULE_TYPES } from "../shared/constants.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import type { RoutingRule } from "../routing/rule-types.ts";

const MAX_RULE_CHARACTERS = 32_768;
const MAX_PATH_CHARACTERS = 32_768;
const MAX_SAMPLE_FIELD_CHARACTERS = 4_096;
const MAX_URL_CHARACTERS = 8_192;
const MAX_FILENAME_CHARACTERS = 1_024;
const MAX_TOTAL_CHARACTERS = 65_536;
const MAX_REGEX_CHARACTERS = 1_024;

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

const repeatingQuantifierAt = (source: string, index: number): boolean => {
  const token = source[index];
  if (token === "*" || token === "+") return true;
  if (token !== "{") return false;
  const end = source.indexOf("}", index + 1);
  if (end < 0) return false;
  const bounds = source.slice(index + 1, end).split(",");
  if (bounds.length === 1) return Number(bounds[0]) > 1;
  const maximum = bounds[1];
  return maximum === "" || Number(maximum) > 1;
};

export const isSafeExternalRegex = (regex: RegExp): boolean => {
  const { source } = regex;
  if (source.length > MAX_REGEX_CHARACTERS) return false;

  const groups: Array<{ hasAlternation: boolean; hasQuantifier: boolean }> = [
    { hasAlternation: false, hasQuantifier: false },
  ];
  let inCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const token = source[index];
    /* v8 ignore next -- The loop bound guarantees a character at this index. */
    if (token === undefined) return false;
    if (token === "\\") {
      const escaped = source[index + 1];
      if (
        !inCharacterClass &&
        escaped &&
        (/[1-9]/.test(escaped) || (escaped === "k" && source[index + 2] === "<"))
      ) {
        return false;
      }
      index += 1;
      continue;
    }
    if (token === "[") {
      inCharacterClass = true;
      continue;
    }
    if (token === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;

    if (token === "(") {
      groups.push({ hasAlternation: false, hasQuantifier: false });
      continue;
    }
    if (token === ")" && groups.length > 1) {
      const group = groups.pop();
      /* v8 ignore next -- The guarded stack depth guarantees a group to pop. */
      if (!group) return false;
      const repeated = repeatingQuantifierAt(source, index + 1);
      if (repeated && (group.hasAlternation || group.hasQuantifier)) return false;
      const parent = groups.at(-1);
      /* v8 ignore next -- The root group is never popped. */
      if (!parent) return false;
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifier ||= group.hasQuantifier || repeated;
      continue;
    }
    const current = groups.at(-1);
    /* v8 ignore next -- The root group keeps the stack non-empty. */
    if (!current) return false;
    if (token === "|") current.hasAlternation = true;
    if (
      token === "*" ||
      token === "+" ||
      (token === "?" && source[index - 1] !== "(") ||
      token === "{"
    ) {
      current.hasQuantifier = true;
    }
  }
  return true;
};

export const hasUnsafeExternalRegex = (rules: RoutingRule[]): boolean =>
  rules.some((rule) =>
    rule.some((clause) => clause.type === RULE_TYPES.MATCHER && !isSafeExternalRegex(clause.value)),
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
