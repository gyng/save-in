import { webExtensionApi } from "../platform/web-extension-api.ts";

import { RULE_TYPES } from "../shared/constants.ts";
import type { RuleType } from "../shared/constants.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { currentTab } from "../platform/current-tab.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { getFilenameDiagnostics, Path } from "./path.ts";

export type RuleError = { message: string; error: string; warning?: boolean };
export type RuleToken = RegExpMatchArray;
export type MatcherResult = RegExpMatchArray | null | false;
export type RoutingInfo = Omit<DownloadInfo, "currentTab"> & {
  currentTab?: unknown;
  srcUrl?: string;
  linkUrl?: string;
  frameUrl?: string;
  mediaType?: string;
};
export type RuleMatcher = (info: RoutingInfo, metadata?: Partial<RoutingInfo>) => MatcherResult;
export type MatcherFactory = (regex: RegExp) => RuleMatcher;
export type RuleClause = {
  name: string;
  value: string | RegExp;
  type: RuleType;
  matcher?: RuleMatcher;
};
export type RoutingRule = RuleClause[];
type InfoStringKey = {
  [Key in keyof RoutingInfo]-?: RoutingInfo[Key] extends string | undefined ? Key : never;
}[keyof RoutingInfo];

// SI_DEBUG match logging, deduped from the ~9 identical blocks it replaced
const logMatch = (match: MatcherResult, regex: RegExp, info: RoutingInfo | undefined): void => {
  if (window.SI_DEBUG && match) {
    console.log("matched", match, regex, info); // eslint-disable-line
  }
};

const makeInfoMatcherFactory =
  (propertyName: InfoStringKey, alternativePropertyName?: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    const value = info[propertyName];
    let match = typeof value === "string" ? value.match(regex) : null;

    // Hack for sourceUrl, srcUrl
    if (!match && alternativePropertyName) {
      const alternativeValue = info[alternativePropertyName];
      match = typeof alternativeValue === "string" ? alternativeValue.match(regex) : null;
    }

    logMatch(match, regex, info);

    return match;
  };

const makeTabMatcherFactory =
  (propertyName: "title"): MatcherFactory =>
  (regex) =>
  (info) => {
    const value = currentTab?.[propertyName];
    const match = typeof value === "string" ? value.match(regex) : null;

    logMatch(match, regex, info);

    return match;
  };

// Keeps its own try/catch (rather than withUrl) because the failure
// branch logs the bad domain, not just returns a fallback
const makeHostnameMatcherFactory =
  (propertyName: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    try {
      const value = info[propertyName];
      const match = new URL(typeof value === "string" ? value : "").hostname.match(regex);
      logMatch(match, regex, info);
      return match;
    } catch (e) {
      if (window.SI_DEBUG) {
        console.log("bad page domain in matcher", info.pageUrl, e); // eslint-disable-line
      }
      return null;
    }
  };

// Typed default for matchers destructuring their second (state.info) param
const EMPTY_INFO: Partial<DownloadInfo> = {};

export const matcherFunctions = {
  context:
    (regex) =>
    (info, { context } = EMPTY_INFO) => {
      const match = context == null ? null : context.toLowerCase().match(regex);

      logMatch(match, regex, info);

      return match;
    },
  menuindex:
    (regex) =>
    (info, { menuIndex } = EMPTY_INFO) => {
      const match = menuIndex == null ? null : menuIndex.match(regex);

      logMatch(match, regex, info);

      return match;
    },
  comment:
    (regex) =>
    (info, { comment } = EMPTY_INFO) => {
      const match = comment == null ? null : comment.match(regex);

      logMatch(match, regex, info);

      return match;
    },
  fileext: (regex) => (info) => {
    const url = info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;

    const extension = url.match(EXTENSION_REGEX);
    if (!extension) return false;

    const match = extension[1].match(regex);

    logMatch(match, regex, info);

    return match;
  },
  urlfileext: (regex) => (info) => {
    const url = info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl || info.url;
    if (!url) return false;
    const match = (getFilenameFromUrl(url).match(EXTENSION_REGEX)?.[1] || "").match(regex);
    logMatch(match, regex, info);
    return match;
  },
  actualfileext: (regex) => (info) => {
    if (!info.filename) return false;
    const match = (info.filename.match(EXTENSION_REGEX)?.[1] || "").match(regex);
    logMatch(match, regex, info);
    return match;
  },
  filename:
    (regex) =>
    (info, { filename } = EMPTY_INFO) => {
      const fn = (info && info.filename) || filename;
      if (!fn) return false;

      const match = fn.match(regex);

      logMatch(match, regex, info);

      return match;
    },
  frameurl: makeInfoMatcherFactory("frameUrl"),
  linktext: makeInfoMatcherFactory("linkText"),
  mediatype: makeInfoMatcherFactory("mediaType"),
  naivefilename: (regex) => (info) => {
    const url = info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;

    const filename = getFilenameFromUrl(url);
    if (!filename) return false;

    const match = filename.match(regex);

    logMatch(match, regex, info);

    return match;
  },
  pagedomain: makeHostnameMatcherFactory("pageUrl"),
  sourcedomain: makeHostnameMatcherFactory("srcUrl"),
  pagetitle: makeTabMatcherFactory("title"),
  pageurl: makeInfoMatcherFactory("pageUrl"),
  selectiontext: makeInfoMatcherFactory("selectionText"),
  sourceurl: makeInfoMatcherFactory("sourceUrl", "srcUrl"),
} satisfies Record<string, MatcherFactory>;

export const tokenizeLines = (lines: string, errors: RuleError[] = []): RuleToken[] =>
  lines
    .split("\n")
    .map((l) => ({ l, matches: l.match(/^(\S*): ?(.*)/) }))
    .map((toks) => {
      if (!toks.matches || toks.matches.length < 3) {
        errors.push({
          message: webExtensionApi.i18n.getMessage("ruleBadClause"),
          error: `${toks.l || "invalid line syntax"}`,
        });
        return null;
      }

      return toks.matches;
    })
    .filter((toks): toks is RuleToken => Boolean(toks && toks.length >= 3));

export const parseRule = (lines: RuleToken[], errors: RuleError[] = []): RoutingRule | false => {
  const matchers: (RuleClause | false)[] = lines.map((tokens) => {
    const rawName = tokens[1];
    const flagSeparator = rawName.lastIndexOf("/");
    const name = flagSeparator > 0 ? rawName.slice(0, flagSeparator) : rawName;
    const flags = flagSeparator > 0 ? rawName.slice(flagSeparator + 1) : "";

    let value: string | RegExp;
    try {
      value = name === "into" || name === "capture" ? tokens[2] : new RegExp(tokens[2], flags);
    } catch (e) {
      errors.push({
        message: webExtensionApi.i18n.getMessage("ruleInvalidRegex"),
        error: flags ? `invalid regex flags: ${flags} (${e})` : `${e}`,
      });
      // An invalid regex left `value` undefined, which would compile to a
      // match-everything matcher (`str.match(undefined)` matches ""). Drop
      // the whole rule instead of routing every download by it.
      return false;
    }

    let type: RuleType = RULE_TYPES.MATCHER;

    // Special matchers
    if (name === "into") {
      type = RULE_TYPES.DESTINATION;
      value = (value as string).replace(/^\.\//, "");
    } else if (name === "capture") {
      type = RULE_TYPES.CAPTURE;
    }

    if (type === RULE_TYPES.MATCHER) {
      const matcherName = name.toLowerCase();
      const matcher = Object.hasOwn(matcherFunctions, matcherName)
        ? matcherFunctions[matcherName as keyof typeof matcherFunctions]
        : undefined;

      if (!matcher) {
        errors.push({
          message: webExtensionApi.i18n.getMessage("ruleUnknownMatcher"),
          error: `${name}:`,
        });

        return false;
      }

      return {
        name,
        value,
        type,
        matcher: matcher(value as RegExp),
      };
    } else {
      return {
        name,
        value,
        type,
      };
    }
  });

  // Any matcher line that failed to parse (invalid regex, unknown matcher)
  // invalidates the whole rule rather than leaving it partially built
  if (matchers.some((m) => m === false)) {
    return false;
  }

  const validMatchers = matchers as RuleClause[];

  if (!validMatchers.some((m) => m.type === RULE_TYPES.DESTINATION)) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleMissingInto"),
      error: "",
    });

    return false;
  }

  const destination = validMatchers.find((m) => m.type === RULE_TYPES.DESTINATION)!;
  if (!(destination.value as string).trim()) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleMissingInto"),
      error: destination.value as string,
    });
    return false;
  }
  if (
    (destination.value as string).match(/:\$\d+:/) &&
    !validMatchers.find((m) => m.name === "capture")
  ) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleMissingCapture"),
      error: destination.value as string,
      warning: true,
    });
  }

  if (!validMatchers.some((m) => m.type === RULE_TYPES.MATCHER)) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleMissingMatcher"),
      error: JSON.stringify(lines.map((l) => l[0])),
    });

    return false;
  }

  const intoMatcher = validMatchers.filter((m) => m.name === "into");
  if (intoMatcher.length >= 2) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleExtraInto"),
      error: JSON.stringify(lines.map((l) => l[0])),
    });

    return false;
  }

  if (validMatchers.filter((m) => m.name === "capture").length >= 2) {
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleMultipleCapture"),
      error: JSON.stringify(lines.map((l) => l[0])),
    });

    return false;
  }

  const captures = validMatchers.filter((m) => m.name === "capture");
  if (captures.length === 1 && (captures[0].value as string).split(",").length > 1) {
    // Get all captures
    const captureMatchers = (captures[0].value as string).split(",").map((m) => m.trim());
    let failed = false;

    for (let i = 0; i < captureMatchers.length; i += 1) {
      if (validMatchers.filter((m) => m.name === captureMatchers[i]).length < 1) {
        errors.push({
          message: webExtensionApi.i18n.getMessage("ruleCaptureMissingMatcher"),
          error: `capture: ${captureMatchers[i]}`,
        });

        // Don't bail out: iterate through every matcher for errors
        failed = true;
      }
    }

    if (failed) {
      return false;
    }
  } else if (
    captures.length === 1 &&
    validMatchers.filter((m) => m.name === captures[0].value).length < 1
  ) {
    // Capture clause pointing at missing matcher
    errors.push({
      message: webExtensionApi.i18n.getMessage("ruleCaptureMissingMatcher"),
      error: `capture: ${captures[0].value}`,
    });

    return false;
  }

  if (captures.length === 1) {
    const captureNames = (captures[0].value as string).split(",").map((name) => name.trim());
    let availableIndexes = 0;
    for (const captureName of captureNames) {
      const clause = validMatchers.find(
        (item) => item.type === RULE_TYPES.MATCHER && item.name === captureName,
      );
      const source = (clause?.value as RegExp | undefined)?.source || "";
      let groups = 0;
      let inClass = false;
      for (let i = 0; i < source.length; i += 1) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (!inClass && source[i] === "(" && source[i + 1] !== "?") groups += 1;
        else if (!inClass && source.slice(i, i + 3) === "(?<" && !/[=!]/.test(source[i + 3] || ""))
          groups += 1;
      }
      availableIndexes += groups + 1;
    }
    const indexes = [...(destination.value as string).matchAll(/:\$(\d+):/g)].map((m) =>
      Number(m[1]),
    );
    if (indexes.some((index) => index >= availableIndexes)) {
      errors.push({
        message: webExtensionApi.i18n.getMessage("ruleMissingCapture"),
        error: destination.value as string,
      });
      return false;
    }
  }

  return validMatchers;
};

// Pure: parse rules and return both the rules and any errors, without
// touching window.optionErrors. Used by VALIDATE and by parseRules below.
export const parseRulesCollecting = (
  raw: string,
): { rules: RoutingRule[]; errors: RuleError[] } => {
  const withoutComments = raw
    .split("\n")
    .filter((l) => !l.startsWith("//"))
    .join("\n")
    .trim();

  if (!withoutComments) {
    return { rules: [], errors: [] };
  }

  // tokenizeLines/parseRule are pure: they report problems into the collector
  const errors: RuleError[] = [];
  const rules = withoutComments
    .replace(new RegExp("\\n\\n+", "g"), "\n\n")
    .split("\n\n")
    .map((lines) => tokenizeLines(lines, errors))
    .map((tokens) => parseRule(tokens, errors))
    .filter((r): r is RoutingRule => Boolean(r));

  for (let index = 1; index < rules.length; index += 1) {
    const shadowed = rules.slice(0, index).some((earlier) => {
      const earlierMatchers = earlier.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      const laterMatchers = rules[index].filter((clause) => clause.type === RULE_TYPES.MATCHER);
      return earlierMatchers.every((earlierClause) =>
        laterMatchers.some((laterClause) => {
          if (laterClause.name !== earlierClause.name) return false;
          const earlierRegex = earlierClause.value as RegExp;
          const laterRegex = laterClause.value as RegExp;
          return (
            (/^(?:\.\*|\^\.\*\$)$/.test(earlierRegex.source) && !earlierRegex.flags) ||
            (earlierRegex.source === laterRegex.source && earlierRegex.flags === laterRegex.flags)
          );
        }),
      );
    });
    if (shadowed) {
      errors.push({
        message: webExtensionApi.i18n.getMessage("ruleShadowed"),
        error: `rule ${index + 1}`,
        warning: true,
      });
    }
  }

  return { rules, errors };
};

export const parseRules = (raw: string): RoutingRule[] => {
  const { rules, errors } = parseRulesCollecting(raw);

  errors.forEach((error) => {
    window.optionErrors.filenamePatterns.push(error);
  });

  if (window.SI_DEBUG) {
    console.log("parsedRules", rules); // eslint-disable-line
  }

  return rules;
};

export const getCaptureMatches = (
  rule: RoutingRule,
  info: RoutingInfo,
): (string | undefined)[] | null => {
  const captureDeclaration = rule.find(
    (d) => d.type === RULE_TYPES.CAPTURE && d.name === "capture",
  );

  const capturedAll: RegExpMatchArray[] = [];
  if (captureDeclaration) {
    const capturedMatcherNames = (captureDeclaration.value as string)
      .split(",")
      .map((m) => m.trim());
    for (let i = 0; i < capturedMatcherNames.length; i += 1) {
      const captured = rule.find(
        (m) => m.type === RULE_TYPES.MATCHER && m.name === capturedMatcherNames[i],
      );
      const result = captured?.matcher?.(info);
      if (result) {
        capturedAll.push(result);
      }
    }

    if (capturedAll.length !== capturedMatcherNames.length) {
      return null;
    }

    return capturedAll.flat();
  } else {
    return null;
  }
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false => {
  const matches = rule
    .filter((m) => m.type === RULE_TYPES.MATCHER)
    .map((m) => m.matcher?.(info, info));

  if (matches.some((m) => !m)) {
    return false;
  }

  let destination = rule.find((r) => r.name === "into")!.value as string;

  // Regex capture groups
  const capturedMatches = getCaptureMatches(rule, info);

  if (capturedMatches) {
    for (let i = 0; i < capturedMatches.length; i += 1) {
      // A non-participating optional group is undefined; joining with it
      // would inject the literal text "undefined" into the path
      destination = destination.split(`:$${i}:`).join(capturedMatches[i] ?? "");
    }
  }

  return destination;
};

export const matchRules = (rules: RoutingRule[], info: RoutingInfo): string | null => {
  for (let i = 0; i < rules.length; i += 1) {
    const result = matchRule(rules[i], info);
    if (result) {
      return result;
    }
  }

  return null;
};

export type RuleTrace = {
  initialFilename?: string;
  actualFilename?: string;
  selectedRule: number | null;
  destination: string | null;
  expandedDestination: string | null;
  sanitizedDestination: string | null;
  finalPath: string | null;
  filenameDiagnostics: ReturnType<typeof getFilenameDiagnostics> | null;
  rules: Array<{
    index: number;
    matched: boolean;
    destination: string;
    clauses: Array<{ name: string; pattern: string; matched: boolean }>;
  }>;
};

export const traceRules = (rules: RoutingRule[], info: RoutingInfo): RuleTrace => {
  const traced = rules.map((rule, index) => {
    const clauses = rule
      .filter((clause) => clause.type === RULE_TYPES.MATCHER)
      .map((clause) => ({
        name: clause.name,
        pattern: String(clause.value),
        matched: Boolean(clause.matcher?.(info, info)),
      }));
    const matched = clauses.every((clause) => clause.matched);
    const ruleDestination = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION)!
      .value as string;
    return { index: index + 1, matched, destination: ruleDestination, clauses };
  });
  const selectedIndex = traced.findIndex((rule) => rule.matched);
  const selectedRule = selectedIndex >= 0 ? selectedIndex + 1 : null;
  const destination = selectedIndex >= 0 ? matchRule(rules[selectedIndex], info) || null : null;
  const actualFilename = info.filename || "";
  const naiveFilename = getFilenameFromUrl(info.url || info.srcUrl || info.linkUrl || "");
  const expandedDestination = destination
    ?.replaceAll(":filename:", actualFilename)
    .replaceAll(":fileext:", actualFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":actualfileext:", actualFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":naivefilename:", naiveFilename)
    .replaceAll(":naivefileext:", naiveFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":urlfileext:", naiveFilename.match(EXTENSION_REGEX)?.[1] || "");
  const sanitizedDestination = expandedDestination
    ? new Path(expandedDestination).finalize()
    : null;
  return {
    initialFilename: info.initialFilename,
    actualFilename: info.filename,
    selectedRule,
    destination,
    expandedDestination: expandedDestination || null,
    sanitizedDestination,
    finalPath: sanitizedDestination,
    filenameDiagnostics: actualFilename ? getFilenameDiagnostics(actualFilename) : null,
    rules: traced,
  };
};
