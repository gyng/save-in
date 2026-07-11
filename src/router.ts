import { webExtensionApi } from "./web-extension-api.ts";

import { RULE_TYPES } from "./constants.ts";
import type { RuleType } from "./constants.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { currentTab } from "./current-tab.ts";
import type { DownloadInfo } from "./download-types.ts";

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
export type RouterApi = {
  EMPTY_INFO: Partial<DownloadInfo>;
  matcherFunctions: Record<string, MatcherFactory>;
  tokenizeLines: (lines: string, errors?: RuleError[]) => RuleToken[];
  parseRule: (lines: RuleToken[], errors?: RuleError[]) => RoutingRule | false;
  parseRulesCollecting: (raw: string) => { rules: RoutingRule[]; errors: RuleError[] };
  parseRules: (raw: string) => RoutingRule[];
  getCaptureMatches: (
    rule: RoutingRule,
    info: RoutingInfo,
    filename?: string,
  ) => (string | undefined)[] | null;
  matchRule: (rule: RoutingRule, info: RoutingInfo) => string | false;
  matchRules: (rules: RoutingRule[], info: RoutingInfo) => string | null;
};

type InfoStringKey = {
  [Key in keyof RoutingInfo]-?: RoutingInfo[Key] extends string | undefined ? Key : never;
}[keyof RoutingInfo];

// SI_DEBUG match logging, deduped from the ~9 identical blocks it replaced
const logMatch = (match: MatcherResult, regex: RegExp, info: RoutingInfo | undefined): void => {
  if (window.SI_DEBUG && match) {
    console.log("matched", match, regex, info); // eslint-disable-line
  }
};

const RouterFactory = {
  makeInfoMatcherFactory:
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
    },

  makeTabMatcherFactory:
    (propertyName: "title"): MatcherFactory =>
    (regex) =>
    (info) => {
      const value = currentTab?.[propertyName];
      const match = typeof value === "string" ? value.match(regex) : null;

      logMatch(match, regex, info);

      return match;
    },

  // Keeps its own try/catch (rather than withUrl) because the failure
  // branch logs the bad domain, not just returns a fallback
  makeHostnameMatcherFactory:
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
    },
};

export const Router: RouterApi = {
  // Typed default for matchers destructuring their second (state.info) param
  EMPTY_INFO: {} as Partial<DownloadInfo>,

  matcherFunctions: {
    context:
      (regex) =>
      (info, { context } = Router.EMPTY_INFO) => {
        const match = context == null ? null : context.toLowerCase().match(regex);

        logMatch(match, regex, info);

        return match;
      },
    menuindex:
      (regex) =>
      (info, { menuIndex } = Router.EMPTY_INFO) => {
        const match = menuIndex == null ? null : menuIndex.match(regex);

        logMatch(match, regex, info);

        return match;
      },
    comment:
      (regex) =>
      (info, { comment } = Router.EMPTY_INFO) => {
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
    filename:
      (regex) =>
      (info, { filename } = Router.EMPTY_INFO) => {
        const fn = (info && info.filename) || filename;
        if (!fn) return false;

        const match = fn.match(regex);

        logMatch(match, regex, info);

        return match;
      },
    frameurl: RouterFactory.makeInfoMatcherFactory("frameUrl"),
    linktext: RouterFactory.makeInfoMatcherFactory("linkText"),
    mediatype: RouterFactory.makeInfoMatcherFactory("mediaType"),
    naivefilename: (regex) => (info) => {
      const url = info.srcUrl || info.linkUrl || info.pageUrl;
      if (!url) return false;

      const filename = getFilenameFromUrl(url);
      if (!filename) return false;

      const match = filename.match(regex);

      logMatch(match, regex, info);

      return match;
    },
    pagedomain: RouterFactory.makeHostnameMatcherFactory("pageUrl"),
    sourcedomain: RouterFactory.makeHostnameMatcherFactory("srcUrl"),
    pagetitle: RouterFactory.makeTabMatcherFactory("title"),
    pageurl: RouterFactory.makeInfoMatcherFactory("pageUrl"),
    selectiontext: RouterFactory.makeInfoMatcherFactory("selectionText"),
    sourceurl: RouterFactory.makeInfoMatcherFactory("sourceUrl", "srcUrl"),
  },

  tokenizeLines: (lines: string, errors: RuleError[] = []) =>
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
      .filter((toks): toks is RuleToken => Boolean(toks && toks.length >= 3)),

  parseRule: (lines: RuleToken[], errors: RuleError[] = []) => {
    const matchers: (RuleClause | false)[] = lines.map((tokens) => {
      const name = tokens[1];

      let value: string | RegExp;
      try {
        value = name === "into" || name === "capture" ? tokens[2] : new RegExp(tokens[2]);
      } catch (e) {
        errors.push({
          message: webExtensionApi.i18n.getMessage("ruleInvalidRegex"),
          error: `${e}`,
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
        const matcher = Router.matcherFunctions[name.toLowerCase()];

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

    return validMatchers;
  },

  // Pure: parse rules and return both the rules and any errors, without
  // touching window.optionErrors. Used by VALIDATE and by parseRules below.
  parseRulesCollecting: (raw: string) => {
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
      .map((lines) => Router.tokenizeLines(lines, errors))
      .map((tokens) => Router.parseRule(tokens, errors))
      .filter((r): r is RoutingRule => Boolean(r));

    return { rules, errors };
  },

  parseRules: (raw: string) => {
    const { rules, errors } = Router.parseRulesCollecting(raw);

    errors.forEach((error) => {
      window.optionErrors.filenamePatterns.push(error);
    });

    if (window.SI_DEBUG) {
      console.log("parsedRules", rules); // eslint-disable-line
    }

    return rules;
  },

  getCaptureMatches: (rule: RoutingRule, info: RoutingInfo) => {
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
  },

  matchRule: (rule: RoutingRule, info: RoutingInfo) => {
    const matches = rule
      .filter((m) => m.type === RULE_TYPES.MATCHER)
      .map((m) => m.matcher?.(info, info));

    if (matches.some((m) => !m)) {
      return false;
    }

    let destination = rule.find((r) => r.name === "into")!.value as string;

    // Regex capture groups
    const capturedMatches = Router.getCaptureMatches(rule, info);

    if (capturedMatches) {
      for (let i = 0; i < capturedMatches.length; i += 1) {
        // A non-participating optional group is undefined; joining with it
        // would inject the literal text "undefined" into the path
        destination = destination.split(`:$${i}:`).join(capturedMatches[i] ?? "");
      }
    }

    return destination;
  },

  matchRules: (rules: RoutingRule[], info: RoutingInfo) => {
    for (let i = 0; i < rules.length; i += 1) {
      const result = Router.matchRule(rules[i], info);
      if (result) {
        return result;
      }
    }

    return null;
  },
};
