import { DOWNLOAD_TYPES, MESSAGE_TYPES } from "../../shared/constants.ts";
import { Path } from "../../routing/path.ts";
import { options } from "../../config/options-data.ts";
import { launchDownload } from "../../downloads/download.ts";
import { matchAutomaticRoutingRule } from "../../automation/automatic-routing.ts";
import { matchesAnyPattern } from "../../shared/match-pattern.ts";
import { normalizeContentOption } from "../../config/content-options.ts";
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
    },
  });
  sendResponse({
    type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
    body: { status: result.status },
  });
};
