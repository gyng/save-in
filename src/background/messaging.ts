import { webExtensionApi } from "../platform/web-extension-api.ts";

import { splitLines, withUrl } from "../shared/util.ts";
import { MESSAGE_TYPES, DOWNLOAD_TYPES } from "../shared/constants.ts";
import { applyVariables, transformers } from "../routing/variable.ts";
import { Path } from "../routing/path.ts";
import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { buildTree } from "../menus/menu-tree.ts";
import { matcherFunctions, parseRulesCollecting, traceRules } from "../routing/router.ts";
import { Download } from "../downloads/download.ts";
import { createSourceSidecarRequest } from "../downloads/source-sidecar.ts";
import { Notifier } from "../downloads/notification.ts";
import { currentTab, type CurrentTab } from "../platform/current-tab.ts";
import { configureDownloadEvents } from "../downloads/download-events.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";
import { backgroundRuntime } from "./runtime.ts";
import {
  getMessageType,
  fromWireDownloadState,
  EXTERNAL_MESSAGE_TYPES,
  isExternalMessage,
  isInternalMessage,
  toWireDownloadState,
  type ExternalMessage,
  type InternalEvent,
  type InternalMessage,
  type MessageOf,
  type ResponseFor,
} from "../shared/message-protocol.ts";
import { respondAsync, type SendResponse } from "./message-dispatch.ts";
import { Log } from "./log.ts";
import { SaveHistory } from "./history.ts";
import { applyConfigSerialized } from "./config-apply.ts";
import { configWriteState } from "./state.ts";
import { getPersistenceDiagnostics } from "../shared/persistence-diagnostics.ts";
import { syncSourcePanelToTab, setSourcePanelOpenState } from "./source-panel-state.ts";
import { previewRoutes } from "./route-preview.ts";
import { ActiveTransfers } from "../downloads/active-transfers.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { ExternalDownloadRejections } from "./external-download-rejections.ts";
import { getMessage } from "../platform/localization.ts";
import { createSourcePanelCopy } from "../shared/source-panel-copy.ts";
import {
  isEligibleAutomaticRoutingRule,
  matchAutomaticRoutingRule,
} from "../automation/automatic-routing.ts";
import { PAGE_SOURCE_KINDS } from "../shared/page-source.ts";
import { INTEGRATION_GRAMMARS } from "./integration-grammars.ts";
import {
  AUTOMATIC_CONTEXT,
  AUTOMATIC_PAGE_MATCHERS,
  AUTOMATIC_SOURCE_MATCHERS,
} from "../routing/automatic-rule.ts";
import { createSourceRuleDraft } from "../automation/source-rule-draft.ts";
import { SOURCE_RULE_DRAFT_SESSION_KEY } from "../shared/storage-keys.ts";
import { getFilenameFromUrl } from "../routing/filename.ts";
import {
  createExternalValidationRateLimiter,
  externalValidationRequestError,
  hasUnsafeExternalRegex,
} from "./external-validation.ts";
import { getDiagnosticSnapshot, recordDiagnosticLifecycle } from "./diagnostics.ts";

export type MessageSender = { id?: string | undefined; tab?: CurrentTab | undefined };
type ProtocolSendResponse<Request extends InternalMessage> = SendResponse<ResponseFor<Request>>;
const sourcePanelCopies = new Map<string, ReturnType<typeof createSourcePanelCopy>>();
const allowExternalValidation = createExternalValidationRateLimiter();

export const resetMessagingTransientState = (): void => {
  sourcePanelCopies.clear();
  allowExternalValidation.reset();
};

const getUntrustedValidationRejection = (
  request: MessageOf<typeof MESSAGE_TYPES.VALIDATE>,
  sender: MessageSender,
): ResponseFor<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>["body"] | undefined => {
  const requestError = externalValidationRequestError(request.body);
  if (requestError) {
    return {
      status: MESSAGE_TYPES.ERROR,
      error: Messaging.API_ERRORS.BAD_REQUEST,
      message: requestError,
    };
  }
  if (!allowExternalValidation(sender.id || "unknown")) {
    return {
      status: MESSAGE_TYPES.ERROR,
      error: Messaging.API_ERRORS.RATE_LIMITED,
      message: "Too many validation requests",
    };
  }
  return undefined;
};

export const Messaging = {
  // ─── External DOWNLOAD API (issue #110) ────────────────────────────────
  // Versioned, supported contract for other extensions to push a URL into
  // save-in's routing/rename pipeline. Callers should PING first to discover
  // the version and capabilities. Documented in docs/INTEGRATIONS.md.
  API_VERSION: 1,
  API_CAPABILITIES: [
    "download", // { type: "DOWNLOAD", body: { url, info?, comment?, version? } }
    "active_tab", // body.target:"activeTab" resolves the originating or active browser tab
    "ping", // { type: "PING" } -> { version, capabilities }
    "routing", // the URL runs through the user's rename/route rules
    "comment", // body.comment is targetable in routing rules
    "info", // body.info fields: pageUrl, srcUrl, selectionText, menuIndex, ...
    "schema", // { type: "GET_SCHEMA" } -> the option schema (read-only)
    "vocabulary", // GET_KEYWORDS includes routing and automatic-routing vocabulary
    "grammar", // GET_GRAMMARS returns the supported EBNF and semantic constraints
    "validate", // VALIDATE dry-runs both editable grammars (read-only)
    "automatic_routing_validation", // routing rules can include an automatic-source trace
    "sender_allowlist", // DOWNLOAD requires the browser-authenticated sender.id to be allowed
    // apply_config (mutating) is intentionally NOT advertised: it is reachable
    // only from same-extension callers, not onMessageExternal
  ],
  API_ERRORS: {
    BAD_REQUEST: "BAD_REQUEST", // malformed message (e.g. missing url)
    INVALID_URL: "INVALID_URL", // url is not a fetchable http(s)/ftp/data URL
    RATE_LIMITED: "RATE_LIMITED", // caller exceeded the bounded validation burst rate
    UNAUTHORIZED: "UNAUTHORIZED", // caller is not in the user's external-download allowlist
    UNKNOWN_TYPE: "UNKNOWN_TYPE", // unrecognised message type
  },

  // The manifest stays open so users can choose integrations dynamically;
  // sender.id is browser-authenticated and enforces that choice at runtime.
  isExternalDownloadAllowed: (sender: MessageSender): boolean =>
    typeof sender.id === "string" &&
    splitLines(options.externalDownloadAllowlist).some((id) => id === sender.id),

  // Only schemes the downloads pipeline can actually fetch are accepted from
  // external callers — this keeps javascript:/file:/extension: URLs from being
  // turned into downloads by another extension.
  isValidDownloadUrl: (url: unknown): boolean => {
    if (!url || typeof url !== "string") {
      return false;
    }
    // blob: is included because the extension downloads fetched content via
    // blob URLs on Firefox (data: URLs are rejected there by downloads.download)
    return withUrl(
      url,
      (u) => ["http:", "https:", "ftp:", "data:", "blob:"].includes(u.protocol),
      false,
    );
  },

  handlePing: (
    _request: MessageOf<typeof MESSAGE_TYPES.PING>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.PING>>,
  ): void => {
    sendResponse({
      type: MESSAGE_TYPES.PONG,
      body: {
        version: Messaging.API_VERSION,
        capabilities: Messaging.API_CAPABILITIES.slice(),
      },
    });
  },

  // Live routing/variable preview for the options page. Async because
  // Variable interpolation and route checking may await.
  handleCheckRoutes: async (
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
  },

  // ─── Scriptable / AI-assisted configuration (docs/INTEGRATIONS.md §4) ───

  // Read-only: the option schema (name, type, default, human description) so an
  // agent knows what it may set. Safe to expose externally.
  handleGetSchema: (
    _request: MessageOf<typeof MESSAGE_TYPES.GET_SCHEMA>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_SCHEMA>>,
  ): void => {
    sendResponse({
      type: MESSAGE_TYPES.SCHEMA,
      body: {
        version: Messaging.API_VERSION,
        options: OptionsManagement.OPTION_KEYS.map((k) => ({
          name: k.name,
          type: k.type,
          default: k.default,
          description: OptionsManagement.OPTION_DESCRIPTIONS[k.name] || "",
        })),
      },
    });
  },

  // Internal-only readback uses the persisted representation accepted by
  // APPLY_CONFIG. Runtime values such as parsed routing rules are deliberately
  // not exposed because they cannot be safely round-tripped by an agent.
  handleGetConfig: async (
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
      body: { version: Messaging.API_VERSION, config },
    });
  },

  handleGetKeywords: (
    _request: MessageOf<typeof MESSAGE_TYPES.GET_KEYWORDS>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_KEYWORDS>>,
  ): void => {
    sendResponse({
      type: MESSAGE_TYPES.KEYWORD_LIST,
      body: {
        matchers: Object.keys(matcherFunctions),
        variables: Object.keys(transformers),
        automaticMatchers: [...AUTOMATIC_PAGE_MATCHERS, ...AUTOMATIC_SOURCE_MATCHERS],
        // Context matchers normalize their input before testing. Expose the
        // value an integration should place in its case-sensitive pattern,
        // not the internal synthetic event sentinel.
        automaticContext: AUTOMATIC_CONTEXT.toLowerCase(),
        sourceKinds: [...PAGE_SOURCE_KINDS],
      },
    });
  },

  handleGetGrammars: (
    _request: MessageOf<typeof MESSAGE_TYPES.GET_GRAMMARS>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.GET_GRAMMARS>>,
  ): void => {
    sendResponse({
      type: MESSAGE_TYPES.GRAMMAR_LIST,
      body: {
        version: Messaging.API_VERSION,
        grammars: INTEGRATION_GRAMMARS.map((grammar) => ({
          ...grammar,
          semantics: [...grammar.semantics],
          examples: [...grammar.examples],
        })),
      },
    });
  },

  // Read-only: dry-run the two grammars and return structured errors + a menu
  // preview, without saving anything. Powers an agent's generate→validate→fix
  // loop and the options-page "paste config" affordance. Safe externally.
  handleValidate: async (
    request: MessageOf<typeof MESSAGE_TYPES.VALIDATE>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>,
    external = false,
  ): Promise<void> => {
    const body = request.body || {};
    const result: Extract<
      ResponseFor<MessageOf<typeof MESSAGE_TYPES.VALIDATE>>,
      { type: typeof MESSAGE_TYPES.VALIDATE_RESULT }
    >["body"] = { version: Messaging.API_VERSION };

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
            error: Messaging.API_ERRORS.BAD_REQUEST,
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
  },

  // Mutating: apply a partial options object, validated against the schema
  // (unknown keys and type mismatches rejected). onSave normalises the stored
  // form; the load-time onLoad validators still coerce cross-browser-invalid
  // values, so this can't silently break downloads (#89). INTERNAL ONLY —
  // rewriting a user's config is not something an arbitrary extension may do.
  handleApplyConfig: async (
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
      body: { version: Messaging.API_VERSION, applied, rejected },
    });
  },

  // Fires off and does not expect a return value
  emit: {
    downloaded: (state: DownloadPipelineState): void => {
      // In MV3 sendMessage rejects when no receiver (options page) is open;
      // that is expected, so swallow it rather than leak an unhandled rejection
      const event: InternalEvent = {
        type: MESSAGE_TYPES.DOWNLOADED,
        body: { state: toWireDownloadState(state) },
      };
      webExtensionApi.runtime.sendMessage(event).catch(() => {});
    },
  },

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
  handleDownloadMessage: (
    request: MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>,
    sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>>,
  ): Promise<void> | void => {
    const requestBody = request.body || {};
    const { url: requestedUrl, target, comment } = requestBody;
    // Callers may pin a version; default to the current one
    const version = requestBody.version || Messaging.API_VERSION;

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
      if (!Messaging.isValidDownloadUrl(url)) {
        fail(Messaging.API_ERRORS.INVALID_URL, "URL must be http(s), ftp, data or blob");
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
      return Download.launch(clickState).then(() => {
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
      fail(Messaging.API_ERRORS.BAD_REQUEST, "Missing or non-string 'url'");
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
          fail(Messaging.API_ERRORS.BAD_REQUEST, "No active tab with a URL was found");
          return;
        }
        return launch(tab.url, tab);
      })
      .then(() => undefined);
  },

  handleAutoDownloadSource: async (
    request: MessageOf<typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE>,
    sender: MessageSender,
    sendResponse: ProtocolSendResponse<MessageOf<typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE>>,
  ): Promise<void> => {
    const skip = () =>
      sendResponse({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    const senderTab = sender.tab;
    const sourceUrl = request.body.sourceUrl;
    if (
      options.autoDownloadEnabled !== true ||
      !senderTab?.url ||
      (senderTab.incognito === true && options.autoDownloadPrivate !== true)
    ) {
      skip();
      return;
    }
    let sourceProtocol = "";
    try {
      sourceProtocol = new URL(sourceUrl).protocol;
    } catch {
      skip();
      return;
    }
    if (sourceProtocol !== "http:" && sourceProtocol !== "https:") {
      skip();
      return;
    }
    const rules = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
    const match = matchAutomaticRoutingRule(rules, {
      pageUrl: senderTab.url,
      sourceUrl,
      sourceKind: request.body.sourceKind,
    });
    if (!match) {
      skip();
      return;
    }

    const result = await Download.launch({
      path: new Path("."),
      scratch: { routeTemplateRaw: match.destination },
      info: {
        currentTab: senderTab,
        now: new Date(),
        pageUrl: senderTab.url,
        selectedUrl: sourceUrl,
        sourceUrl,
        sourceKind: request.body.sourceKind,
        url: sourceUrl,
        context: DOWNLOAD_TYPES.AUTO,
      },
    });
    sendResponse({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: result.status },
    });
  },
};

type Handler<M extends InternalMessage> = (
  request: M,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<M>,
) => void | Promise<void>;

type HandlerTable<M extends InternalMessage> = {
  [T in M["type"]]: Handler<Extract<M, { type: T }>>;
};

const internalHandlers = {
  [MESSAGE_TYPES.WAKE_WARM]: (_request, _sender, sendResponse) => {
    // Sent by content scripts on combo keydown purely to wake the MV3 worker.
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE]: Messaging.handleAutoDownloadSource,
  [MESSAGE_TYPES.SOURCE_PANEL_READY]: async (_request, sender, sendResponse) => {
    if (sender.tab?.id != null) await syncSourcePanelToTab(sender.tab.id);
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.SOURCE_PANEL_STATE]: async (request, _sender, sendResponse) => {
    await setSourcePanelOpenState(Boolean(request.body?.open));
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.SOURCE_PANEL_COPY]: (_request, _sender, sendResponse) => {
    const locale = typeof options.uiLocale === "string" ? options.uiLocale : "";
    let copy = sourcePanelCopies.get(locale);
    if (!copy) {
      copy = createSourcePanelCopy(getMessage);
      sourcePanelCopies.set(locale, copy);
    }
    sendResponse({
      type: MESSAGE_TYPES.SOURCE_PANEL_COPY,
      body: copy,
    });
  },
  [MESSAGE_TYPES.CREATE_SOURCE_RULE]: async (request, sender, sendResponse) => {
    const pageUrl = sender.tab?.url;
    const draft = pageUrl
      ? createSourceRuleDraft(pageUrl, request.body.sourceUrl, request.body.sourceKind)
      : null;
    if (!draft || sender.tab?.incognito === true) {
      sendResponse({
        type: MESSAGE_TYPES.CREATE_SOURCE_RULE,
        body: {
          status: MESSAGE_TYPES.ERROR,
          error: Messaging.API_ERRORS.BAD_REQUEST,
          message: "An automatic rule cannot be created for this source",
        },
      });
      return;
    }
    const storage = webExtensionApi.storage.session ?? webExtensionApi.storage.local;
    await storage.set({ [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: draft } });
    await webExtensionApi.runtime.openOptionsPage();
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.DIAGNOSTICS_GET]: async (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: await getDiagnosticSnapshot(),
    });
  },
  [MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES]: async (_request, _sender, sendResponse) => {
    await Log.clear();
    await recordDiagnosticLifecycle("failures_cleared");
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.HISTORY_GET]: async (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.HISTORY_GET,
      body: { entries: await SaveHistory.get() },
    });
  },
  [MESSAGE_TYPES.HISTORY_CLEAR]: async (_request, _sender, sendResponse) => {
    await SaveHistory.clear();
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.HISTORY_CANCEL]: async (request, _sender, sendResponse) => {
    const { historyId } = request.body;
    const active = ActiveTransfers.get(historyId);
    let canceled = ActiveTransfers.cancel(historyId);
    if (active?.requestId && OffscreenClient.canUse()) {
      await OffscreenClient.cancel(active.requestId).catch(() => {});
    }
    const entry = historyId
      ? (await SaveHistory.get()).find((candidate) => candidate.id === historyId)
      : undefined;
    const downloadId = entry?.downloadId ?? active?.downloadId;
    let shouldRecordCanceled = canceled && downloadId == null;
    if (downloadId != null) {
      try {
        await webExtensionApi.downloads.cancel(downloadId);
        canceled = true;
        const [item] = await webExtensionApi.downloads.search({ id: downloadId });
        // cancel() also resolves for complete, interrupted, or vanished items.
        // Never overwrite a real completion merely because the promise resolved.
        shouldRecordCanceled =
          item?.state === "interrupted" || Boolean(active && item?.state !== "complete");
      } catch {
        // The browser may have completed between the History poll and click.
      }
    }
    if (shouldRecordCanceled) {
      await SaveHistory.setStatus(historyId, "USER_CANCELED", downloadId);
    }
    sendResponse({ type: MESSAGE_TYPES.HISTORY_CANCEL, body: { canceled } });
  },
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET]: async (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
      body: { rejections: await ExternalDownloadRejections.get() },
    });
  },
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR]: async (request, _sender, sendResponse) => {
    await ExternalDownloadRejections.clear(request.body.senderId);
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.OPTIONS_LOADED]: async (_request, _sender, sendResponse) => {
    await backgroundRuntime.reset();
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.OPTIONS]: (_request, _sender, sendResponse) => {
    sendResponse({ type: MESSAGE_TYPES.OPTIONS, body: options });
  },
  [MESSAGE_TYPES.OPTIONS_SCHEMA]: (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: {
        keys: OptionsManagement.OPTION_KEYS.map(({ name, type, default: defaultValue }) => ({
          name,
          type,
          default: defaultValue,
        })),
        types: OptionsManagement.OPTION_TYPES,
      },
    });
  },
  [MESSAGE_TYPES.GET_KEYWORDS]: Messaging.handleGetKeywords,
  [MESSAGE_TYPES.GET_GRAMMARS]: Messaging.handleGetGrammars,
  [MESSAGE_TYPES.PREVIEW_MENUS]: (request, _sender, sendResponse) => {
    const pathsArray = splitLines(request.body?.paths || "");
    sendResponse({ type: MESSAGE_TYPES.MENU_PREVIEW, body: buildTree(pathsArray) });
  },
  [MESSAGE_TYPES.CHECK_ROUTES]: (request, _sender, sendResponse) =>
    Messaging.handleCheckRoutes(request, sendResponse),
  [MESSAGE_TYPES.PING]: Messaging.handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: Messaging.handleGetSchema,
  [MESSAGE_TYPES.GET_CONFIG]: Messaging.handleGetConfig,
  [MESSAGE_TYPES.VALIDATE]: Messaging.handleValidate,
  [MESSAGE_TYPES.APPLY_CONFIG]: Messaging.handleApplyConfig,
  [MESSAGE_TYPES.DOWNLOAD]: Messaging.handleDownloadMessage,
} satisfies HandlerTable<InternalMessage>;

const externalHandlers = {
  [MESSAGE_TYPES.PING]: Messaging.handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: Messaging.handleGetSchema,
  [MESSAGE_TYPES.GET_KEYWORDS]: Messaging.handleGetKeywords,
  [MESSAGE_TYPES.GET_GRAMMARS]: Messaging.handleGetGrammars,
  [MESSAGE_TYPES.VALIDATE]: (request, sender, sendResponse) =>
    Messaging.handleValidate(request, sender, sendResponse, true),
  [MESSAGE_TYPES.DOWNLOAD]: (request, sender, sendResponse) => {
    if (!Messaging.isExternalDownloadAllowed(sender)) {
      return (async () => {
        // Rejected private-window activity is never persisted or surfaced in a
        // system notification; it remains visible only to the calling extension.
        if (sender.id && sender.tab?.incognito !== true) {
          await Promise.allSettled([
            ExternalDownloadRejections.record(sender.id, request.body || {}),
            Notifier.reportExternalDownloadRejection(sender.id),
          ]);
        }
        sendResponse({
          type: MESSAGE_TYPES.DOWNLOAD,
          body: {
            status: MESSAGE_TYPES.ERROR,
            error: Messaging.API_ERRORS.UNAUTHORIZED,
            message: "Allow this extension ID in Save In before requesting downloads",
            version: request.body?.version || Messaging.API_VERSION,
          },
        });
      })();
    }
    return Messaging.handleDownloadMessage(request, sender, sendResponse);
  },
} satisfies HandlerTable<ExternalMessage>;

const READY_MESSAGE_TYPES = new Set<InternalMessage["type"]>([
  MESSAGE_TYPES.OPTIONS,
  MESSAGE_TYPES.SOURCE_PANEL_COPY,
  MESSAGE_TYPES.CHECK_ROUTES,
  MESSAGE_TYPES.DOWNLOAD,
  MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
  MESSAGE_TYPES.CREATE_SOURCE_RULE,
]);

const dispatchMessage = <M extends InternalMessage>(
  request: M,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse<M>,
  handlers: HandlerTable<M>,
): true | void => {
  // The table is exhaustive for M, so this lookup is safe even though TS cannot
  // preserve the correlation between a union's discriminator and mapped value.
  const handler = Reflect.get(handlers, request.type) as unknown as Handler<M>;
  const reportFailure = (error: unknown) => {
    void Log.add(
      "message handler failed",
      {
        type: request.type,
        error: error instanceof Error ? error.message : String(error),
      },
      { privateContext: sender.tab?.incognito === true },
    );
  };
  if (READY_MESSAGE_TYPES.has(request.type) && backgroundRuntime.ready) {
    const task = backgroundRuntime.ready
      .then(() => handler(request, sender, sendResponse))
      .then(() => undefined);
    return respondAsync(request.type, task, sendResponse, reportFailure);
  }
  const result = handler(request, sender, sendResponse);
  if (result instanceof Promise) {
    return respondAsync(request.type, result, sendResponse, reportFailure);
  }
};

// MV3: entry.background calls this synchronously at startup so a worker woken BY
// an incoming message still has the handlers attached.
export const registerMessaging = () => {
  configureDownloadEvents({ downloaded: Messaging.emit.downloaded });
  webExtensionApi.runtime.onMessageExternal.addListener((rawRequest, sender, sendResponse) => {
    if (!isExternalMessage(rawRequest)) {
      const type = getMessageType(rawRequest);
      // Unknown external message types get a protocol-level error; malformed
      // values without a type cannot be correlated with a response.
      if (type) {
        sendResponse({
          type,
          body: {
            status: MESSAGE_TYPES.ERROR,
            error: EXTERNAL_MESSAGE_TYPES.has(type)
              ? Messaging.API_ERRORS.BAD_REQUEST
              : Messaging.API_ERRORS.UNKNOWN_TYPE,
            version: Messaging.API_VERSION,
          },
        });
      }
      return;
    }
    if (rawRequest.type === MESSAGE_TYPES.VALIDATE) {
      const rejection = getUntrustedValidationRejection(rawRequest, sender);
      if (rejection) {
        sendResponse({
          type: MESSAGE_TYPES.VALIDATE,
          body: { ...rejection, version: Messaging.API_VERSION },
        });
        return;
      }
    }
    return dispatchMessage(rawRequest, sender, sendResponse, externalHandlers);
  });

  webExtensionApi.runtime.onMessage.addListener((rawRequest, sender, sendResponse) => {
    if (!isInternalMessage(rawRequest)) {
      return;
    }
    if (
      rawRequest.type === MESSAGE_TYPES.VALIDATE &&
      rawRequest.body?.validationSource === "webmcp"
    ) {
      const rejection = getUntrustedValidationRejection(rawRequest, sender);
      if (rejection) {
        sendResponse({ type: MESSAGE_TYPES.VALIDATE, body: rejection });
        return;
      }
      return dispatchMessage(rawRequest, sender, sendResponse, externalHandlers);
    }
    return dispatchMessage(rawRequest, sender, sendResponse, internalHandlers);
  });
};
