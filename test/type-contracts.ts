// Compile-only assertions. tsconfig.test.json owns these contracts; Vitest does not execute them.
import { expectTypeOf } from "vitest";

import type { CounterWriteState } from "../src/background/counter.ts";
import { makeSeparator, type MenuContext } from "../src/background/menu-build.ts";
import { handleContextMenuClick } from "../src/background/menu-click.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import type { UiTheme } from "../src/config/content-options.ts";
import type {
  AcquiredDownload,
  DownloadExecutionResult,
  DownloadPipelineState,
  DownloadPlan,
  FinalizableDownloadState,
} from "../src/downloads/download-types.ts";
import type { DownloadRecord, DownloadsState } from "../src/downloads/download-state.ts";
import type {
  DestinationClause,
  MatcherClause,
  RuleClause,
  RoutingRule,
} from "../src/routing/router.ts";
import type { Path, PathSegment } from "../src/routing/path.ts";
import { MESSAGE_TYPES, RULE_TYPES } from "../src/shared/constants.ts";
import type { ClickType, RuleType } from "../src/shared/constants.ts";
import type { SelectableLocale } from "../src/shared/generated-locales.ts";
import type {
  InternalMessage,
  MessageOf,
  ResponseFor,
  ValidationInfo,
  WireDownloadState,
} from "../src/shared/message-protocol.ts";
import type { SessionWriteState } from "../src/shared/session-state.ts";
import { readResponseContent } from "../src/shared/streaming-content.ts";
import { withUrl } from "../src/shared/util.ts";

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
