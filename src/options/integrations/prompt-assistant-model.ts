import type { WireIntegrationGrammar } from "../../shared/message-protocol.ts";

const MAX_USER_REQUEST_CHARACTERS = 4_000;

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
  return [
    "Create one Save In filename-routing rule for the user's request.",
    "Return exactly one rule as plain text. Do not use Markdown, code fences, or explanations.",
    "Use only the grammar and semantics below. Preserve regular-expression backslashes.",
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
    "Examples:",
    ...grammar.examples,
    "",
    "User request:",
    boundedRequest,
  ].join("\n");
};

export const cleanRuleSuggestion = (output: string): string | null => {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:[A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n```/);
  const result = (fenced?.[1] ?? trimmed).trim();
  return result || null;
};
