import { options } from "../config/options-data.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { Download } from "../downloads/download.ts";
import { Path } from "../routing/path.ts";
import { getCaptureMatches, matchRule } from "../routing/router.ts";
import { applyVariables } from "../routing/variable.ts";

export type RoutePreviewState = { info: DownloadInfo };
export type RoutePreview = {
  path: string | null;
  captures: (string | undefined)[] | null;
};

export const previewRoutes = async (state?: RoutePreviewState | null): Promise<RoutePreview> => {
  if (!state) return { path: null, captures: null };

  const info = {
    ...state.info,
    filenamePatterns: options.filenamePatterns,
    // Chrome replaces special filename characters with `_`; previews match
    // against the original browser filename when it is still available.
    filename: state.info.initialFilename || state.info.filename,
    preview: true,
  };
  const previewState = { ...state, info };
  const path = await applyVariables(new Path(Download.getRoutingMatches(previewState)), info);

  const filenamePatterns = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  let captures: (string | undefined)[] | null = null;
  for (const rule of filenamePatterns) {
    if (!matchRule(rule, info)) continue;
    captures = getCaptureMatches(rule, info);
    break;
  }

  return { path: path.finalize(), captures };
};
