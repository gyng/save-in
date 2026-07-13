// Compile-only assertions. tsconfig.test.json owns these contracts; Vitest does not execute them.
import { expectTypeOf } from "vitest";

import type { CounterWriteState } from "../src/background/counter.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import type {
  AcquiredDownload,
  DownloadExecutionResult,
  DownloadPipelineState,
  DownloadPlan,
  FinalizableDownloadState,
} from "../src/downloads/download-types.ts";
import type { DownloadRecord, DownloadsState } from "../src/downloads/download-state.ts";
import type { RuleClause, RoutingRule } from "../src/routing/router.ts";
import type { RuleType } from "../src/shared/constants.ts";
import type {
  InternalMessage,
  ResponseFor,
  WireDownloadState,
} from "../src/shared/message-protocol.ts";
import type { SessionWriteState } from "../src/shared/session-state.ts";

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

type CheckRoutesRequest = Extract<InternalMessage, { type: "CHECK_ROUTES" }>;
type CheckRoutesSuccess = Extract<
  ResponseFor<CheckRoutesRequest>,
  { type: "CHECK_ROUTES_RESPONSE" }
>;

expectTypeOf<CheckRoutesSuccess["body"]["lastDownload"]>().toEqualTypeOf<
  WireDownloadState | null | undefined
>();
expectTypeOf<SaveInOptions["filenamePatterns"]>().toEqualTypeOf<RoutingRule[] | "">();
expectTypeOf<DownloadPipelineState["scratch"]>().toHaveProperty("historyEntryId");
expectTypeOf<DownloadPipelineState["scratch"]>().toHaveProperty("pathTemplateRaw");
