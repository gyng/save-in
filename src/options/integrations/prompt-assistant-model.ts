import type { WireIntegrationGrammar } from "../../shared/message-protocol.ts";
import { parseRulesCollecting } from "../../routing/rule-parser.ts";

const MAX_USER_REQUEST_CHARACTERS = 4_000;
const COMMON_FILE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "pdf",
  "mp3",
  "ogg",
  "wav",
  "mp4",
  "webm",
  "zip",
] as const;

export type RuleAuthoringVocabulary = {
  matchers: string[];
  variables: string[];
};

export const buildRuleAuthoringPrompt = (
  request: string,
  grammar: WireIntegrationGrammar,
  vocabulary: RuleAuthoringVocabulary,
): string => {
  const boundedRequest = [...request.trim()].slice(0, MAX_USER_REQUEST_CHARACTERS).join("");
  const extensions = [...requestedExtensions(boundedRequest)];
  const destination = explicitSlashDestination(boundedRequest);
  return [
    "Create one Save In filename-routing rule for the user's request.",
    "Return exactly one rule as plain text. Do not use Markdown, code fences, or explanations.",
    "Use only the grammar and semantics below. Preserve regular-expression backslashes.",
    "Treat grammar examples as syntax demonstrations only. Never copy their file types, sites, or destinations unless the user requested those exact values.",
    "Preserve every explicit constraint in the request. Do not add file types, sites, matchers, or folders that the user did not request.",
    "A folder beginning with / is user shorthand for a Downloads-relative folder: remove only the leading slash in into: because absolute destinations are invalid.",
    "Before responding, check that each explicit file type and destination in the rule exactly matches the request.",
    "The result will be validated and shown as a draft; never claim that it has been applied.",
    "",
    "Grammar:",
    grammar.ebnf,
    "",
    "Semantics:",
    ...grammar.semantics.map((line) => `- ${line}`),
    "",
    `Valid matcher clause names: ${vocabulary.matchers.join(", ")}`,
    "Destination clause name: into",
    `Valid destination variables: ${vocabulary.variables.map((name) => `:${name}:`).join(", ")}`,
    "",
    "Grammar examples (syntax only):",
    ...grammar.examples,
    "",
    "User request:",
    boundedRequest,
    "",
    "Exact constraints extracted from the user request (these override every example):",
    ...(extensions.length
      ? [`- fileext must match only: ${extensions.join(", ")}`]
      : ["- no explicit file extension constraint was detected"]),
    ...(destination
      ? [
          `- into destination folder must be exactly: ${destination}`,
          `- output into: ${destination}/ or into: ${destination}/:filename: so the original filename is preserved; bare into: ${destination} would rename the file and is wrong`,
          `- do not output Downloads, Images, a leading slash, or any other folder in place of ${destination}`,
        ]
      : ["- no slash-prefixed destination folder was detected"]),
  ].join("\n");
};

const requestedExtensions = (request: string): Set<string> => {
  const words = new Set(request.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const requested = new Set<string>();
  for (const extension of COMMON_FILE_EXTENSIONS) {
    if (words.has(extension)) requested.add(extension);
  }
  if (requested.has("jpg")) requested.add("jpeg");
  if (requested.has("jpeg")) requested.add("jpg");
  return requested;
};

const explicitSlashDestination = (request: string): string | null => {
  const match = request.match(/\b(?:into|in|to)\s+(?:the\s+)?(?:folder\s+)?["'`]?\/([^\s"'`,;]+)/i);
  return match?.[1]?.replace(/\/+$/, "") || null;
};

const suggestedDestination = (
  suggestion: string,
): { folder: string; preservesFilename: boolean } | null => {
  const line = suggestion.match(/^into:\s*(.+)$/im)?.[1]?.trim();
  if (!line) return null;
  const preservesFilename = line.endsWith("/") || /\/?:(?:naive)?filename:\s*$/i.test(line);
  return {
    folder: line.replace(/\/?:(?:naive)?filename:\s*$/i, "").replace(/\/+$/, ""),
    preservesFilename,
  };
};

export const ruleSuggestionFidelityError = (request: string, suggestion: string): string | null => {
  const extensions = requestedExtensions(request);
  if (extensions.size) {
    const clause = suggestion.match(/^fileext(?:\/([a-z]*))?:\s*(.*)$/im);
    let matcher: RegExp | null = null;
    try {
      matcher = clause?.[2] ? new RegExp(clause[2], clause[1] ?? "") : null;
    } catch {
      // Syntax validation reports the malformed expression separately.
    }
    if (matcher) {
      const omitted = [...extensions].find((extension) => !matcher.test(extension));
      const added = COMMON_FILE_EXTENSIONS.find(
        (extension) => !extensions.has(extension) && matcher.test(extension),
      );
      if (omitted || added) return "The generated file types do not exactly match the request";
    } else {
      return "The generated rule does not include the requested file type";
    }
  }

  const requestedDestination = explicitSlashDestination(request);
  if (requestedDestination) {
    const destination = suggestedDestination(suggestion);
    if (destination?.folder !== requestedDestination) {
      return `The generated destination does not match /${requestedDestination}`;
    }
    if (!destination.preservesFilename) {
      return `The generated destination would rename the file instead of saving it in /${requestedDestination}`;
    }
  }
  return null;
};

export const cleanRuleSuggestion = (output: string): string | null => {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:[A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n```/);
  const result = (fenced?.[1] ?? trimmed).trim();
  return result || null;
};

export const isSingleRuleSuggestion = (source: string): boolean =>
  parseRulesCollecting(source).rules.length === 1;
