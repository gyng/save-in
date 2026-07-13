import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { routingPorts } from "./ports.ts";
import type {
  MatcherFactory,
  MatcherResult,
  RoutingDownloadInfo,
  RoutingInfo,
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

const makeInfoMatcherFactory =
  (propertyName: InfoStringKey, alternativePropertyName?: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    const value = info[propertyName];
    let match = typeof value === "string" ? matchValue(value, regex) : null;
    if (!match && alternativePropertyName) {
      const alternativeValue = info[alternativePropertyName];
      match = typeof alternativeValue === "string" ? matchValue(alternativeValue, regex) : null;
    }
    logMatch(match, regex, info);
    return match;
  };

const makeTabMatcherFactory =
  (propertyName: "title"): MatcherFactory =>
  (regex) =>
  (info) => {
    const attachedTab = info.currentTab;
    const tab = Object.hasOwn(info, "currentTab") ? attachedTab : routingPorts.getCurrentTab();
    const value =
      tab != null && typeof tab === "object" ? Reflect.get(tab, propertyName) : undefined;
    const match = typeof value === "string" ? matchValue(value, regex) : null;
    logMatch(match, regex, info);
    return match;
  };

const makeHostnameMatcherFactory =
  (propertyName: InfoStringKey, alternativePropertyName?: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    const primaryValue = info?.[propertyName];
    const alternativeValue = alternativePropertyName ? info?.[alternativePropertyName] : undefined;
    const value =
      typeof primaryValue === "string"
        ? primaryValue
        : typeof alternativeValue === "string"
          ? alternativeValue
          : "";
    try {
      const match = matchValue(new URL(value).hostname, regex);
      logMatch(match, regex, info);
      return match;
    } catch (error) {
      if (routingPorts.isDebug() && !isPrivateInfo(info))
        routingPorts.logDebug("bad page domain in matcher", value, error);
      return null;
    }
  };

const EMPTY_INFO: Partial<RoutingDownloadInfo> = {};

export const matcherFunctions = {
  context:
    (regex) =>
    (info, { context } = EMPTY_INFO) => {
      const match = context == null ? null : matchValue(context.toLowerCase(), regex);
      logMatch(match, regex, info);
      return match;
    },
  menuindex:
    (regex) =>
    (info, { menuIndex } = EMPTY_INFO) => {
      const match = menuIndex == null ? null : matchValue(menuIndex, regex);
      logMatch(match, regex, info);
      return match;
    },
  comment:
    (regex) =>
    (info, { comment } = EMPTY_INFO) => {
      const match = comment == null ? null : matchValue(comment, regex);
      logMatch(match, regex, info);
      return match;
    },
  fileext: (regex) => (info) => {
    const url = info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;
    const extension = url.match(EXTENSION_REGEX);
    const suffix = extension?.[1];
    if (!suffix) return false;
    const match = matchValue(suffix, regex);
    logMatch(match, regex, info);
    return match;
  },
  urlfileext: (regex) => (info) => {
    const url = info.url || info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;
    const match = matchValue(getFilenameFromUrl(url).match(EXTENSION_REGEX)?.[1] || "", regex);
    logMatch(match, regex, info);
    return match;
  },
  actualfileext: (regex) => (info) => {
    if (!info.filename) return false;
    const match = matchValue(info.filename.match(EXTENSION_REGEX)?.[1] || "", regex);
    logMatch(match, regex, info);
    return match;
  },
  filename:
    (regex) =>
    (info, { filename } = EMPTY_INFO) => {
      const fn = info.filename || filename;
      if (!fn) return false;
      const match = matchValue(fn, regex);
      logMatch(match, regex, info);
      return match;
    },
  frameurl: makeInfoMatcherFactory("frameUrl"),
  linktext: makeInfoMatcherFactory("linkText"),
  mediatype: makeInfoMatcherFactory("mediaType"),
  naivefilename: (regex) => (info) => {
    const url = info.url || info.sourceUrl || info.srcUrl || info.linkUrl || info.pageUrl;
    if (!url) return false;
    const filename = getFilenameFromUrl(url);
    if (!filename) return false;
    const match = matchValue(filename, regex);
    logMatch(match, regex, info);
    return match;
  },
  pagedomain: makeHostnameMatcherFactory("pageUrl"),
  sourcedomain: makeHostnameMatcherFactory("sourceUrl", "srcUrl"),
  pagetitle: makeTabMatcherFactory("title"),
  pageurl: makeInfoMatcherFactory("pageUrl"),
  selectiontext: makeInfoMatcherFactory("selectionText"),
  sourceurl: makeInfoMatcherFactory("sourceUrl", "srcUrl"),
} satisfies Record<string, MatcherFactory>;
