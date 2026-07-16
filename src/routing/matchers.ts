import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { routingPorts } from "./ports.ts";
import { normalizeMimeType, toRootDomain } from "./variable.ts";
import type {
  MatcherAttempt,
  MatcherEvaluation,
  MatcherFactory,
  MatcherResult,
  RoutingDownloadInfo,
  RoutingInfo,
  RuleMatcher,
} from "./rule-types.ts";

type InfoStringKey = {
  [Key in keyof RoutingInfo]-?: RoutingInfo[Key] extends string | undefined ? Key : never;
}[keyof RoutingInfo];

const isPrivateInfo = (info: RoutingInfo | undefined): boolean => {
  const currentTab = info?.currentTab;
  return (
    currentTab != null &&
    typeof currentTab === "object" &&
    Reflect.get(currentTab, "incognito") === true
  );
};

const logMatch = (match: MatcherResult, regex: RegExp, info: RoutingInfo | undefined): void => {
  if (routingPorts.isDebug() && match && !isPrivateInfo(info))
    routingPorts.logDebug("matched", match, regex, info);
};

const matchValue = (value: string, regex: RegExp): RegExpMatchArray | null =>
  new RegExp(regex.source, regex.flags).exec(value);

type MatcherCandidate = { source: string; value: string };
type MatcherEvaluator = NonNullable<RuleMatcher["explain"]>;

const explainableMatcher = (evaluate: MatcherEvaluator): RuleMatcher => {
  const explain: MatcherEvaluator = (info, metadata) => evaluate(info ?? {}, metadata);
  return Object.assign(
    (info: RoutingInfo, metadata?: Partial<RoutingInfo>) => explain(info, metadata).result,
    { explain },
  );
};

const evaluatedAttempt = (
  source: string,
  value: string,
  regex: RegExp,
): { result: RegExpMatchArray | null; attempt: MatcherAttempt } => {
  const result = matchValue(value, regex);
  return {
    result,
    attempt: {
      source,
      value,
      status: result ? "matched" : "not-matched",
      ...(result
        ? {
            matchedText: result[0],
            captures: result.slice(1).map((capture) => capture ?? null),
          }
        : {}),
    },
  };
};

const missingEvaluation = (source: string, result: false | null = false): MatcherEvaluation => ({
  result,
  attempts: [{ source, value: null, status: "missing" }],
});

const evaluateCandidates = (
  regex: RegExp,
  info: RoutingInfo,
  candidates: MatcherCandidate[],
  missingSource: string,
  missingResult: false | null = false,
): MatcherEvaluation => {
  if (candidates.length === 0) return missingEvaluation(missingSource, missingResult);
  const attempts: MatcherAttempt[] = [];
  for (const candidate of candidates) {
    const evaluated = evaluatedAttempt(candidate.source, candidate.value, regex);
    attempts.push(evaluated.attempt);
    if (evaluated.result) {
      logMatch(evaluated.result, regex, info);
      return { result: evaluated.result, attempts };
    }
  }
  return { result: null, attempts };
};

const stringCandidate = (
  info: Partial<RoutingInfo>,
  propertyName: InfoStringKey,
): MatcherCandidate | null => {
  const value = info[propertyName];
  return typeof value === "string" ? { source: propertyName, value } : null;
};

const firstStringCandidate = (
  info: Partial<RoutingInfo>,
  propertyNames: InfoStringKey[],
): MatcherCandidate | null => {
  for (const propertyName of propertyNames) {
    const candidate = stringCandidate(info, propertyName);
    if (candidate) return candidate;
  }
  return null;
};

const firstNonEmptyStringCandidate = (
  info: Partial<RoutingInfo>,
  propertyNames: InfoStringKey[],
): MatcherCandidate | null => {
  for (const propertyName of propertyNames) {
    const candidate = stringCandidate(info, propertyName);
    if (candidate?.value) return candidate;
  }
  return null;
};

const makeInfoMatcherFactory =
  (propertyName: InfoStringKey, alternativePropertyName?: InfoStringKey): MatcherFactory =>
  (regex) =>
    explainableMatcher((info) =>
      evaluateCandidates(
        regex,
        info,
        [
          stringCandidate(info, propertyName),
          ...(alternativePropertyName ? [stringCandidate(info, alternativePropertyName)] : []),
        ].filter((candidate): candidate is MatcherCandidate => candidate !== null),
        propertyName,
        null,
      ),
    );

const makeTabMatcherFactory =
  (propertyName: "title"): MatcherFactory =>
  (regex) =>
    explainableMatcher((info) => {
      const attachedTab = info.currentTab;
      const tab = Object.hasOwn(info, "currentTab") ? attachedTab : routingPorts.getCurrentTab();
      const value =
        tab != null && typeof tab === "object" ? Reflect.get(tab, propertyName) : undefined;
      return evaluateCandidates(
        regex,
        info,
        typeof value === "string" ? [{ source: "currentTabTitle", value }] : [],
        "currentTabTitle",
        null,
      );
    });

const makeHostnameMatcherFactory =
  (
    propertyName: InfoStringKey,
    alternativePropertyName?: InfoStringKey,
    transform: (hostname: string) => string | undefined = (hostname) => hostname,
  ): MatcherFactory =>
  (regex) =>
    explainableMatcher((info) => {
      const candidate = firstStringCandidate(
        info,
        alternativePropertyName ? [propertyName, alternativePropertyName] : [propertyName],
      );
      if (!candidate) return missingEvaluation(propertyName, null);
      try {
        const hostname = transform(new URL(candidate.value).hostname);
        if (!hostname) return missingEvaluation(candidate.source, null);
        return evaluateCandidates(
          regex,
          info,
          [{ source: candidate.source, value: hostname }],
          candidate.source,
        );
      } catch (error) {
        if (routingPorts.isDebug() && !isPrivateInfo(info))
          routingPorts.logDebug("bad page domain in matcher", candidate.value, error);
        return {
          result: null,
          attempts: [{ source: candidate.source, value: candidate.value, status: "invalid" }],
        };
      }
    });

const EMPTY_INFO: Partial<RoutingDownloadInfo> = {};

const mimeMatcher: MatcherFactory = (regex) =>
  explainableMatcher((info) => {
    const source = info.mime ? "mime" : "resolvedContentType";
    const mime = normalizeMimeType(info.mime || info.resolvedHead?.contentType);
    return mime
      ? evaluateCandidates(regex, info, [{ source, value: mime }], source)
      : missingEvaluation("mime");
  });

export const matcherFunctions = {
  context: (regex) =>
    explainableMatcher((info, { context } = EMPTY_INFO) =>
      typeof context === "string"
        ? evaluateCandidates(
            regex,
            info,
            [{ source: "context", value: context.toLowerCase() }],
            "context",
          )
        : missingEvaluation("context", null),
    ),
  // Browser context-menu saves report mediaType, while content-originated
  // saves report the more precise sourceKind. Treat mediaType as the legacy
  // host-boundary fallback so one rule can describe the same image in both
  // paths.
  sourcekind: (regex) =>
    explainableMatcher((info) => {
      const candidate = firstStringCandidate(info, ["sourceKind", "mediaType"]);
      return candidate
        ? evaluateCandidates(regex, info, [candidate], candidate.source)
        : missingEvaluation("sourceKind", null);
    }),
  menuindex: (regex) =>
    explainableMatcher((info, { menuIndex } = EMPTY_INFO) =>
      typeof menuIndex === "string"
        ? evaluateCandidates(regex, info, [{ source: "menuIndex", value: menuIndex }], "menuIndex")
        : missingEvaluation("menuIndex", null),
    ),
  comment: (regex) =>
    explainableMatcher((info, { comment } = EMPTY_INFO) =>
      typeof comment === "string"
        ? evaluateCandidates(regex, info, [{ source: "comment", value: comment }], "comment")
        : missingEvaluation("comment", null),
    ),
  fileext: (regex) =>
    explainableMatcher((info) => {
      const candidate = firstNonEmptyStringCandidate(info, [
        "sourceUrl",
        "srcUrl",
        "linkUrl",
        "pageUrl",
      ]);
      if (!candidate) return missingEvaluation("sourceUrl");
      const suffix = candidate.value.match(EXTENSION_REGEX)?.[1];
      return suffix
        ? evaluateCandidates(
            regex,
            info,
            [{ source: candidate.source, value: suffix }],
            candidate.source,
          )
        : missingEvaluation(candidate.source);
    }),
  urlfileext: (regex) =>
    explainableMatcher((info) => {
      const candidate = firstNonEmptyStringCandidate(info, [
        "url",
        "sourceUrl",
        "srcUrl",
        "linkUrl",
        "pageUrl",
      ]);
      if (!candidate) return missingEvaluation("url");
      const extension = getFilenameFromUrl(candidate.value).match(EXTENSION_REGEX)?.[1] ?? "";
      return evaluateCandidates(
        regex,
        info,
        [{ source: candidate.source, value: extension }],
        candidate.source,
      );
    }),
  actualfileext: (regex) =>
    explainableMatcher((info) => {
      const filename = firstNonEmptyStringCandidate(info, ["resolvedFilename", "filename"]);
      const extension = filename?.value.match(EXTENSION_REGEX)?.[1];
      const candidate = extension
        ? { source: filename.source, value: extension }
        : typeof info.mimeExtension === "string"
          ? { source: "mimeExtension", value: info.mimeExtension }
          : null;
      return candidate
        ? evaluateCandidates(regex, info, [candidate], candidate.source)
        : missingEvaluation(filename?.source ?? "filename");
    }),
  filename: (regex) =>
    explainableMatcher((info, { filename } = EMPTY_INFO) => {
      const value = info.filename || filename;
      return typeof value === "string" && value
        ? evaluateCandidates(regex, info, [{ source: "filename", value }], "filename")
        : missingEvaluation("filename");
    }),
  finalfilename: makeInfoMatcherFactory("resolvedFilename"),
  frameurl: makeInfoMatcherFactory("frameUrl"),
  linktext: makeInfoMatcherFactory("linkText"),
  mediatype: makeInfoMatcherFactory("mediaType"),
  mime: mimeMatcher,
  contenttype: mimeMatcher,
  naivefilename: (regex) =>
    explainableMatcher((info) => {
      const candidate = firstNonEmptyStringCandidate(info, [
        "url",
        "sourceUrl",
        "srcUrl",
        "linkUrl",
        "pageUrl",
      ]);
      if (!candidate) return missingEvaluation("url");
      const filename = getFilenameFromUrl(candidate.value);
      return filename
        ? evaluateCandidates(
            regex,
            info,
            [{ source: candidate.source, value: filename }],
            candidate.source,
          )
        : missingEvaluation(candidate.source);
    }),
  pagedomain: makeHostnameMatcherFactory("pageUrl"),
  pagerootdomain: makeHostnameMatcherFactory("pageUrl", undefined, toRootDomain),
  referrerdomain: makeHostnameMatcherFactory("referrerUrl", "pageUrl"),
  referrerurl: makeInfoMatcherFactory("referrerUrl", "pageUrl"),
  sourcedomain: makeHostnameMatcherFactory("sourceUrl", "srcUrl"),
  sourcerootdomain: makeHostnameMatcherFactory("sourceUrl", "srcUrl", toRootDomain),
  pagetitle: makeTabMatcherFactory("title"),
  pageurl: makeInfoMatcherFactory("pageUrl"),
  selectiontext: makeInfoMatcherFactory("selectionText"),
  sourceurl: makeInfoMatcherFactory("sourceUrl", "srcUrl"),
} satisfies Record<string, MatcherFactory>;
