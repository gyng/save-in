import { options } from "../config/options-data.ts";
import { getMessage } from "../platform/localization.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { truncateDataUrlForDisplay } from "../shared/data-url.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import {
  isPrivateDownloadState,
  isSourceSidecar,
  requireDownloadUrl,
} from "./download-pipeline-state.ts";
import { createExtensionNotification, EXTENSION_NOTIFICATION_STREAMS } from "./notification.ts";

// Early planning exclusions and Chrome's browser-filename recheck must expose
// the same outcome without letting a private URL reach the OS notification.
export const notifyRouteExclusion = (state: DownloadPipelineState): void => {
  if (
    !options.notifyOnRuleMatch ||
    state.info.context === DOWNLOAD_TYPES.AUTO ||
    isSourceSidecar(state)
  ) {
    return;
  }
  createExtensionNotification(
    getMessage("routeActionExcluded"),
    isPrivateDownloadState(state)
      ? getMessage("notificationPrivateRuleExcludedMessage")
      : getMessage("notificationRuleExcludedMessage", [
          truncateDataUrlForDisplay(requireDownloadUrl(state)),
        ]),
    false,
    EXTENSION_NOTIFICATION_STREAMS.ROUTE_MATCH,
    { privateContext: isPrivateDownloadState(state) },
  );
};
