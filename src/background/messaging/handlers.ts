import { webExtensionApi } from "../../platform/web-extension-api.ts";

import { splitLines } from "../../shared/util.ts";
import { MESSAGE_TYPES, DOWNLOAD_TYPES } from "../../shared/constants.ts";
import { applyVariables, transformers } from "../../routing/variable.ts";
import { Path } from "../../routing/path.ts";
import { OptionsManagement } from "../../config/option.ts";
import { options } from "../../config/options-data.ts";
import { buildTree } from "../../menus/menu-tree.ts";
import { matcherFunctions, parseRulesCollecting, traceRules } from "../../routing/router.ts";
import { launchDownload } from "../../downloads/download.ts";
import { createSourceSidecarRequest } from "../../downloads/source-sidecar.ts";
import { currentTab, type CurrentTab } from "../../platform/current-tab.ts";
import type { DownloadInfo, DownloadPipelineState } from "../../downloads/download-types.ts";
import { backgroundRuntime } from "../runtime.ts";
import { fromWireDownloadState, toWireDownloadState } from "../../downloads/wire-state.ts";
import type { InternalEvent, MessageOf, ResponseFor } from "../../shared/message-protocol.ts";
import { applyConfigSerialized } from "../config-apply.ts";
import { configWriteState } from "../application-state.ts";
import { getPersistenceDiagnostics } from "../../shared/persistence-diagnostics.ts";
import { previewRoutes } from "../route-preview.ts";
import { isEligibleAutomaticRoutingRule } from "../../automation/automatic-routing.ts";
import { PAGE_SOURCE_KINDS } from "../../shared/page-source.ts";
import { INTEGRATION_GRAMMARS } from "../integration-grammars.ts";
import {
  AUTOMATIC_CONTEXT,
  AUTOMATIC_PAGE_MATCHERS,
  AUTOMATIC_SOURCE_MATCHERS,
} from "../../routing/automatic-rule.ts";
import { getFilenameFromUrl } from "../../routing/filename.ts";
import {
  createExternalValidationRateLimiter,
  externalValidationRequestError,
  hasUnsafeExternalRegex,
} from "../external-validation.ts";
import { createSourcePanelCopy } from "../../shared/source-panel-copy.ts";
import {
  API_CAPABILITIES,
  API_ERRORS,
  API_VERSION,
  isValidDownloadUrl,
  type MessageSender,
  type ProtocolSendResponse,
} from "./protocol.ts";

export const sourcePanelCopies = new Map<string, ReturnType<typeof createSourcePanelCopy>>();
const allowExternalValidation = createExternalValidationRateLimiter();

export const resetMessagingTransientState = (): void => {
  sourcePanelCopies.clear();
  allowExternalValidation.reset();
};

export const getUntrustedValidationRejection = (
  request: MessageOf<typeof MESSAGE_TYPES.VALIDATE>,
  sender: MessageSender,
): ResponseFor<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>["body"] | undefined => {
  const requestError = externalValidationRequestError(request.body);
  if (requestError) {
    return {
      status: MESSAGE_TYPES.ERROR,
      error: API_ERRORS.BAD_REQUEST,
      message: requestError,
    };
  }
  if (!allowExternalValidation(sender.id || "unknown")) {
    return {
      status: MESSAGE_TYPES.ERROR,
      error: API_ERRORS.RATE_LIMITED,
      message: "Too many validation requests",
    };
  }
  return undefined;
};

export const handlePing = (
  _request: MessageOf<typeof MESSAGE_TYPES.PING>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.PING>>,
): void => {
  sendResponse({
    type: MESSAGE_TYPES.PONG,
    body: {
      version: API_VERSION,
      capabilities: API_CAPABILITIES.slice(),
    },
  });
};

// Live routing/variable preview for the options page. Async because
// Variable interpolation and route checking may await.
export const handleCheckRoutes = async (
  request: MessageOf<typeof MESSAGE_TYPES.CHECK_ROUTES>,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.CHECK_ROUTES>>,
): Promise<void> => {
  const lastState =
    (request.body?.state && fromWireDownloadState(request.body.state)) ||
    (backgroundRuntime.lastDownloadState != null && backgroundRuntime.lastDownloadState);

  let interpolatedVariables: Record<string, string> | null = null;
  if (lastState) {
    const keys = Object.keys(transformers);
    // Preview only: :counter: peeks instead of consuming a value
    const previewInfo = Object.assign({}, lastState.info, {
      now: lastState.info.now instanceof Date ? lastState.info.now : new Date(),
      preview: true,
    });
    const interpolationEntries = await Promise.all(
      keys.map(async (key) => {
        const path = await applyVariables(new Path(key), previewInfo);
        return [key, path.finalize()] as const;
      }),
    );
    interpolatedVariables = Object.fromEntries(interpolationEntries);
  }

  // The legacy no-state path evaluates to false; checkRoutes treats every
  // nullish/falsy input as an empty preview.
  const routeInfo = await previewRoutes(lastState || null);

  sendResponse({
    type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
    body: {
      optionErrors: backgroundRuntime.optionErrors,
      routeInfo,
      lastDownload:
        backgroundRuntime.lastDownloadState == null
          ? backgroundRuntime.lastDownloadState
          : toWireDownloadState(backgroundRuntime.lastDownloadState),
      interpolatedVariables,
      persistenceErrors: getPersistenceDiagnostics(),
    },
  });
};

// ─── Scriptable / AI-assisted configuration (docs/INTEGRATIONS.md §4) ───

// Read-only: the option schema (name, type, default, human description) so an
// agent knows what it may set. Safe to expose externally.
export const handleGetSchema = (
  _request: MessageOf<typeof MESSAGE_TYPES.GET_SCHEMA>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_SCHEMA>>,
): void => {
  sendResponse({
    type: MESSAGE_TYPES.SCHEMA,
    body: {
      version: API_VERSION,
      options: OptionsManagement.OPTION_KEYS.map((k) => ({
        name: k.name,
        type: k.type,
        default: k.default,
        description: OptionsManagement.OPTION_DESCRIPTIONS[k.name] || "",
      })),
    },
  });
};

// Internal-only readback uses the persisted representation accepted by
// APPLY_CONFIG. Runtime values such as parsed routing rules are deliberately
// not exposed because they cannot be safely round-tripped by an agent.
export const handleGetConfig = async (
  _request: MessageOf<typeof MESSAGE_TYPES.GET_CONFIG>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_CONFIG>>,
): Promise<void> => {
  const keys = OptionsManagement.getKeys();
  const stored = await webExtensionApi.storage.local.get(keys);
  const config = Object.fromEntries(
    OptionsManagement.OPTION_KEYS.map((key) => {
      const value = stored[key.name];
      const validStoredType =
        key.type === OptionsManagement.OPTION_TYPES.BOOL
          ? typeof value === "boolean"
          : (typeof value === "string" || typeof value === "number") &&
            (typeof value !== "number" || Number.isFinite(value));
      return [key.name, validStoredType ? value : key.default];
    }),
  ) as Record<string, string | number | boolean>;
  sendResponse({
    type: MESSAGE_TYPES.CONFIG,
    body: { version: API_VERSION, config },
  });
};

export const handleGetKeywords = (
  _request: MessageOf<typeof MESSAGE_TYPES.GET_KEYWORDS>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_KEYWORDS>>,
): void => {
  sendResponse({
    type: MESSAGE_TYPES.KEYWORD_LIST,
    body: {
      matchers: [...Object.keys(matcherFunctions), "css"],
      variables: Object.keys(transformers),
      automaticMatchers: [...AUTOMATIC_PAGE_MATCHERS, ...AUTOMATIC_SOURCE_MATCHERS],
      // Context matchers normalize their input before testing. Expose the
      // value an integration should place in its case-sensitive pattern,
      // not the internal synthetic event sentinel.
      automaticContext: AUTOMATIC_CONTEXT.toLowerCase(),
      sourceKinds: [...PAGE_SOURCE_KINDS],
    },
  });
};

export const handleGetGrammars = (
  _request: MessageOf<typeof MESSAGE_TYPES.GET_GRAMMARS>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_GRAMMARS>>,
): void => {
  sendResponse({
    type: MESSAGE_TYPES.GRAMMAR_LIST,
    body: {
      version: API_VERSION,
      grammars: INTEGRATION_GRAMMARS.map((grammar) => ({
        ...grammar,
        semantics: [...grammar.semantics],
        examples: [...grammar.examples],
      })),
    },
  });
};

// Read-only: dry-run the two grammars and return structured errors + a menu
// preview, without saving anything. Powers an agent's generate→validate→fix
// loop and the options-page "paste config" affordance. Safe externally.
export const handleValidate = async (
  request: MessageOf<typeof MESSAGE_TYPES.VALIDATE>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>,
  external = false,
): Promise<void> => {
  const body = request.body || {};
  const result: Extract<
    ResponseFor<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>,
    { type: typeof MESSAGE_TYPES.VALIDATE_RESULT }
  >["body"] = { version: API_VERSION };

  if (typeof body.paths === "string") {
    const pathsArray = splitLines(body.paths);
    const tree = buildTree(pathsArray);
    result.menuPreview = tree.items;
    result.pathErrors = tree.errors;
  }
  if (typeof body.filenamePatterns === "string") {
    const parsed = parseRulesCollecting(body.filenamePatterns);
    if (external && hasUnsafeExternalRegex(parsed.rules)) {
      sendResponse({
        type: MESSAGE_TYPES.VALIDATE,
        body: {
          status: MESSAGE_TYPES.ERROR,
          error: API_ERRORS.BAD_REQUEST,
          message: "Validation rules contain an unsafe regular expression",
        },
      });
      return;
    }
    result.ruleErrors = parsed.errors;
    if (body.info && typeof body.info === "object" && !Array.isArray(body.info)) {
      const { now, ...wireInfo } = body.info;
      const normalizedInfo = {
        ...wireInfo,
        ...(now ? { now: new Date(now) } : {}),
      };
      const traceInfo =
        external && !Object.hasOwn(body.info, "currentTab")
          ? { ...normalizedInfo, currentTab: null }
          : normalizedInfo;
      result.ruleTrace = await traceRules(parsed.rules, traceInfo);
    }
    if (body.automaticCandidate) {
      const candidate = body.automaticCandidate;
      const suggestedFilename =
        candidate.suggestedFilename || getFilenameFromUrl(candidate.sourceUrl);
      result.automaticTrace = await traceRules(
        parsed.rules,
        {
          context: AUTOMATIC_CONTEXT,
          pageUrl: candidate.pageUrl,
          sourceUrl: candidate.sourceUrl,
          url: candidate.sourceUrl,
          sourceKind: candidate.sourceKind,
          mediaType: candidate.sourceKind,
          ...(suggestedFilename
            ? {
                suggestedFilename,
                filename: suggestedFilename,
                initialFilename: suggestedFilename,
              }
            : {}),
        },
        isEligibleAutomaticRoutingRule,
      );
    }
  }

  sendResponse({ type: MESSAGE_TYPES.VALIDATE_RESULT, body: result });
};

// Mutating: apply a partial options object, validated against the schema
// (unknown keys and type mismatches rejected). onSave normalises the stored
// form; the load-time onLoad validators still coerce cross-browser-invalid
// values, so this can't silently break downloads (#89). INTERNAL ONLY —
// rewriting a user's config is not something an arbitrary extension may do.
export const handleApplyConfig = async (
  request: MessageOf<typeof MESSAGE_TYPES.APPLY_CONFIG>,
  _sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.APPLY_CONFIG>>,
): Promise<void> => {
  const config = (request.body && request.body.config) || {};
  const { applied, rejected } = await applyConfigSerialized(
    configWriteState,
    webExtensionApi.storage.local,
    config,
    request.body?.expected,
    () => backgroundRuntime.reset(),
  );

  sendResponse({
    type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
    body: { version: API_VERSION, applied, rejected },
  });
};

// Fires off and does not expect a return value
export const emitDownloaded = (state: DownloadPipelineState): void => {
  // In MV3 sendMessage rejects when no receiver (options page) is open;
  // that is expected, so swallow it rather than leak an unhandled rejection
  const event: InternalEvent = {
    type: MESSAGE_TYPES.DOWNLOADED,
    body: { state: toWireDownloadState(state) },
  };
  webExtensionApi.runtime.sendMessage(event).catch(() => {});
};

/**
 * Official, versioned DOWNLOAD API for external extensions (issue #110).
 * Other extensions push a URL into save-in's routing/rename pipeline by
 * sending this message; PING first to negotiate the version. The user must
 * allow the caller's browser-authenticated sender.id before DOWNLOAD reaches
 * this handler.
 *
 * Request:  { type: "DOWNLOAD", body: { url, info?, comment?, version? } }
 * Response: { type: "DOWNLOAD", body: { status: "OK", version, url } }
 *      or:  { type: "DOWNLOAD", body: { status: "ERROR", error, message, version } }
 *
 * See docs/INTEGRATIONS.md and
 * https://github.com/gyng/save-in/wiki/Integrations
 *
 * In Foxy Gestures:
 *
 * const source = data.element.mediaInfo && data.element.mediaInfo.source;
 *
 * if (source) {
 *   const payload = {
 *     type: "DOWNLOAD",
 *       body: {
 *         url: source,
 *         // You can use `comment` for targeting in routing rules
 *         info: { pageUrl: `${window.location}`, srcUrl: source, comment: "foo" }
 *       }
 *   };
 *
 *   // The user must first allow Foxy Gestures' own extension ID in Save In.
 *   // The destination ID below is Save In's ID, obtained from manifest.json.
 *   webExtensionApi.runtime.sendMessage("{72d92df5-2aa0-4b06-b807-aa21767545cd}", payload);
 * }
 */
export const handleDownloadMessage = (
  request: MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>>,
  internal = false,
): Promise<void> | void => {
  const requestBody = request.body || {};
  const { url: requestedUrl, target, comment } = requestBody;
  // Callers may pin a version; default to the current one
  const version = requestBody.version || API_VERSION;

  // Validate before triggering a download: external callers are untrusted,
  // and a malformed message should get typed feedback, not silent failure.
  const fail = (error: string, message: string): void =>
    sendResponse({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.ERROR, error, message, version },
    });
  const launch = (
    url: string,
    resolvedTab: CurrentTab | null = (sender && sender.tab) || currentTab,
  ): Promise<void> | void => {
    if (!isValidDownloadUrl(url)) {
      fail(API_ERRORS.INVALID_URL, "URL must be http(s), ftp, data or blob");
      return;
    }

    // The external DOWNLOAD API may omit info
    const info = requestBody.info || {};
    const last = backgroundRuntime.lastDownloadState;

    const opts: DownloadInfo = {
      // Prefer the tab the message came from over the tracked global (#172).
      currentTab: resolvedTab,
      now: new Date(),
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      selectedUrl: url,
      webhookEligible: sender.id === webExtensionApi.runtime.id,
      linkText: info.linkText,
      sourceUrl: info.srcUrl,
      menuIndex: info.menuIndex,
      comment: info.comment,
      modifiers: info.modifiers,
      suggestedFilename: info.suggestedFilename,
      mime: info.mime,
      mediaType: info.mediaType,
      sourceKind: info.sourceKind,
      ...(internal && info.matchedCssSelectorsByOrigin
        ? { matchedCssSelectorsByOrigin: info.matchedCssSelectorsByOrigin }
        : {}),
      url,
      context: DOWNLOAD_TYPES.CLICK,
    };

    // Useful for passing in from external extensions
    if (comment) {
      opts.comment = comment;
    }

    // Reuse the last download's directory and routing metadata
    // (comment/menuindex rules stay usable), but never its route, filenames,
    // or scratch: those describe a different URL, and inheriting them names
    // this download after the previous one. renameAndDownload re-evaluates
    // the routing rules and filenames for this URL.
    const clickState: DownloadPipelineState = {
      path: last?.path || new Path("."),
      scratch: {},
      info: {
        ...opts,
        menuIndex: opts.menuIndex ?? last?.info.menuIndex,
        comment: opts.comment ?? last?.info.comment,
      },
    };

    if (
      resolvedTab?.incognito !== true &&
      sender.id === webExtensionApi.runtime.id &&
      info.sourceKind &&
      info.sourceKind !== "link" &&
      options.saveSourceSidecar
    ) {
      clickState.scratch.sourceSidecar = createSourceSidecarRequest(
        clickState,
        url,
        resolvedTab?.title,
      );
    }

    // Keep the MV3 message event alive through routing, lazy variables and the
    // downloads API call. The response still acknowledges browser acceptance,
    // not eventual download completion.
    return launchDownload(clickState).then(() => {
      // Acknowledge the accepted primary save before doing optional child
      // work. Content-script batches must not wait for a second download,
      // and a sidecar failure must never turn the primary save into a retry.
      sendResponse({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version, url },
      });
    });
  };

  // An explicit URL always wins, even when a reusable recipe also includes a
  // target. This keeps existing callers deterministic.
  if (typeof requestedUrl === "string" && requestedUrl) {
    return launch(requestedUrl);
  }
  if (target !== "activeTab") {
    fail(API_ERRORS.BAD_REQUEST, "Missing or non-string 'url'");
    return;
  }

  // Cross-add-on commands such as Gesturefy's are sent from the other
  // extension's background context, so sender.tab is often absent. Query the
  // last-focused window instead of relying on Save In's lifecycle-bound tab
  // mirror; prefer sender.tab when the caller did originate in a tab.
  if (sender && sender.tab && sender.tab.url) {
    return launch(sender.tab.url, sender.tab);
  }
  return webExtensionApi.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then((tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) {
        fail(API_ERRORS.BAD_REQUEST, "No active tab with a URL was found");
        return;
      }
      return launch(tab.url, tab);
    })
    .then(() => undefined);
};
