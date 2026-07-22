import type { DownloadInfo } from "../downloads/download-types.ts";
import type { RoutePreview } from "../shared/route-preview-types.ts";
import { getRoutingMatch } from "../downloads/download-plan.ts";
import { options } from "../config/options-data.ts";
import { Path, ROUTES_TO_FOLDER_REGEX } from "../routing/path.ts";
import {
  applyRenameTransform,
  expandRenameTransform,
  getCaptureMatches,
} from "../routing/router.ts";
import { applyVariables } from "../routing/variable.ts";

export type RoutePreviewState = { info: DownloadInfo };

export const previewRoutes = async (state?: RoutePreviewState | null): Promise<RoutePreview> => {
  if (!state) return { path: null, captures: null };

  const info = {
    ...state.info,
    filenamePatterns: options.filenamePatterns,
    now: state.info.now instanceof Date ? state.info.now : new Date(),
    resolvedFilename: state.info.filename,
    // Preserve the original unsanitized name for established filename: rules;
    // actualfileext: reads resolvedFilename when the browser supplied one.
    filename: state.info.initialFilename || state.info.filename,
    preview: true,
  };
  const previewState = { ...state, info };
  // The preview must mirror the Save In pipeline's own match — every rule
  // eligible, including fetch rules — and take the path and the captures from
  // the SAME winning rule, or the pane contradicts the download it explains.
  const match = getRoutingMatch(previewState);
  if (match?.outcome === "exclude") {
    return { path: null, captures: null, outcome: "exclude" };
  }
  const matchedRoute = match?.destination ?? null;
  const path = await applyVariables(new Path(matchedRoute), info);
  const captures = match ? getCaptureMatches(match.rule, info) : null;
  // Mirror finalizeFullPath: the winning rule's rename edits the final
  // filename component of the previewed route before sanitization.
  const rename = match?.rename ? await expandRenameTransform(match.rename, info) : null;
  const finalComponentIsFilename = !ROUTES_TO_FOLDER_REGEX.test(matchedRoute || "");

  return {
    path: path.finalize({
      finalComponentIsFilename,
      ...(rename && finalComponentIsFilename
        ? {
            transformFinalComponent: (value: string) => applyRenameTransform(value, rename),
          }
        : {}),
    }),
    captures,
    ...(match?.tabAction ? { tabAction: match.tabAction } : {}),
  };
};
