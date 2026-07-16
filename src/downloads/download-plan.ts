import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { getDownloadHeaders, getFetchReferer } from "./headers.ts";
import {
  isRenameOnlyEligibleRule,
  matchRules,
  matchRulesDetailed,
  type RuleMatch,
} from "../routing/router.ts";
import { expandFetchUrl, isUsableFetchRewrite } from "../routing/fetch-url.ts";
import { Path, sanitizeFilename } from "../routing/path.ts";
import { applyVariables, mimeToExtension, resolveMime } from "../routing/variable.ts";
import { options } from "../config/options-data.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "../routing/filename.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import type { DownloadPipelineState, DownloadPlan } from "./download-types.ts";
import { downloadRuntime } from "./download-runtime-instance.ts";
import { finalizeFullPath, resolveDispositionFilename } from "./download-disposition.ts";
import { ensureHistoryEntry } from "./history-entry.ts";
import {
  addDownloadLog,
  isHttpDownloadUrl,
  releaseUnusedContent,
  requireDownloadUrl,
} from "./download-pipeline-state.ts";

export const getRoutingMatch = (state: Pick<DownloadPipelineState, "info">): RuleMatch | null => {
  if (state.info.routingDisabled) return null;
  const filenamePatterns = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  if (filenamePatterns.length === 0) {
    return null;
  }

  return matchRulesDetailed(filenamePatterns, state.info);
};

// Ordinary browser downloads and post-start filename re-evaluation can only
// rename a download that is already in flight, so URL-rewriting rules are
// skipped there instead of consuming the match.
export const getRoutingMatches = (state: Pick<DownloadPipelineState, "info">): string | null => {
  if (state.info.routingDisabled) return null;
  const filenamePatterns = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  if (filenamePatterns.length === 0) {
    return null;
  }

  return matchRules(filenamePatterns, state.info, isRenameOnlyEligibleRule);
};

// A fetch: rewrite retargets the download, so every artifact derived from the
// original URL — resolved head metadata, hash, prefetched content, the
// MIME-derived extension, and URL-derived names — is stale and must be
// recomputed against the rewritten URL.
export const applyFetchRewrite = async (
  state: DownloadPipelineState,
  rewrittenUrl: string,
): Promise<void> => {
  await releaseUnusedContent(state);
  delete state.info.headPromise;
  delete state.info.resolvedHead;
  delete state.info.sha256;
  delete state.info.mime;
  delete state.info.mimeExtension;
  delete state.scratch.mimeExtension;
  if (WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) {
    downloadRuntime.movePendingState(state, rewrittenUrl);
  }
  state.info.url = rewrittenUrl;
  const naiveFilename = getFilenameFromUrl(rewrittenUrl);
  const initialFilename = state.info.suggestedFilename || naiveFilename || rewrittenUrl;
  Object.assign(state.info, { naiveFilename, filename: initialFilename, initialFilename });
};

export const resolveDownloadPlan = async (
  state: DownloadPipelineState,
): Promise<DownloadPlan | null> => {
  const url = requireDownloadUrl(state);
  const naiveFilename = getFilenameFromUrl(url);
  const initialFilename = state.info.suggestedFilename || naiveFilename || url;
  Object.assign(state.info, { naiveFilename, filename: initialFilename, initialFilename });
  if (state.path instanceof Path && typeof state.path.raw === "string") {
    state.scratch.pathTemplateRaw = state.path.raw;
  }

  // This must precede the first await so onDeterminingFilename can correlate
  // a download even when variable interpolation yields control.
  if (WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) {
    downloadRuntime.rememberPendingState(state);
  }

  // Firefox attaches Referer to a direct downloads.download request; both
  // browsers use an exact DNR rule for extension-owned metadata/content.
  const downloadHeaders = getDownloadHeaders(state);
  const protectedFetchReferer = getFetchReferer(state);
  state.info.contentFetchDisabled = Boolean(downloadHeaders && !protectedFetchReferer);
  if (protectedFetchReferer) state.info.protectedFetchReferer = protectedFetchReferer;
  else delete state.info.protectedFetchReferer;

  await resolveDispositionFilename(state);
  /* v8 ignore next -- The initial filename assignment above always populates this field. */
  const resolvedFilename = state.info.filename ?? initialFilename;
  state.info.filename = resolvedFilename;

  const filenamePatterns = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  const usesMime = filenamePatterns.some((rule) =>
    rule.some((clause) => clause.name === "mime" || clause.name === "contenttype"),
  );
  if (usesMime) state.info.mime = await resolveMime(state.info);
  const usesResolvedFilename = filenamePatterns.some((rule) =>
    rule.some((clause) => clause.name === "filename" || clause.name === "actualfileext"),
  );
  const usesActualFileExtension = filenamePatterns.some((rule) =>
    rule.some((clause) => clause.name === "actualfileext"),
  );
  if (
    options.appendMimeExtension !== false &&
    usesActualFileExtension &&
    !EXTENSION_REGEX.test(resolvedFilename)
  ) {
    const extension = mimeToExtension(await resolveMime(state.info));
    if (extension) {
      state.info.mimeExtension = extension;
      state.scratch.mimeExtension = extension;
    }
  }

  let routeMatches: string | null = state.scratch.routeTemplateRaw ?? null;
  let fetchTemplate: string | null = state.scratch.fetchTemplateRaw ?? null;
  if (routeMatches === null) {
    const match = getRoutingMatch(state);
    routeMatches = match?.destination ?? null;
    fetchTemplate = match?.fetch ?? null;
  }
  if (routeMatches !== null && fetchTemplate !== null) {
    // Persist both raw templates in every outcome: Chrome's late filename
    // resolution skips fetch rules (a started download can no longer honor a
    // URL rewrite), so it must re-expand this rule's destination from the
    // scratch instead of re-matching and losing or replacing the route.
    state.scratch.routeTemplateRaw = routeMatches;
    state.scratch.fetchTemplateRaw = fetchTemplate;
    const rewrittenUrl = await expandFetchUrl(fetchTemplate, state.info);
    if (isUsableFetchRewrite(rewrittenUrl)) {
      if (rewrittenUrl !== requireDownloadUrl(state)) {
        await applyFetchRewrite(state, rewrittenUrl);
        await resolveDispositionFilename(state);
      }
    } else {
      // The rule still renames and routes; only the rewrite is dropped.
      addDownloadLog(state, "fetch rewrite skipped: expanded address is not usable HTTP(S)", {
        template: fetchTemplate,
      });
    }
  }
  // Click-to-save reuses the previous menu directory only as its unmatched
  // fallback. A matched `into:` route is rooted at Downloads so an earlier
  // folder choice cannot be prefixed onto every later dynamic route (#190).
  if (
    routeMatches &&
    (state.info.context === DOWNLOAD_TYPES.CLICK || state.info.context === DOWNLOAD_TYPES.AUTO)
  )
    state.path = new Path(".");
  state.path = await applyVariables(state.path, state.info);
  if (routeMatches) {
    state.routeIsFolder = /\/\s*$/.test(routeMatches);
    state.route = await applyVariables(new Path(routeMatches), state.info);
  }
  const routeRequired =
    !state.info.routingDisabled && (state.needRouteMatch || options.routeSkipUnmatched);
  // Re-read the URL: a fetch: rewrite above may have retargeted it.
  const downloadUrl = requireDownloadUrl(state);
  const deferRouteRequirement =
    routeRequired &&
    WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion &&
    isHttpDownloadUrl(downloadUrl) &&
    usesResolvedFilename;
  const persistAutomaticRoute =
    typeof state.scratch.routeTemplateRaw === "string" &&
    WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion &&
    isHttpDownloadUrl(downloadUrl);
  if (deferRouteRequirement || persistAutomaticRoute) state.scratch.deferredRouteRequirement = true;
  if (routeRequired && !routeMatches && !deferRouteRequirement) {
    downloadRuntime.forgetPendingState(state);
    return null;
  }

  if (options.appendMimeExtension !== false) {
    const tentative =
      state.route && !state.routeIsFolder
        ? state.route.finalize({ finalComponentIsFilename: true })
        : // The fetch: rewrite may have replaced the resolved filename.
          sanitizeFilename(
            /* v8 ignore next -- Both filename writers since the assignment above (applyFetchRewrite, resolveDispositionFilename) only ever store strings. */
            state.info.filename ?? resolvedFilename,
            options.truncateLength,
            true,
            true,
          );
    if (tentative && !EXTENSION_REGEX.test(tentative)) {
      const ext = mimeToExtension(await resolveMime(state.info));
      if (ext) {
        state.info.mimeExtension = ext;
        state.scratch.mimeExtension = ext;
      }
    }
  }

  return createDownloadPlan(state);
};

export const createDownloadPlan = (state: DownloadPipelineState): DownloadPlan => {
  const finalFullPath = finalizeFullPath(state);
  state.scratch.hasExtension = finalFullPath && finalFullPath.match(EXTENSION_REGEX);
  const noExtensionPrompt = options.promptIfNoExtension && !state.scratch.hasExtension;
  const shiftHeldPrompt =
    options.promptOnShift &&
    state.info.modifiers &&
    typeof state.info.modifiers.find((m) => m === "Shift") !== "undefined";
  const noRuleMatchedPrompt = options.routeFailurePrompt && !state.route;
  const prompt =
    state.info.suppressPrompt === true
      ? false
      : state.info.forcePrompt === true ||
        options.prompt ||
        noExtensionPrompt ||
        shiftHeldPrompt ||
        noRuleMatchedPrompt;

  const historyEntryId = ensureHistoryEntry(state, finalFullPath);

  return { state, finalFullPath, prompt, historyEntryId };
};
