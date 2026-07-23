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
      "Metadata keys: alias, key, dialog, disabled, and the post-save tab action after: close-tab or after: return-tab (the legacy tab: close and tab: return spellings stay accepted).",
    ],
    examples: ["Images\n>Work // (alias: Projects) (after: close-tab)"],
  },
  {
    id: "routing",
    option: "filenamePatterns",
    ebnf: ROUTING_RULE_GRAMMAR,
    semantics: [
      "Blank lines separate rules. A rule is inert if any line or clause is invalid; disabled rules are still validated but do not run.",
      "Each rule needs one or more matcher clauses and either exactly one non-empty into: destination or exclude: true; all matchers must match.",
      "Rules are tried in source order; the first eligible rule whose matchers all succeed wins.",
      "Matcher values are regular expressions except css:, whose value is a CSS selector. Regular-expression flags are accepted only on regex matchers and rename:.",
      "Empty regex matchers are explicit match-all conditions. Leading and trailing regex whitespace is significant and produces a warning.",
      "A rule may contain at most one capture or capturegroups clause, one fetch:, one rename:, one after:, one exclude:, and one disabled: control.",
      "capturegroups: numbers groups continuously across its named matchers; capture: preserves the legacy flattened indexing layout.",
      "into: destinations are relative and cannot contain .. path components, including after capture expansion; they may use registered variables and valid capture references.",
      "An into: destination ending in / preserves the resolved filename inside that folder; without a trailing slash it replaces the whole filename.",
      "fetch: requires a usable literal http(s) prefix. If its expanded URL is unusable, the selected download plan fails instead of saving the original URL under the rewritten route.",
      "exclude: true replaces into: and is terminal: a matching exclusion prevents the save and consumes the match before later rules.",
      "after: close-tab closes the source tab only after a Save In download starts. Automatic rules cannot carry this action.",
      "CSS routing is bounded to 64 css: matchers per rule and 256 across the configuration.",
      "Automatic source rules use context: ^auto$ and require page and source constraints.",
    ],
    examples: [
      "fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:",
      "context: ^auto$\npagedomain: ^example\\.com$\nsourcekind: ^image$\ninto: Images/:filename:",
      "context: ^auto$\npagedomain: ^example\\.com$\ncss: article img\ninto: Articles/:filename:",
      "sourceurl: /tracking\\.gif$\nexclude: true",
      "pageurl: ^https://example\\.com/\nafter: close-tab\ninto: Articles/:filename:",
    ],
  },
] as const;
