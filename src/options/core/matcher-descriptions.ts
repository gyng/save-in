import { EXTENSION_REGEX, getFilenameFromUrl } from "../../routing/filename.ts";
import { toRootDomain } from "../../shared/domain.ts";
import { referenceDescription } from "./reference-descriptions.ts";

export const matcherDescription = (matcher: string, root: ParentNode = document): string =>
  referenceDescription("clauses", `${matcher.toLocaleLowerCase()}:`, root);

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
    case "directory":
      return testFieldValue(root, "route-debugger-menu-path");
    case "linktext":
      return testFieldValue(root, "route-debugger-link-text");
    case "linktitle":
      return testFieldValue(root, "route-debugger-link-title");
    case "linkdownload":
      return testFieldValue(root, "route-debugger-link-download");
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
    case "css":
      return "DOM context unavailable";
    case "sourceurl":
      return sourceUrl;
    case "sourcedomain":
      return hostname(sourceUrl);
    case "sourcerootdomain":
      return hostname(sourceUrl, true);
    case "sourcekind":
      return testFieldValue(root, "route-debugger-source-kind");
    case "gesture":
      return testFieldValue(root, "route-debugger-gesture");
    case "filename":
    case "finalfilename":
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
    case "contenttype": {
      const mime = testFieldValue(root, "route-debugger-mime");
      const [mimeType = mime] = mime.split(";", 1);
      return mimeType.trim().toLocaleLowerCase();
    }
    default:
      return "";
  }
};
