import { options } from "../config/options-data.ts";
import { Path } from "../routing/path.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { Download } from "./download.ts";
import { Shortcut } from "./shortcut.ts";

export const launchSourceSidecar = async (
  state: DownloadPipelineState,
  sourceUrl: string,
  title?: string,
): Promise<void> => {
  if (!options.saveSourceSidecar) return;
  const finalFullPath = Download.finalizeFullPath(state);
  const { directory: sidecarDirectory, filename: sidecarFilename } = Shortcut.sourceSidecarPath(
    finalFullPath,
    options.shortcutType,
    options.truncateLength,
  );
  await Download.launch({
    path: new Path(sidecarDirectory),
    scratch: {},
    info: {
      currentTab: state.info.currentTab,
      now: new Date(),
      pageUrl: state.info.pageUrl,
      selectedUrl: sourceUrl,
      sourceUrl,
      url: Shortcut.makeShortcut(options.shortcutType, sourceUrl, title),
      suggestedFilename: sidecarFilename,
      context: DOWNLOAD_TYPES.SIDECAR,
      menuItemId: state.info.menuItemId,
      menuItemTitle: state.info.menuItemTitle || "Source link",
      menuItemPath: sidecarDirectory,
      routingDisabled: true,
      suppressPrompt: true,
      webhookEligible: false,
    },
  });
};
