import { webExtensionApi } from "../../platform/web-extension-api.ts";

import { splitLines } from "../../shared/util.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { OptionsManagement } from "../../config/option.ts";
import { options } from "../../config/options-data.ts";
import { buildTree } from "../../menus/menu-tree.ts";
import { reportExternalDownloadRejection } from "../../downloads/notification.ts";
import { configureDownloadEvents } from "../../downloads/download-events.ts";
import { backgroundRuntime } from "../runtime.ts";
import {
  getMessageType,
  EXTERNAL_MESSAGE_TYPES,
  isExternalMessage,
  isInternalMessage,
  type ExternalMessage,
  type InternalMessage,
} from "../../shared/message-protocol.ts";
import { respondAsync } from "../message-dispatch.ts";
import { addLogEntry } from "../log.ts";
import { clearHistory, getHistoryEntries, setHistoryStatus } from "../history.ts";
import { syncSourcePanelToTab, setSourcePanelOpenState } from "../source-panel-state.ts";
import { cancelActiveTransfer, getActiveTransfer } from "../../downloads/active-transfers.ts";
import { undoBrowserDownload } from "../../downloads/undo-download.ts";
import { OffscreenClient } from "../../platform/offscreen-client.ts";
import { ExternalDownloadRejections } from "../external-download-rejections.ts";
import { getMessage } from "../../platform/localization.ts";
import { createSourcePanelCopy } from "../../shared/source-panel-copy.ts";
import { createSourceRuleDraft } from "../../automation/source-rule-draft.ts";
import { SOURCE_RULE_DRAFT_SESSION_KEY } from "../../shared/storage-keys.ts";
import { getDiagnosticSnapshot, recordDiagnosticLifecycle } from "../diagnostics.ts";
import { clearLog } from "../log.ts";
import {
  API_ERRORS,
  API_VERSION,
  isExternalDownloadAllowed,
  type MessageSender,
  type ProtocolSendResponse,
} from "./protocol.ts";
import {
  emitDownloaded,
  getUntrustedValidationRejection,
  handleApplyConfig,
  handleCheckRoutes,
  handleDownloadMessage,
  handleGetConfig,
  handleGetGrammars,
  handleGetKeywords,
  handleGetSchema,
  handlePing,
  handleValidate,
  sourcePanelCopies,
} from "./handlers.ts";
import { handleAutoDownloadSource } from "./auto-download.ts";

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
  [MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE]: handleAutoDownloadSource,
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
          error: API_ERRORS.BAD_REQUEST,
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
    await clearLog();
    await recordDiagnosticLifecycle("failures_cleared");
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.HISTORY_GET]: async (_request, _sender, sendResponse) => {
    sendResponse({
      type: MESSAGE_TYPES.HISTORY_GET,
      body: { entries: await getHistoryEntries() },
    });
  },
  [MESSAGE_TYPES.HISTORY_CLEAR]: async (_request, _sender, sendResponse) => {
    await clearHistory();
    sendResponse({ type: MESSAGE_TYPES.OK });
  },
  [MESSAGE_TYPES.HISTORY_CANCEL]: async (request, _sender, sendResponse) => {
    const { historyId } = request.body;
    const active = getActiveTransfer(historyId);
    let canceled = cancelActiveTransfer(historyId);
    if (active?.requestId && OffscreenClient.canUse()) {
      await OffscreenClient.cancel(active.requestId).catch(() => {});
    }
    const entry = historyId
      ? (await getHistoryEntries()).find((candidate) => candidate.id === historyId)
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
      await setHistoryStatus(historyId, "USER_CANCELED", downloadId);
    }
    sendResponse({ type: MESSAGE_TYPES.HISTORY_CANCEL, body: { canceled } });
  },
  [MESSAGE_TYPES.HISTORY_UNDO]: async (request, _sender, sendResponse) => {
    const { historyId } = request.body;
    const entry = (await getHistoryEntries()).find((candidate) => candidate.id === historyId);
    const downloadId = entry?.downloadId;
    if (downloadId == null) {
      // Stale UI: the entry vanished or predates download-id tracking.
      sendResponse({
        type: MESSAGE_TYPES.HISTORY_UNDO,
        body: { undone: false, fileMissing: false },
      });
      return;
    }
    const result = await undoBrowserDownload(downloadId);
    if (result.undone) {
      await setHistoryStatus(historyId, "undone", downloadId);
    }
    sendResponse({ type: MESSAGE_TYPES.HISTORY_UNDO, body: result });
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
  [MESSAGE_TYPES.GET_KEYWORDS]: handleGetKeywords,
  [MESSAGE_TYPES.GET_GRAMMARS]: handleGetGrammars,
  [MESSAGE_TYPES.PREVIEW_MENUS]: (request, _sender, sendResponse) => {
    const pathsArray = splitLines(request.body?.paths || "");
    sendResponse({ type: MESSAGE_TYPES.MENU_PREVIEW, body: buildTree(pathsArray) });
  },
  [MESSAGE_TYPES.CHECK_ROUTES]: (request, _sender, sendResponse) =>
    handleCheckRoutes(request, sendResponse),
  [MESSAGE_TYPES.PING]: handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: handleGetSchema,
  [MESSAGE_TYPES.GET_CONFIG]: handleGetConfig,
  [MESSAGE_TYPES.VALIDATE]: handleValidate,
  [MESSAGE_TYPES.APPLY_CONFIG]: handleApplyConfig,
  [MESSAGE_TYPES.DOWNLOAD]: handleDownloadMessage,
} satisfies HandlerTable<InternalMessage>;

const externalHandlers = {
  [MESSAGE_TYPES.PING]: handlePing,
  [MESSAGE_TYPES.GET_SCHEMA]: handleGetSchema,
  [MESSAGE_TYPES.GET_KEYWORDS]: handleGetKeywords,
  [MESSAGE_TYPES.GET_GRAMMARS]: handleGetGrammars,
  [MESSAGE_TYPES.VALIDATE]: (request, sender, sendResponse) =>
    handleValidate(request, sender, sendResponse, true),
  [MESSAGE_TYPES.DOWNLOAD]: (request, sender, sendResponse) => {
    if (!isExternalDownloadAllowed(sender)) {
      return (async () => {
        // Rejected private-window activity is never persisted or surfaced in a
        // system notification; it remains visible only to the calling extension.
        if (sender.id && sender.tab?.incognito !== true) {
          await Promise.allSettled([
            ExternalDownloadRejections.record(sender.id, request.body || {}),
            reportExternalDownloadRejection(sender.id),
          ]);
        }
        sendResponse({
          type: MESSAGE_TYPES.DOWNLOAD,
          body: {
            status: MESSAGE_TYPES.ERROR,
            error: API_ERRORS.UNAUTHORIZED,
            message: "Allow this extension ID in Save In before requesting downloads",
            version: request.body?.version || API_VERSION,
          },
        });
      })();
    }
    return handleDownloadMessage(request, sender, sendResponse);
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
    void addLogEntry(
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
  configureDownloadEvents({ downloaded: emitDownloaded });
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
              ? API_ERRORS.BAD_REQUEST
              : API_ERRORS.UNKNOWN_TYPE,
            version: API_VERSION,
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
          body: { ...rejection, version: API_VERSION },
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

// Re-exported test surface: registerMessaging is the composition entry point,
// but unit tests exercise a handful of handlers directly (see
// test/background/messaging/) instead of only through the dispatch tables.
export {
  emitDownloaded,
  handleDownloadMessage,
  handlePing,
  resetMessagingTransientState,
} from "./handlers.ts";
export { isValidDownloadUrl } from "./protocol.ts";
