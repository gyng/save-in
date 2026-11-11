import { getMessage } from "../platform/localization.ts";
import { options, shouldPersistActivity } from "../config/options-data.ts";
import { DOWNLOAD_TYPES, RULE_TYPES } from "../shared/constants.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { downloadPorts } from "./ports.ts";
import {
  addDownloadLog,
  isPrivateDownloadState,
  requireDownloadUrl,
} from "./download-pipeline-state.ts";
import { createExtensionNotification, EXTENSION_NOTIFICATION_STREAMS } from "./notification.ts";
import { savedSourceLookupUrl } from "./saved-source-model.ts";

const historyPort = downloadPorts.history;

// Shift only asks for a dialog while promptOnShift is on, and a save that
// suppresses its dialog never shows one whatever was held.
export const isShiftPromptRequest = (state: Pick<DownloadPipelineState, "info">): boolean =>
  Boolean(options.promptOnShift) && state.info.modifiers?.includes("Shift") === true;

const isExplicitPromptRequest = (state: Pick<DownloadPipelineState, "info">): boolean =>
  state.info.suppressPrompt !== true &&
  (state.info.forcePrompt === true || isShiftPromptRequest(state));

// Whether a fetch: rule could still replace the address this save downloads.
// Until that is ruled out, the address History would be asked about is not the
// one that will be fetched.
export const mayRewriteDownloadUrl = (
  state: Pick<DownloadPipelineState, "info" | "scratch">,
): boolean => {
  if (typeof state.scratch.fetchTemplateRaw === "string") return true;
  if (state.info.routingDisabled) return false;
  const rules = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  return rules.some((rule) => rule.some((clause) => clause.type === RULE_TYPES.FETCH));
};

// True when the "Skip addresses already saved" option covers this save and Save
// In History still holds a completed save of the address about to be fetched.
// The caller then drops the save before any request and before a History row.
export const isSavedSource = async (state: DownloadPipelineState): Promise<boolean> => {
  // A content fetch already made this save a visible, cancellable History row
  // (a fetch: template that needs the file's hash). Declining it now would
  // leave that row behind for a save History was never meant to gain.
  if (typeof state.scratch.historyEntryId !== "undefined") return false;
  const url = savedSourceLookupUrl({
    mode: options.skipSavedSources,
    context: state.info.context,
    url: requireDownloadUrl(state),
    isolatedPrivate: !shouldPersistActivity(isPrivateDownloadState(state)),
    explicitPrompt: isExplicitPromptRequest(state),
    repeatsSavedSource: state.scratch.repeatsSavedSource === true,
  });
  if (url === null) return false;
  try {
    return await historyPort.hasCompletedUrl(url);
  } catch (error) {
    // An unreadable History proves nothing was saved; the save goes ahead.
    addDownloadLog(state, "saved-source lookup failed", String(error));
    return false;
  }
};

// One coalesced notice per burst, gated like the existing-file skip it sits
// beside. An automatic save stays silent: nothing the user did asked for it.
export const notifySavedSourceSkipped = (state: DownloadPipelineState): void => {
  if (!options.notifyOnFailure || state.info.context === DOWNLOAD_TYPES.AUTO) return;
  const privateContext = isPrivateDownloadState(state);
  createExtensionNotification(
    getMessage("notificationSavedSourceSkippedTitle"),
    privateContext
      ? getMessage("notificationPrivateSavedSourceSkippedMessage")
      : getMessage("notificationSavedSourceSkippedMessage", [requireDownloadUrl(state)]),
    false,
    EXTENSION_NOTIFICATION_STREAMS.SAVED_SOURCE_SKIP,
    { privateContext },
  );
};
