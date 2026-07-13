import { expectTypeOf, test } from "vitest";

import type { CounterWriteState } from "../src/background/counter.ts";
import type { RuleType } from "../src/shared/constants.ts";
import type {
  AcquiredDownload,
  DownloadExecutionResult,
  DownloadPipelineState,
  DownloadPlan,
  FinalizableDownloadState,
} from "../src/downloads/download-types.ts";
import type { DownloadRecord, DownloadsState } from "../src/downloads/download-state.ts";
import type { RuleClause } from "../src/routing/router.ts";
import type { SessionWriteState } from "../src/shared/session-state.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import type {
  InternalMessage,
  ResponseFor,
  WireDownloadState,
} from "../src/shared/message-protocol.ts";
import type { RoutingRule } from "../src/routing/router.ts";

test("download stages expose distinct state contracts", () => {
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
});

test("routing clauses use the shared rule-type union", () => {
  expectTypeOf<RuleClause["type"]>().toEqualTypeOf<RuleType>();
});

test("functional state services expose explicit mutable state", () => {
  expectTypeOf<CounterWriteState["queue"]>().toEqualTypeOf<Promise<unknown>>();
  expectTypeOf<SessionWriteState["queues"]>().toEqualTypeOf<Map<string, Promise<unknown>>>();
  expectTypeOf<DownloadsState["records"]>().toEqualTypeOf<Map<number, DownloadRecord>>();
  expectTypeOf<DownloadsState["hydration"]>().toEqualTypeOf<Promise<void> | null>();
});

test("wire responses and option transforms expose their real boundary shapes", () => {
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
});
