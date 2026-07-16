import { DOWNLOAD_TYPES, MESSAGE_TYPES } from "../../shared/constants.ts";
import { Path } from "../../routing/path.ts";
import { options } from "../../config/options-data.ts";
import { launchDownload } from "../../downloads/download.ts";
import {
  isAdmittedAutomaticSource,
  matchAutomaticRoutingRule,
} from "../../automation/automatic-routing.ts";
import { matchesAnyPattern } from "../../shared/match-pattern.ts";
import { normalizeContentOption } from "../../config/content-options.ts";
import { isDataUrl, isDataUrlWithinCap, parseDataUrlMediaType } from "../../shared/data-url.ts";
import { addLogEntry } from "../log.ts";
import type { MessageOf } from "../../shared/message-protocol.ts";
import type { MessageSender, ProtocolSendResponse } from "./protocol.ts";

export const handleAutoDownloadSource = async (
  request: MessageOf<typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE>,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE>>,
): Promise<void> => {
  const skip = () =>
    sendResponse({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  const senderTab = sender.tab;
  const sourceUrl = request.body.sourceUrl;
  if (
    options.autoDownloadEnabled !== true ||
    !senderTab?.url ||
    (senderTab.incognito === true && options.autoDownloadPrivate !== true)
  ) {
    skip();
    return;
  }
  // Backstop: a stale content script cannot keep automatic saves alive on a
  // site the user has since added to the per-site disable list. Coerce a
  // malformed stored value through the shared normalizer so the background and
  // content bundle agree on "nothing disabled" for non-string data.
  const disableList = normalizeContentOption("perSiteDisableList", options.perSiteDisableList);
  if (disableList && matchesAnyPattern(senderTab.url, disableList)) {
    skip();
    return;
  }
  // Backstop the protocol gate. data: is opt-in and capped identically to the
  // content side; an oversize data: URL from a stale content script is rejected
  // here and logged once (the length only, never the payload — and marked
  // private when the sender tab is). blob: and every other scheme stay rejected.
  if (isDataUrl(sourceUrl)) {
    if (normalizeContentOption("autoDownloadDataUrls", options.autoDownloadDataUrls) !== true) {
      skip();
      return;
    }
    if (!isDataUrlWithinCap(sourceUrl)) {
      void addLogEntry(
        "automatic data: source rejected: exceeds size cap",
        { length: sourceUrl.length },
        { privateContext: senderTab.incognito === true },
      );
      skip();
      return;
    }
  } else {
    let sourceProtocol = "";
    try {
      sourceProtocol = new URL(sourceUrl).protocol;
    } catch {
      skip();
      return;
    }
    if (sourceProtocol !== "http:" && sourceProtocol !== "https:") {
      skip();
      return;
    }
  }
  // Backstop: a stale content script cannot adopt a kind/channel combination
  // the current options forbid, even if it was allowed when the page loaded.
  // Mirrors the disable-list backstop above by re-deriving the same gates a
  // freshly mounted scan would use and re-running the shared admission rule.
  const gates = {
    includeLinks: normalizeContentOption("autoDownloadLinks", options.autoDownloadLinks),
    includeDocuments: normalizeContentOption(
      "autoDownloadDocuments",
      options.autoDownloadDocuments,
    ),
    includeBackgrounds: normalizeContentOption(
      "autoDownloadBackgrounds",
      options.autoDownloadBackgrounds,
    ),
    resourceHints: normalizeContentOption("autoDownloadManifests", options.autoDownloadManifests),
  };
  if (!isAdmittedAutomaticSource(request.body.sourceKind, request.body.sourceChannel, gates)) {
    skip();
    return;
  }
  const rules = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  const match = matchAutomaticRoutingRule(rules, {
    pageUrl: senderTab.url,
    sourceUrl,
    sourceKind: request.body.sourceKind,
  });
  if (!match) {
    skip();
    return;
  }

  const result = await launchDownload({
    path: new Path("."),
    scratch: {
      routeTemplateRaw: match.destination,
      ...(match.fetch !== null ? { fetchTemplateRaw: match.fetch } : {}),
      ...(match.rename !== null ? { renameTemplate: match.rename } : {}),
    },
    info: {
      currentTab: senderTab,
      now: new Date(),
      pageUrl: senderTab.url,
      selectedUrl: sourceUrl,
      sourceUrl,
      sourceKind: request.body.sourceKind,
      url: sourceUrl,
      context: DOWNLOAD_TYPES.AUTO,
      // A data: URL carries no path, so seed the mediatype parsed from its
      // header as the download's mime. mime-based matching and :mimeext: naming
      // resolve from it, and resolveMime short-circuits — no HTTP-only HEAD.
      ...(isDataUrl(sourceUrl) ? { mime: parseDataUrlMediaType(sourceUrl) } : {}),
    },
  });
  sendResponse({
    type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
    body: { status: result.status },
  });
};
