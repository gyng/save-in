import { DIRECTORY_LINE_GRAMMAR } from "../config/path-syntax.ts";
import { ROUTING_RULE_GRAMMAR } from "../routing/rule-syntax.ts";

export type IntegrationGrammar = {
  id: "directories" | "routing";
  option: "paths" | "filenamePatterns";
  ebnf: string;
  semantics: string[];
  examples: string[];
};

export const INTEGRATION_GRAMMARS: readonly IntegrationGrammar[] = [
  {
    id: "directories",
    option: "paths",
    ebnf: DIRECTORY_LINE_GRAMMAR,
    semantics: [
      "Each non-empty line is a menu item; leading > characters set its nesting depth.",
      "A path may contain registered :variables: and optional comment metadata.",
    ],
    examples: ["Images\n>Work // (icon: briefcase)"],
  },
  {
    id: "routing",
    option: "filenamePatterns",
    ebnf: ROUTING_RULE_GRAMMAR,
    semantics: [
      "Blank lines separate rules; matcher clauses in one rule must all match.",
      "Matcher values are regular expressions except css:, whose value is a CSS selector without regex flags.",
      "CSS routing is bounded to 64 css: matchers per rule and 256 across the configuration.",
      "A rule may contain capture clauses and ends with an into destination.",
      "Automatic source rules use context: ^auto$ and require page and source constraints.",
    ],
    examples: [
      "fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:",
      "context: ^auto$\npagedomain: ^example\\.com$\nsourcekind: ^image$\ninto: Images",
      "context: ^auto$\npagedomain: ^example\\.com$\ncss: article img\ninto: Articles",
    ],
  },
] as const;
