import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import {
  getFilenameFromContentDispositionHeader,
  type ContentDispositionParseOptions,
} from "../vendor/content-disposition.ts";
import { EXTENSION_REGEX } from "../routing/filename.ts";
import { sanitizeFilename } from "../routing/path.ts";
import { applyRenameTransform } from "../routing/rename.ts";
import { resolveHead } from "../routing/variable.ts";
import { options } from "../config/options-data.ts";
import { isHttpDownloadUrl } from "./download-pipeline-state.ts";
import type { DownloadPipelineState, FinalizableDownloadState } from "./download-types.ts";

const FIREFOX_CONTENT_DISPOSITION_COMPATIBILITY: ContentDispositionParseOptions = {
  // Firefox's native HTTP path accepts quoted ext-values and URI-unescapes a
  // decoded extended value again. Its HEAD-based Save In path must agree.
  allowQuotedExtendedValue: true,
  unescapeExtendedValueAgain: true,
};

export const getFilenameFromContentDisposition = (
  disposition: unknown,
  parseOptions: ContentDispositionParseOptions = {},
): string | null => {
  if (typeof disposition !== "string") return null;

  const filenameFromLib = getFilenameFromContentDispositionHeader(disposition, parseOptions);
  return filenameFromLib || null;
};

// Firefox resolves a server-provided filename before finalizing the plan —
// and again after a fetch: rewrite retargets the URL. Chrome must defer this
// to onDeterminingFilename, which runs after the browser download starts.
export const resolveDispositionFilename = async (state: DownloadPipelineState): Promise<void> => {
  // The Content-Disposition HEAD is an HTTP-only optimization. A non-HTTP URL
  // (a data: source, a blob:) carries no server filename, so skip the fetch
  // entirely — a data: acquisition must never issue a lazy-metadata HEAD.
  const downloadUrl = state.info.url ?? "";
  if (WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) return;
  if (!state.info.contentFetchDisabled && isHttpDownloadUrl(downloadUrl)) {
    try {
      const metadata = await resolveHead(state.info);
      if (metadata.contentDisposition) {
        const dispositionName = getFilenameFromContentDisposition(
          metadata.contentDisposition,
          FIREFOX_CONTENT_DISPOSITION_COMPATIBILITY,
        );
        state.info.filename = dispositionName || state.info.filename;
      }
    } catch {
      // HEAD is best-effort; acquisition still proceeds with the resolved name.
    }
  }
  // Firefox supplies this exact name to downloads.download. Chrome leaves it
  // unset until onDeterminingFilename reports the browser's resolved name.
  state.info.resolvedFilename = state.info.filename;
};

const finalizeFullPathWithMimeExtension = (
  _state: FinalizableDownloadState,
  mimeExtension: string | undefined,
): string => {
  let finalDir = _state.path.finalize();
  let finalFilename;
  let finalFilenameIsRoutePath = false;
  // rename: edits only the final filename component of the matched rule's
  // output — after variable/capture expansion and disposition resolution,
  // before truncation and sanitization. The directory part is never parsed:
  // slashes a replacement introduces are sanitized as ordinary characters.
  const renameResolved = _state.scratch?.renameResolved;
  const renameComponent = (value: string): string =>
    renameResolved ? applyRenameTransform(value, renameResolved) : value;

  if (_state.route && _state.routeIsFolder) {
    // §8.1: a folder-only rule (its `into:` ends with "/") routes into a
    // directory and keeps the download's real name — the browser's
    // Content-Disposition/MIME-resolved filename (or the URL/CD name on
    // Firefox) — instead of naming the file after the folder.
    const routeDir = String(_state.route.finalize()).replace(/\/+$/, "");
    finalDir = [finalDir, routeDir].filter((x) => x != null && x !== "").join("/");
    finalFilename =
      typeof _state.info.filename === "string" ? renameComponent(_state.info.filename) : undefined;
  } else if (_state.route) {
    // The rule sets the whole name (which may itself include subdirectories)
    finalFilename = _state.route.finalize({
      finalComponentIsFilename: true,
      ...(renameResolved ? { transformFinalComponent: renameComponent } : {}),
    });
    finalFilenameIsRoutePath = true;
  } else {
    finalFilename = typeof _state.info.filename === "string" ? _state.info.filename : undefined;
  }

  // §8.1: append a MIME-derived extension when the resolved filename has none
  // (extensionless CDN / query-suffix URLs). The extension is resolved once,
  // asynchronously, in renameAndDownload and stashed on scratch.
  if (mimeExtension && finalFilename && !EXTENSION_REGEX.test(finalFilename)) {
    finalFilename = `${finalFilename}.${mimeExtension}`;
  }

  if (finalFilename) {
    if (finalFilenameIsRoutePath) {
      const components = finalFilename.split("/");
      const filename = components.pop() as string;
      components.push(sanitizeFilename(filename, options.truncateLength, true, true));
      finalFilename = components.join("/");
    } else {
      // Server-, URL-, and browser-derived names are one untrusted component.
      // Only explicit route paths may introduce destination subdirectories.
      finalFilename = sanitizeFilename(finalFilename, options.truncateLength, true, true);
    }
  }

  const finalFullPath = [finalDir, finalFilename].filter((x) => x != null).join("/");

  return finalFullPath.replace(/^\.\//, "").replace(/^\//, "");
};

export const finalizeFullPathWithoutMimeExtension = (state: FinalizableDownloadState): string =>
  finalizeFullPathWithMimeExtension(state, undefined);

export const finalizeFullPath = (state: FinalizableDownloadState): string =>
  finalizeFullPathWithMimeExtension(state, state.scratch?.mimeExtension);
