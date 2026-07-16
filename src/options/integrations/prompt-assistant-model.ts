import type { WireIntegrationGrammar } from "../../shared/message-protocol.ts";

const MAX_USER_REQUEST_CHARACTERS = 4_000;

export type RuleAuthoringVocabulary = {
  matchers: string[];
  variables: string[];
};

const COMMON_FILE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "csv",
  "doc",
  "docx",
  "gif",
  "html",
  "jpeg",
  "jpg",
  "json",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "odt",
  "pdf",
  "png",
  "svg",
  "tar",
  "txt",
  "wav",
  "webm",
  "webp",
  "xls",
  "xlsx",
  "xml",
  "zip",
]);

const unique = (values: string[]): string[] => [...new Set(values)];

const explicitExtensions = (request: string): string[] => {
  const extensions = [...request.matchAll(/(?:^|\s)\.([a-z0-9][a-z0-9+_-]{0,9})\b/gi)]
    .map((match) => match[1]?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const target = request.match(
    /\b(?:save|route|move|put|send|download)\s+(.{1,100}?)\s+(?:into|in|to|under)\b/i,
  )?.[1];
  if (target) {
    target
      .toLowerCase()
      .split(/[^a-z0-9+_-]+/)
      .map((token) => (token.endsWith("s") ? token.slice(0, -1) : token))
      .filter((token) => COMMON_FILE_EXTENSIONS.has(token))
      .forEach((token) => extensions.push(token));
  }
  return unique(extensions);
};

const fileExtensionMatcher = (
  rule: string,
): { expression: string; insensitive: boolean } | null => {
  for (const line of rule.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const match = line.match(/^\s*fileext(?:\/([a-z]+))?:\s*(.*?)\s*$/i);
    if (match?.[2] !== undefined) {
      return { expression: match[2], insensitive: match[1]?.includes("i") ?? false };
    }
  }
  return null;
};

const trimPoliteness = (value: string): string =>
  value
    .replace(/\s+(?:please|thanks|thank you)\s*$/i, "")
    .trim()
    .replace(/\/+$/, "");

const explicitFolder = (request: string): string | null => {
  const slashFolder = request.match(
    /\b(?:into|in|to|under)\s+(?:the\s+)?(?:folder\s+)?\/(?!\/)([^\n,;.!?]+)/i,
  )?.[1];
  if (slashFolder) return trimPoliteness(slashFolder) || null;
  const quotedFolder = request.match(
    /\b(?:into|in|to|under)\s+(?:the\s+)?(?:folder\s+)?["'`]([^"'`]+)["'`]/i,
  )?.[1];
  return quotedFolder ? trimPoliteness(quotedFolder).replace(/^\/+/, "") || null : null;
};

const destination = (rule: string): string | null => {
  for (const line of rule.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const match = line.match(/^\s*into:\s*(.*?)\s*$/i);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
};

const asksForRename = (request: string): boolean =>
  /\b(?:called|filename|name (?:it|them)|rename|renamed)\b/i.test(request);

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const safeLiteralFolder = (folder: string): boolean =>
  folder.length <= 240 &&
  !folder.split("/").some((component) => component === "..") &&
  !/[\\:\u0000-\u001f]/.test(folder);

export const applyRuleRequestGuardrails = (request: string, rule: string): string => {
  let lines = rule.split(/\r\n|[\n\r\u2028\u2029]/);
  const extensions = explicitExtensions(request);
  if (extensions.length > 0) {
    const expression =
      extensions.length === 1
        ? `^${escapeRegularExpression(extensions[0] ?? "")}$`
        : `^(?:${extensions.map(escapeRegularExpression).join("|")})$`;
    const replacement = `fileext/i: ${expression}`;
    const firstMatcher = lines.findIndex((line) => /^\s*fileext(?:\/[^:]*)?:/i.test(line));
    lines = lines.filter(
      (line, index) => index === firstMatcher || !/^\s*fileext(?:\/[^:]*)?:/i.test(line),
    );
    if (firstMatcher >= 0) lines[firstMatcher] = replacement;
    else lines.unshift(replacement);
  }

  const folder = explicitFolder(request);
  if (folder && !asksForRename(request) && safeLiteralFolder(folder)) {
    const replacement = `into: ${folder}/:filename:`;
    const firstDestination = lines.findIndex((line) => /^\s*into:/i.test(line));
    lines = lines.filter(
      (line, index) => index === firstDestination || !/^\s*into:/i.test(line),
    );
    if (firstDestination >= 0) lines[firstDestination] = replacement;
    else lines.push(replacement);
  }
  return lines.join("\n").trim();
};

export const ruleRequestGuardrailIssues = (request: string, rule: string): string[] => {
  const issues: string[] = [];
  const extensions = explicitExtensions(request);
  if (extensions.length > 0) {
    const matcher = fileExtensionMatcher(rule);
    if (!matcher) {
      issues.push(
        `The request names ${extensions.join(", ")} file types, but the rule has no fileext matcher.`,
      );
    } else {
      try {
        const expression = new RegExp(matcher.expression, matcher.insensitive ? "i" : "");
        for (const extension of extensions) {
          if (!expression.test(extension)) {
            issues.push(`The fileext matcher does not match the requested ${extension} type.`);
          }
        }
        const unexpected = [...COMMON_FILE_EXTENSIONS].filter(
          (extension) => !extensions.includes(extension) && expression.test(extension),
        );
        if (unexpected.length > 0) {
          issues.push(
            `The fileext matcher also matches unrequested file types (${unexpected.slice(0, 4).join(", ")}).`,
          );
        }
      } catch {
        // The grammar validator reports malformed regular expressions with a source location.
      }
    }
  }
  const folder = explicitFolder(request);
  if (folder) {
    const ruleDestination = destination(rule);
    if (!ruleDestination || !ruleDestination.startsWith(`${folder}/`)) {
      issues.push(`The destination must use the requested ${folder}/ folder.`);
    } else if (
      !asksForRename(request) &&
      ruleDestination !== `${folder}/` &&
      !ruleDestination.endsWith("/:filename:")
    ) {
      issues.push("Saving into a folder must preserve the original filename.");
    }
  }
  return issues;
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
    "Treat image, photo, audio, video, and document as media categories, not filename extensions.",
    "Infer a file extension only from an explicit extension such as .png or a named format such as PNG.",
    "A requested /Folder is extension-relative: write Folder/ and omit trailing politeness such as please.",
    "Saving into a folder preserves the resolved filename unless the user explicitly requests a rename.",
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
