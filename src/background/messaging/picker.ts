import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { currentTab, type CurrentTab } from "../../platform/current-tab.ts";
import { allowsExternalPrivateTabs, options } from "../../config/options-data.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { parsePickerSource, type PickerSource } from "../../shared/destination-picker.ts";
import type { MessageOf } from "../../shared/message-protocol.ts";
import { withUrl } from "../../shared/util.ts";
import { buildPickerMenu, openPickerInTab, pickerSourceForTab } from "../destination-picker.ts";
import { hoveredClickInfo } from "../hovered-source.ts";
import { handleContextMenuClick } from "../menu-click.ts";
import {
  API_ERRORS,
  API_VERSION,
  isValidDownloadUrl,
  type MessageSender,
  type ProtocolSendResponse,
} from "./protocol.ts";

type PickerModelRequest = MessageOf<typeof MESSAGE_TYPES.PICKER_MODEL>;
type PickerSaveRequest = MessageOf<typeof MESSAGE_TYPES.PICKER_SAVE>;
type OpenPickerRequest = MessageOf<typeof MESSAGE_TYPES.OPEN_PICKER>;

// The click handler that performs the save classifies a click as private when
// either its own tab or the tracked current tab is private, and reads Last
// used accordingly. The list is built under the same rule, or a row could name
// the regular Last used folder while the save lands in the private one.
const isPrivatePickerTab = (tab: CurrentTab | null | undefined): boolean =>
  tab?.incognito === true || currentTab?.incognito === true;

export const handlePickerModel = (
  _request: PickerModelRequest,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<PickerModelRequest>,
): void => {
  sendResponse({
    type: MESSAGE_TYPES.PICKER_MODEL,
    body: buildPickerMenu(isPrivatePickerTab(sender.tab)).model,
  });
};

// A link-only source is saved as a link or not at all. With link saving off the
// click handler would fall through to the page, and a picker opened for a link
// must never save something else in its place.
const isSavableSource = (source: PickerSource | null): boolean =>
  !source || Boolean(source.media) || options.links;

// The page side supplies only a menu item id and the source the picker was
// opened for. The id must be one the picker would list for this tab right
// now, the page address comes from the browser's own record of the sender tab,
// and the save itself is the menu click handler's.
export const handlePickerSave = async (
  request: PickerSaveRequest,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<PickerSaveRequest>,
): Promise<void> => {
  const { menuItemId, source: rawSource } = request.body;
  const source = rawSource == null ? null : parsePickerSource(rawSource);
  const tab = sender.tab;
  const pageUrl = tab?.url;
  if (
    !tab ||
    pageUrl == null ||
    (rawSource != null && !source) ||
    !isSavableSource(source) ||
    !buildPickerMenu(isPrivatePickerTab(tab)).selectable.has(menuItemId)
  ) {
    sendResponse({
      type: MESSAGE_TYPES.PICKER_SAVE,
      body: { status: MESSAGE_TYPES.ERROR, error: API_ERRORS.BAD_REQUEST },
    });
    return;
  }
  await handleContextMenuClick({ menuItemId, pageUrl, ...hoveredClickInfo(source) }, tab);
  sendResponse({ type: MESSAGE_TYPES.OK });
};

/**
 * OPEN_PICKER: another extension asks Save In to show the in-page destination
 * picker (#110's Gesturefy follow-up). Nothing is saved until the user picks a
 * destination in the page. The allowlist gate runs before this handler.
 *
 * Request:  { type: "OPEN_PICKER", body?: { url?, kind?, version? } }
 * Response: { type: "OPEN_PICKER", body: { status: "OK", version } }
 *      or:  { type: "OPEN_PICKER", body: { status: "ERROR", error, message, version } }
 */
export const handleOpenPickerMessage = async (
  request: OpenPickerRequest,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<OpenPickerRequest>,
  external = false,
): Promise<void> => {
  const body = request.body || {};
  const version = body.version || API_VERSION;
  const fail = (error: string, message: string): void =>
    sendResponse({
      type: MESSAGE_TYPES.OPEN_PICKER,
      body: { status: MESSAGE_TYPES.ERROR, error, message, version },
    });

  // Gesture extensions send from their background, so the sender often has no
  // tab; the active tab of the last-focused window is the one the user is on.
  const tab =
    sender.tab ??
    (
      await webExtensionApi.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [])
    )[0];
  const tabUrl = tab?.url;
  // Allowing an integration grants no private-tab access unless the user also
  // chose to remember private browsing activity. Otherwise a private tab
  // answers exactly like a missing one, so the caller learns neither its
  // address nor that a private window has focus.
  if (
    !tab ||
    tabUrl == null ||
    (external && tab.incognito === true && !allowsExternalPrivateTabs())
  ) {
    fail(API_ERRORS.BAD_REQUEST, "No tab that can show the picker was found");
    return;
  }

  let source: PickerSource | null | undefined;
  if (typeof body.url === "string" && body.url) {
    if (!isValidDownloadUrl(body.url)) {
      fail(API_ERRORS.INVALID_URL, "URL must be http(s), ftp, data or blob");
      return;
    }
    const url = withUrl(body.url, (parsed) => parsed.href, body.url);
    // A blob URL is readable only through the document that created it, and a
    // caller tied to no tab names no such document.
    if (external && !sender.tab && url.startsWith("blob:")) {
      fail(API_ERRORS.INVALID_URL, "A blob URL must come from the calling tab");
      return;
    }
    const kind = body.kind ?? "link";
    source = parsePickerSource(kind === "link" ? { linkUrl: url } : { media: { url, kind } });
    if (!source) {
      fail(API_ERRORS.INVALID_URL, "URL is too long");
      return;
    }
    if (!isSavableSource(source)) {
      fail(API_ERRORS.BAD_REQUEST, "Saving links is turned off in Save In");
      return;
    }
  } else {
    source = await pickerSourceForTab({ ...tab, url: tabUrl });
    if (source === undefined) {
      fail(API_ERRORS.BAD_REQUEST, "Nothing in this tab can be saved");
      return;
    }
  }

  if (!(await openPickerInTab(tab, source))) {
    fail(API_ERRORS.UNAVAILABLE, "The picker cannot be shown in this tab");
    return;
  }
  sendResponse({ type: MESSAGE_TYPES.OPEN_PICKER, body: { status: MESSAGE_TYPES.OK, version } });
};
