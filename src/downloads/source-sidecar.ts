import { options } from "../config/options-data.ts";
import { Path } from "../routing/path.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import type { DownloadPipelineState, SourceSidecarRequest } from "./download-types.ts";
import { launchDownload } from "./download.ts";
import { makeShortcut, sourceSidecarPath } from "./shortcut.ts";

export const createSourceSidecarRequest = (
  state: DownloadPipelineState,
  sourceUrl: string,
  title?: string,
): SourceSidecarRequest => ({
  sourceUrl,
  ...(title ? { title } : {}),
  ...(state.info.pageUrl ? { pageUrl: state.info.pageUrl } : {}),
  ...(state.info.menuItemId ? { menuItemId: state.info.menuItemId } : {}),
  ...(state.info.menuItemTitle ? { menuItemTitle: state.info.menuItemTitle } : {}),
});

export const resolveSourceSidecarPrimaryPath = (
  intendedFilename: string,
  currentFilename?: string,
): string => {
  const intended = intendedFilename.replace(/\\/g, "/");
  if (!currentFilename) return intended;
  const currentBasename = currentFilename.replace(/\\/g, "/").split("/").at(-1);
  if (!currentBasename) return intended;
  const slash = intended.lastIndexOf("/");
  return slash >= 0 ? `${intended.slice(0, slash + 1)}${currentBasename}` : currentBasename;
};

export const launchSourceSidecar = async (
  request: SourceSidecarRequest,
  intendedFilename: string,
  currentFilename?: string,
): Promise<void> => {
  if (!options.saveSourceSidecar) return;
  const finalFullPath = resolveSourceSidecarPrimaryPath(intendedFilename, currentFilename);
  const { directory: sidecarDirectory, filename: sidecarFilename } = sourceSidecarPath(
    finalFullPath,
    options.shortcutType,
    options.truncateLength,
  );
  await launchDownload({
    path: new Path(sidecarDirectory),
    scratch: {},
    info: {
      now: new Date(),
      pageUrl: request.pageUrl,
      selectedUrl: request.sourceUrl,
      sourceUrl: request.sourceUrl,
      url: makeShortcut(options.shortcutType, request.sourceUrl, request.title),
      suggestedFilename: sidecarFilename,
      context: DOWNLOAD_TYPES.SIDECAR,
      menuItemId: request.menuItemId,
      menuItemTitle: request.menuItemTitle || "Source link",
      menuItemPath: sidecarDirectory,
      routingDisabled: true,
      suppressPrompt: true,
      webhookEligible: false,
    },
  });
};
