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

const makeInfoMatcherFactory =
  (propertyName: InfoStringKey, alternativePropertyName?: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    const value = info[propertyName];
    let match = typeof value === "string" ? value.match(regex) : null;
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
    const value = routingPorts.getCurrentTab()?.[propertyName];
    const match = typeof value === "string" ? value.match(regex) : null;
    logMatch(match, regex, info);
    return match;
  };

const makeHostnameMatcherFactory =
  (propertyName: InfoStringKey): MatcherFactory =>
  (regex) =>
  (info) => {
    try {
      const value = info[propertyName];
      const match = new URL(typeof value === "string" ? value : "").hostname.match(regex);
      logMatch(match, regex, info);
      return match;
    } catch (error) {
      if (routingPorts.isDebug() && !isPrivateInfo(info))
        routingPorts.logDebug("bad page domain in matcher", info.pageUrl, error);
      return null;
    }
  };

const EMPTY_INFO: Partial<RoutingDownloadInfo> = {};

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
    const suffix = extension?.[1];
    if (!suffix) return false;
    const match = suffix.match(regex);
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
      const fn = info.filename || filename;
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
