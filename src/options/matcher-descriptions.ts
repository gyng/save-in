import { EXTENSION_REGEX, getFilenameFromUrl } from "../routing/filename.ts";
import { toRootDomain } from "../shared/domain.ts";

const MATCHER_DESCRIPTIONS: Record<string, string> = {
  context: "Match how the save started",
  menuindex: "Match the selected menu position",
  comment: "Match menu-item metadata",
  linktext: "Match visible link text",
  selectiontext: "Match selected page text",
  pageurl: "Match the page URL",
  pagedomain: "Match the page hostname",
  pagerootdomain: "Match the page root domain",
  pagetitle: "Match the page title",
  frameurl: "Match the frame URL",
  referrerurl: "Match the referrer URL",
  referrerdomain: "Match the referrer hostname",
  sourceurl: "Match the file URL",
  sourcedomain: "Match the file hostname",
  sourcerootdomain: "Match the file root domain",
  sourcekind: "Match the discovered page-source kind",
  filename: "Match the resolved filename",
  naivefilename: "Match the URL-derived filename",
  fileext: "Match the URL-derived extension",
  urlfileext: "Match the URL-derived extension",
  actualfileext: "Match the resolved extension",
  mediatype: "Match image, video, or audio",
  mime: "Match the MIME content type",
  contenttype: "Match the MIME content type",
};

export const matcherDescription = (matcher: string): string =>
  MATCHER_DESCRIPTIONS[matcher.toLocaleLowerCase()] ?? "Match this download property";

const testFieldValue = (root: ParentNode, id: string): string =>
  root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? "";

const hostname = (value: string, rootDomain = false): string => {
  if (!value) return "";
  try {
    const valueHostname = new URL(value).hostname;
    return rootDomain ? toRootDomain(valueHostname) : valueHostname;
  } catch {
    return "";
  }
};

export const matcherTestValue = (matcher: string, root: ParentNode = document): string => {
  const name = matcher.toLocaleLowerCase();
  const filename = testFieldValue(root, "route-debugger-filename");
  const sourceUrl = testFieldValue(root, "route-debugger-source-url");
  const pageUrl = testFieldValue(root, "route-debugger-page-url");
  const referrerUrl = testFieldValue(root, "route-debugger-referrer-url") || pageUrl;
  switch (name) {
    case "context":
      return testFieldValue(root, "route-debugger-context").toLocaleLowerCase();
    case "menuindex":
      return testFieldValue(root, "route-debugger-menu-index");
    case "comment":
      return testFieldValue(root, "route-debugger-comment");
    case "linktext":
      return testFieldValue(root, "route-debugger-link-text");
    case "selectiontext":
      return testFieldValue(root, "route-debugger-selection-text");
    case "referrerurl":
      return referrerUrl;
    case "referrerdomain":
      return hostname(referrerUrl);
    case "pageurl":
      return pageUrl;
    case "pagedomain":
      return hostname(pageUrl);
    case "pagerootdomain":
      return hostname(pageUrl, true);
    case "pagetitle":
      return testFieldValue(root, "route-debugger-page-title");
    case "frameurl":
      return testFieldValue(root, "route-debugger-frame-url");
    case "sourceurl":
      return sourceUrl;
    case "sourcedomain":
      return hostname(sourceUrl);
    case "sourcerootdomain":
      return hostname(sourceUrl, true);
    case "sourcekind":
      return testFieldValue(root, "route-debugger-source-kind");
    case "filename":
      return filename;
    case "naivefilename":
      return sourceUrl ? getFilenameFromUrl(sourceUrl) : "";
    case "fileext":
      return sourceUrl.match(EXTENSION_REGEX)?.[1] ?? "";
    case "urlfileext":
      return sourceUrl ? (getFilenameFromUrl(sourceUrl).match(EXTENSION_REGEX)?.[1] ?? "") : "";
    case "actualfileext":
      return filename.match(EXTENSION_REGEX)?.[1] ?? "";
    case "mediatype":
      return testFieldValue(root, "route-debugger-media-type");
    case "mime":
    case "contenttype":
      return (
        testFieldValue(root, "route-debugger-mime").split(";", 1)[0]?.trim().toLocaleLowerCase() ??
        ""
      );
    default:
      return "";
  }
};
