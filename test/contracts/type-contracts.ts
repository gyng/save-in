// Compile-only assertions. config/typescript/test.json owns these contracts; Vitest does not execute them.
import { expectTypeOf } from "vitest";

import type { CounterWriteState } from "../../src/background/counter.ts";
import type {
  BackgroundE2ECommandRequest,
  BackgroundE2ECommandResponse,
  BackgroundE2EContextMenuRequest,
  BackgroundE2EContextMenuResponse,
  BackgroundE2EHistoryRequest,
  BackgroundE2EHistoryResponse,
  BackgroundE2ENotificationRequest,
  BackgroundE2ENotificationResponse,
  BackgroundE2ETabMenuRequest,
  BackgroundE2ETabMenuResponse,
} from "../../src/background/e2e-command.ts";
import { makeSeparator, type MenuContext } from "../../src/background/menu-build.ts";
import { handleContextMenuClick } from "../../src/background/menu-click.ts";
import type { SaveInOptions, StoredSaveInOptions } from "../../src/config/option-schema.ts";
import type { UiTheme } from "../../src/config/content-options.ts";
import type {
  AcquiredDownload,
  DownloadExecutionResult,
  DownloadPipelineState,
  DownloadPlan,
  FinalizableDownloadState,
} from "../../src/downloads/download-types.ts";
import type { DownloadRecord, DownloadsState } from "../../src/downloads/download-state.ts";
import type {
  DestinationClause,
  MatcherClause,
  RuleClause,
  RoutingRule,
} from "../../src/routing/router.ts";
import type { Path, PathSegment } from "../../src/routing/path.ts";
import { MESSAGE_TYPES, RULE_TYPES } from "../../src/shared/constants.ts";
import type { ClickType, RuleType } from "../../src/shared/constants.ts";
import type { SelectableLocale } from "../../src/shared/generated-locales.ts";
import type {
  InternalMessage,
  InternalResponseMap,
  MessageOf,
  ResponseFor,
  ValidationInfo,
  WireDownloadState,
} from "../../src/shared/message-protocol.ts";
import type { SessionWriteState } from "../../src/shared/session-state.ts";
import { readResponseContent } from "../../src/shared/streaming-content.ts";
import { withUrl } from "../../src/shared/util.ts";
import type {
  ContextMenuClickRequest,
  ContextMenuClickResponse,
  DownloadMessageResponse,
  E2ERuntimeOptionValues,
  E2EStoredOptionValues,
  HistoryWriteRequest,
  HistoryWriteResponse,
  HistoryEntry as E2EHistoryEntry,
  NotificationRequest,
  NotificationResponse,
  RuntimeMessage as E2ERuntimeMessage,
  RuntimeResponseFor as E2ERuntimeResponseFor,
  StartDownloadRequest,
  StartDownloadResponse,
  TabMenuClickRequest,
  TabMenuClickResponse,
} from "../e2e/control-protocol.mjs";

type E2EMessage<Type extends E2ERuntimeMessage["type"]> = Extract<
  E2ERuntimeMessage,
  { type: Type }
>;
type SuccessfulProtocolResponse<Type extends InternalMessage["type"]> = InternalResponseMap[Type];

expectTypeOf<DownloadPlan>().toHaveProperty("state").toEqualTypeOf<DownloadPipelineState>();
expectTypeOf<AcquiredDownload>().toEqualTypeOf<{
  url: string;
  source: "direct" | "fetched" | "fetch-fallback-direct";
  ownedObjectUrl?: string | undefined;
  offscreenRequestId?: string | undefined;
}>();
expectTypeOf<DownloadExecutionResult>().toEqualTypeOf<
  { status: "started"; downloadId: number } | { status: "skipped" } | { status: "failed" }
>();
expectTypeOf<FinalizableDownloadState>().toMatchTypeOf<{
  path: DownloadPipelineState["path"];
  info: DownloadPipelineState["info"];
}>();
expectTypeOf<RuleClause["type"]>().toEqualTypeOf<RuleType>();
expectTypeOf<CounterWriteState["queue"]>().toEqualTypeOf<Promise<unknown>>();
expectTypeOf<SessionWriteState["queues"]>().toEqualTypeOf<Map<string, Promise<unknown>>>();
expectTypeOf<DownloadsState["records"]>().toEqualTypeOf<Map<number, DownloadRecord>>();
expectTypeOf<DownloadsState["hydration"]>().toEqualTypeOf<Promise<void> | null>();
expectTypeOf<Path["buf"]>().toEqualTypeOf<PathSegment[]>();
expectTypeOf(handleContextMenuClick({ menuItemId: "save-in-0" })).toEqualTypeOf<Promise<void>>();
const validMenuContexts: MenuContext[] = ["link", "selection"];
makeSeparator(validMenuContexts, "type-contract-separator");
// @ts-expect-error context menu builders reject arbitrary browser context strings
makeSeparator(["not-a-browser-context"], "invalid-type-contract-separator");
expectTypeOf(withUrl("invalid", (url) => url.hostname)).toEqualTypeOf<string | null>();
expectTypeOf(withUrl("invalid", (url) => url.hostname, undefined)).toEqualTypeOf<string | null>();
expectTypeOf(withUrl("invalid", (url) => url.hostname, false)).toEqualTypeOf<string | boolean>();

type CheckRoutesRequest = Extract<InternalMessage, { type: "CHECK_ROUTES" }>;
type CheckRoutesSuccess = Extract<
  ResponseFor<CheckRoutesRequest>,
  { type: "CHECK_ROUTES_RESPONSE" }
>;

expectTypeOf<CheckRoutesSuccess["body"]["lastDownload"]>().toEqualTypeOf<
  WireDownloadState | null | undefined
>();
expectTypeOf<SaveInOptions["filenamePatterns"]>().toEqualTypeOf<RoutingRule[] | "">();
expectTypeOf<SaveInOptions["uiTheme"]>().toEqualTypeOf<UiTheme>();
expectTypeOf<SaveInOptions["uiLocale"]>().toEqualTypeOf<"" | SelectableLocale>();
expectTypeOf<SaveInOptions["contentClickToSaveButton"]>().toEqualTypeOf<ClickType>();
expectTypeOf<E2ERuntimeOptionValues>().toEqualTypeOf<
  Pick<SaveInOptions, keyof E2ERuntimeOptionValues>
>();
expectTypeOf<E2EStoredOptionValues>().toEqualTypeOf<
  Pick<StoredSaveInOptions, keyof E2EStoredOptionValues>
>();
expectTypeOf<StartDownloadRequest>().toEqualTypeOf<BackgroundE2ECommandRequest>();
expectTypeOf<ContextMenuClickRequest>().toMatchTypeOf<BackgroundE2EContextMenuRequest>();
expectTypeOf<BackgroundE2EContextMenuRequest>().toMatchTypeOf<ContextMenuClickRequest>();
expectTypeOf<HistoryWriteRequest>().toEqualTypeOf<BackgroundE2EHistoryRequest>();
expectTypeOf<NotificationRequest>().toEqualTypeOf<BackgroundE2ENotificationRequest>();
expectTypeOf<StartDownloadResponse>().toEqualTypeOf<BackgroundE2ECommandResponse>();
expectTypeOf<ContextMenuClickResponse>().toEqualTypeOf<BackgroundE2EContextMenuResponse>();
expectTypeOf<HistoryWriteResponse>().toEqualTypeOf<BackgroundE2EHistoryResponse>();
expectTypeOf<TabMenuClickResponse>().toEqualTypeOf<BackgroundE2ETabMenuResponse>();
expectTypeOf<NotificationResponse>().toEqualTypeOf<BackgroundE2ENotificationResponse>();
expectTypeOf<TabMenuClickRequest["type"]>().toEqualTypeOf<BackgroundE2ETabMenuRequest["type"]>();
expectTypeOf<TabMenuClickRequest["body"]["info"]>().toEqualTypeOf<
  Pick<
    BackgroundE2ETabMenuRequest["body"]["info"],
    | "menuItemId"
    | "frameId"
    | "selectionText"
    | "pageUrl"
    | "linkUrl"
    | "srcUrl"
    | "frameUrl"
    | "mediaType"
    | "linkText"
    | "modifiers"
  >
>();
expectTypeOf<TabMenuClickRequest["body"]["tab"]>().toMatchTypeOf<
  Pick<BackgroundE2ETabMenuRequest["body"]["tab"], "id" | "index" | "windowId">
>();

expectTypeOf<E2EMessage<"WAKE_WARM">>().toEqualTypeOf<MessageOf<typeof MESSAGE_TYPES.WAKE_WARM>>();
expectTypeOf<E2ERuntimeResponseFor<E2EMessage<"WAKE_WARM">>>().toEqualTypeOf<
  SuccessfulProtocolResponse<typeof MESSAGE_TYPES.WAKE_WARM>
>();
expectTypeOf<E2EMessage<"HISTORY_CANCEL">>().toEqualTypeOf<
  MessageOf<typeof MESSAGE_TYPES.HISTORY_CANCEL>
>();
expectTypeOf<E2ERuntimeResponseFor<E2EMessage<"HISTORY_CANCEL">>>().toEqualTypeOf<
  SuccessfulProtocolResponse<typeof MESSAGE_TYPES.HISTORY_CANCEL>
>();
expectTypeOf<E2EMessage<"DOWNLOAD">>().toMatchTypeOf<MessageOf<typeof MESSAGE_TYPES.DOWNLOAD>>();
const e2eDownloadResponse = null as unknown as DownloadMessageResponse;
const productionDownloadResponse: SuccessfulProtocolResponse<typeof MESSAGE_TYPES.DOWNLOAD> =
  e2eDownloadResponse;
const roundTrippedDownloadResponse: DownloadMessageResponse = productionDownloadResponse;
void roundTrippedDownloadResponse;
expectTypeOf<E2ERuntimeResponseFor<E2EMessage<"APPLY_CONFIG">>>().toMatchTypeOf<
  SuccessfulProtocolResponse<typeof MESSAGE_TYPES.APPLY_CONFIG>
>();
type ProductionHistoryEntry = SuccessfulProtocolResponse<
  typeof MESSAGE_TYPES.HISTORY_GET
>["body"]["entries"][number];
expectTypeOf<ProductionHistoryEntry["id"]>().toEqualTypeOf<E2EHistoryEntry["id"]>();
expectTypeOf<ProductionHistoryEntry["url"]>().toEqualTypeOf<E2EHistoryEntry["url"]>();
expectTypeOf<ProductionHistoryEntry["status"]>().toEqualTypeOf<E2EHistoryEntry["status"]>();
expectTypeOf<ProductionHistoryEntry["finalFullPath"]>().toEqualTypeOf<
  E2EHistoryEntry["finalFullPath"]
>();
expectTypeOf<
  SuccessfulProtocolResponse<typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET>
>().toMatchTypeOf<E2ERuntimeResponseFor<E2EMessage<"EXTERNAL_DOWNLOAD_REJECTIONS_GET">>>();

expectTypeOf<MessageOf<typeof MESSAGE_TYPES.HISTORY_CANCEL>>().toEqualTypeOf<{
  type: typeof MESSAGE_TYPES.HISTORY_CANCEL;
  body: { historyId: string };
}>();
expectTypeOf<MessageOf<typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR>>().toEqualTypeOf<{
  type: typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR;
  body: { senderId: string };
}>();
expectTypeOf<MessageOf<typeof MESSAGE_TYPES.SOURCE_PANEL_STATE>>().toEqualTypeOf<{
  type: typeof MESSAGE_TYPES.SOURCE_PANEL_STATE;
  body?: { open: boolean } | undefined;
}>();
expectTypeOf<NonNullable<MessageOf<typeof MESSAGE_TYPES.VALIDATE>["body"]>["info"]>().toEqualTypeOf<
  ValidationInfo | undefined
>();
// Runtime-only download metadata must not leak into the structured-clone validation protocol.
// @ts-expect-error content promises are owned by the download pipeline
const invalidValidationInfo: ValidationInfo = { contentPromise: Promise.resolve(null) };
void invalidValidationInfo;

// A bodyless response must provide a typed fallback reader.
// @ts-expect-error neither arrayBuffer nor blob is available
void readResponseContent({ body: null, headers: new Headers() }, false);

const matcherClause: MatcherClause = {
  name: "filename",
  value: /.+/,
  type: RULE_TYPES.MATCHER,
  matcher: () => null,
};
const destinationClause: DestinationClause = {
  name: "into",
  value: "images",
  type: RULE_TYPES.DESTINATION,
};
// Only the parser may promote a structurally valid clause array into a parsed rule.
// @ts-expect-error unvalidated arrays do not satisfy the RoutingRule brand
const unvalidatedRoutingRule: RoutingRule = [matcherClause, destinationClause];
void unvalidatedRoutingRule;
expectTypeOf<DownloadPipelineState["scratch"]>().toHaveProperty("historyEntryId");
expectTypeOf<DownloadPipelineState["scratch"]>().toHaveProperty("pathTemplateRaw");
