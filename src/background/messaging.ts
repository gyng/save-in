import { webExtensionApi } from "../platform/web-extension-api.ts";

/* eslint-disable no-case-declarations */

import { splitLines, withUrl } from "../shared/util.ts";
import { MESSAGE_TYPES, DOWNLOAD_TYPES } from "../shared/constants.ts";
import { applyVariables, transformers } from "../routing/variable.ts";
import { Path } from "../routing/path.ts";
import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { buildTree } from "./menu-build.ts";
import { matcherFunctions, parseRulesCollecting, traceRules } from "../routing/router.ts";
import { Download } from "../downloads/download.ts";
import { currentTab } from "../platform/current-tab.ts";
import { DownloadEvents } from "../downloads/download-events.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";
import { backgroundRuntime } from "./runtime.ts";
import {
  getMessageType,
  EXTERNAL_MESSAGE_TYPES,
  isExternalMessage,
  isInternalMessage,
  type ExternalMessage,
  type InternalMessage,
  type MessageOf,
} from "../shared/message-protocol.ts";
import { respondAsync, type SendResponse } from "./message-dispatch.ts";
import { Log } from "./log.ts";
import { applyConfigSerialized } from "./config-apply.ts";
import { configWriteState } from "./state.ts";
import { getPersistenceDiagnostics } from "../shared/persistence-diagnostics.ts";

type MessageSender = browser.runtime.MessageSender;
type ProtocolSendResponse = SendResponse;

export const Messaging = {
  // ─── External DOWNLOAD API (issue #110) ────────────────────────────────
  // Versioned, supported contract for other extensions to push a URL into
  // save-in's routing/rename pipeline. Callers should PING first to discover
  // the version and capabilities. Documented in docs/INTEGRATIONS.md.
  API_VERSION: 1,
  API_CAPABILITIES: [
    "download", // { type: "DOWNLOAD", body: { url, info?, comment?, version? } }
    "ping", // { type: "PING" } -> { version, capabilities }
    "routing", // the URL runs through the user's rename/route rules
    "comment", // body.comment is targetable in routing rules
    "info", // body.info fields: pageUrl, srcUrl, selectionText, menuIndex, ...
    "schema", // { type: "GET_SCHEMA" } -> the option schema (read-only)
    "validate", // { type: "VALIDATE", body: { paths?, filenamePatterns? } } (read-only)
    // apply_config (mutating) is intentionally NOT advertised: it is reachable
    // only from same-extension callers, not onMessageExternal
  ],
  API_ERRORS: {
    BAD_REQUEST: "BAD_REQUEST", // malformed message (e.g. missing url)
    INVALID_URL: "INVALID_URL", // url is not a fetchable http(s)/ftp/data URL
    UNKNOWN_TYPE: "UNKNOWN_TYPE", // unrecognised message type
  },

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
    sendResponse: ProtocolSendResponse,
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
    sendResponse: ProtocolSendResponse,
  ): Promise<void> => {
    const lastState =
      (request.body && request.body.state) ||
      (backgroundRuntime.lastDownloadState != null && backgroundRuntime.lastDownloadState);

    let interpolatedVariables: Record<string, string> | null = null;
    if (lastState) {
      const keys = Object.keys(transformers);
      // Preview only: :counter: peeks instead of consuming a value
      const previewInfo = Object.assign({}, lastState.info, { preview: true });
      const values = await Promise.all(
        keys.map((val) =>
          applyVariables(new Path(val), previewInfo).then((path: { finalize: () => string }) =>
            path.finalize(),
          ),
        ),
      );
      const interpolationMap: Record<string, string> = {};
      keys.forEach((key, i) => {
        interpolationMap[key] = values[i];
      });
      interpolatedVariables = interpolationMap;
    }

    // The legacy no-state path evaluates to false; checkRoutes treats every
    // nullish/falsy input as an empty preview.
    const routeInfo = await OptionsManagement.checkRoutes(
      lastState as Parameters<typeof OptionsManagement.checkRoutes>[0],
    );

    sendResponse({
      type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
      body: {
        optionErrors: backgroundRuntime.optionErrors,
        routeInfo,
        lastDownload: backgroundRuntime.lastDownloadState,
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
    sendResponse: ProtocolSendResponse,
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

  // Read-only: dry-run the two grammars and return structured errors + a menu
  // preview, without saving anything. Powers an agent's generate→validate→fix
  // loop and the options-page "paste config" affordance. Safe externally.
  handleValidate: (
    request: MessageOf<typeof MESSAGE_TYPES.VALIDATE>,
    _sender: MessageSender,
    sendResponse: ProtocolSendResponse,
  ): void => {
    const body = request.body || {};
    const result: Record<string, unknown> = { version: Messaging.API_VERSION };

    if (typeof body.paths === "string") {
      const pathsArray = splitLines(body.paths);
      const tree = buildTree(pathsArray);
      result.menuPreview = tree.items;
      result.pathErrors = tree.errors;
    }
    if (typeof body.filenamePatterns === "string") {
      const parsed = parseRulesCollecting(body.filenamePatterns);
      result.ruleErrors = parsed.errors;
      if (body.info && typeof body.info === "object" && !Array.isArray(body.info)) {
        result.ruleTrace = traceRules(parsed.rules, body.info);
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
    sendResponse: ProtocolSendResponse,
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
      webExtensionApi.runtime
        .sendMessage({
          type: MESSAGE_TYPES.DOWNLOADED,
          body: { state },
        })
        .catch(() => {});
    },
  },

  /**
   * Official, versioned DOWNLOAD API for external extensions (issue #110).
   * Other extensions push a URL into save-in's routing/rename pipeline by
   * sending this message; PING first to negotiate the version.
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
   *   // ID obtained from manifest.json
   *   webExtensionApi.runtime.sendMessage("{72d92df5-2aa0-4b06-b807-aa21767545cd}", payload);
   * }
   */
  handleDownloadMessage: (
    request: MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>,
    sender: MessageSender,
    sendResponse: ProtocolSendResponse,
  ): void => {
    const requestBody = request.body || {};
    const { url, comment } = requestBody;
    // Callers may pin a version; default to the current one
    const version = requestBody.version || Messaging.API_VERSION;

    // Validate before triggering a download: external callers are untrusted,
    // and a malformed message should get typed feedback, not silent failure.
    const fail = (error: string, message: string): void =>
      sendResponse({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.ERROR, error, message, version },
      });
    if (!url || typeof url !== "string") {
      fail(Messaging.API_ERRORS.BAD_REQUEST, "Missing or non-string 'url'");
      return;
    }
    if (!Messaging.isValidDownloadUrl(url)) {
      fail(Messaging.API_ERRORS.INVALID_URL, "URL must be http(s), ftp, data or blob");
      return;
    }

    // The external DOWNLOAD API may omit info
    const info = requestBody.info || {};
    const last = backgroundRuntime.lastDownloadState;

    const opts: DownloadInfo = {
      // Prefer the tab the message came from over the tracked global (#172)
      currentTab: (sender && sender.tab) || currentTab,
      now: new Date(),
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      linkText: info.linkText,
      sourceUrl: info.srcUrl,
      menuIndex: info.menuIndex,
      comment: info.comment,
      modifiers: info.modifiers,
      suggestedFilename: info.suggestedFilename,
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

    // Fire-and-forget async (the OK below acknowledges acceptance, not
    // completion); Download.launch logs and reports a terminal failure
    Download.launch(clickState);

    // status:"OK" is unchanged for back-compat; version/url are additive
    sendResponse({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version, url },
    });
  },
};

type Handler<M extends InternalMessage> = (
  request: M,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse,
) => void | Promise<void>;

type HandlerTable<M extends InternalMessage> = {
  [T in M["type"]]: Handler<Extract<M, { type: T }>>;
};

const internalHandlers = {
  [MESSAGE_TYPES.WAKE_WARM]: (_request, _sender, sendResponse) => {
    // Sent by content scripts on combo keydown purely to wake the MV3 worker.
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.OPTIONS_LOADED]: (_request, _sender, sendResponse) => {
    backgroundRuntime.reset();
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.OPTIONS]: (_request, _sender, sendResponse) => {
    sendResponse({ type: MESSAGE_TYPES.OPTIONS, body: options });
  },
  [MESSAGE_TYPES.OPTIONS_SCHEMA]: (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: { keys: OptionsManagement.OPTION_KEYS, types: OptionsManagement.OPTION_TYPES },
    });
  },
  [MESSAGE_TYPES.GET_KEYWORDS]: (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.KEYWORD_LIST,
      body: { matchers: Object.keys(matcherFunctions), variables: Object.keys(transformers) },
    });
  },
  [MESSAGE_TYPES.PREVIEW_MENUS]: (request, _sender, sendResponse) => {
    const pathsArray = splitLines(request.body?.paths || "");
    sendResponse({ type: MESSAGE_TYPES.MENU_PREVIEW, body: buildTree(pathsArray) });
  },
  [MESSAGE_TYPES.CHECK_ROUTES]: (request, _sender, sendResponse) =>
    Messaging.handleCheckRoutes(request, sendResponse),
  [MESSAGE_TYPES.PING]: Messaging.handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: Messaging.handleGetSchema,
  [MESSAGE_TYPES.VALIDATE]: Messaging.handleValidate,
  [MESSAGE_TYPES.APPLY_CONFIG]: Messaging.handleApplyConfig,
  [MESSAGE_TYPES.DOWNLOAD]: Messaging.handleDownloadMessage,
} satisfies HandlerTable<InternalMessage>;

const externalHandlers = {
  [MESSAGE_TYPES.PING]: Messaging.handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: Messaging.handleGetSchema,
  [MESSAGE_TYPES.VALIDATE]: Messaging.handleValidate,
  [MESSAGE_TYPES.DOWNLOAD]: Messaging.handleDownloadMessage,
} satisfies HandlerTable<ExternalMessage>;

const dispatchMessage = <M extends InternalMessage>(
  request: M,
  sender: MessageSender,
  sendResponse: ProtocolSendResponse,
  handlers: HandlerTable<M>,
): true | void => {
  // The table is exhaustive for M, so this lookup is safe even though TS cannot
  // preserve the correlation between a union's discriminator and mapped value.
  const handler = (handlers as unknown as Record<string, Handler<M>>)[request.type];
  const result = handler(request, sender, sendResponse);
  if (result instanceof Promise) {
    return respondAsync(request.type, result, sendResponse, (error) => {
      void Log.add("message handler failed", {
        type: request.type,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
};

// MV3: entry.background calls this synchronously at startup so a worker woken BY
// an incoming message still has the handlers attached.
export const registerMessaging = () => {
  DownloadEvents.downloaded = Messaging.emit.downloaded;
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
            error: EXTERNAL_MESSAGE_TYPES.has(type as ExternalMessage["type"])
              ? Messaging.API_ERRORS.BAD_REQUEST
              : Messaging.API_ERRORS.UNKNOWN_TYPE,
            version: Messaging.API_VERSION,
          },
        });
      }
      return;
    }
    return dispatchMessage(rawRequest, sender, sendResponse, externalHandlers);
  });

  webExtensionApi.runtime.onMessage.addListener((rawRequest, sender, sendResponse) => {
    if (!isInternalMessage(rawRequest)) {
      return;
    }
    return dispatchMessage(rawRequest, sender, sendResponse, internalHandlers);
  });
};
