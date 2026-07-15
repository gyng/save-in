import { MESSAGE_TYPES } from "./constants.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";
import type { HistoryEntry } from "./history-types.ts";
import type { MenuTree, MenuTreeError, MenuTreeItem } from "../menus/menu-tree.ts";
import type { RuleError } from "../routing/rule-types.ts";
import type { OptionErrors } from "../background/runtime.ts";
import type { RoutePreview } from "../background/route-preview.ts";
import type { PersistenceFailure } from "./persistence-diagnostics.ts";
import type { ExternalDownloadRejection } from "./external-download-rejection-types.ts";
import type { SourcePanelCopy } from "./source-panel-copy.ts";
import type { DiagnosticSnapshot } from "./diagnostics-types.ts";
import { isPageSourceKind, type PageSourceKind } from "./page-source.ts";
import { isStringKeyedRecord } from "./util.ts";

export { isStringKeyedRecord } from "./util.ts";

export type WireCurrentTab = {
  id?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  incognito?: boolean | undefined;
};

export type WireDownloadInfo = {
  url?: string | undefined;
  sourceUrl?: string | undefined;
  pageUrl?: string | undefined;
  frameUrl?: string | undefined;
  selectionText?: string | undefined;
  linkText?: string | undefined;
  mediaType?: string | undefined;
  sourceKind?: PageSourceKind | undefined;
  mime?: string | undefined;
  filename?: string | undefined;
  naiveFilename?: string | undefined;
  initialFilename?: string | undefined;
  mimeExtension?: string | undefined;
  resolvedFilename?: string | undefined;
  referrerUrl?: string | undefined;
  suggestedFilename?: string | null | undefined;
  context?: string | undefined;
  menuIndex?: string | null | undefined;
  menuItemId?: string | undefined;
  menuItemTitle?: string | undefined;
  menuItemPath?: string | undefined;
  comment?: string | null | undefined;
  modifiers?: string[] | undefined;
  sha256?: string | undefined;
  preview?: boolean | undefined;
  contentFetchDisabled?: boolean | undefined;
  counter?: number | undefined;
  now?: string | undefined;
  currentTab?: WireCurrentTab | null | undefined;
};

export type ValidationInfo = Omit<WireDownloadInfo, "now"> & {
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
  now?: string | undefined;
};

export type WireDownloadState = {
  info: WireDownloadInfo;
  path?: string | undefined;
  route?: string | undefined;
  routeIsFolder?: boolean | undefined;
};

const WIRE_INFO_STRING_FIELDS = [
  "url",
  "sourceUrl",
  "pageUrl",
  "frameUrl",
  "selectionText",
  "linkText",
  "mediaType",
  "mime",
  "filename",
  "naiveFilename",
  "initialFilename",
  "mimeExtension",
  "resolvedFilename",
  "referrerUrl",
  "context",
  "menuItemId",
  "menuItemTitle",
  "menuItemPath",
  "sha256",
] as const satisfies readonly (keyof WireDownloadInfo)[];

const isRoutingCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isBrowserTabId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const toWireDownloadState = (state: DownloadPipelineState): WireDownloadState => {
  const info: WireDownloadInfo = {};
  for (const key of WIRE_INFO_STRING_FIELDS) {
    const value = state.info[key];
    if (typeof value === "string") info[key] = value;
  }
  if (isPageSourceKind(state.info.sourceKind)) info.sourceKind = state.info.sourceKind;
  for (const key of ["suggestedFilename", "menuIndex", "comment"] as const) {
    const value = state.info[key];
    if (typeof value === "string" || value === null) info[key] = value;
  }
  if (Array.isArray(state.info.modifiers)) info.modifiers = [...state.info.modifiers];
  if (typeof state.info.preview === "boolean") info.preview = state.info.preview;
  if (typeof state.info.contentFetchDisabled === "boolean") {
    info.contentFetchDisabled = state.info.contentFetchDisabled;
  }
  if (isRoutingCounter(state.info.counter)) {
    info.counter = state.info.counter;
  }
  if (state.info.now instanceof Date && Number.isFinite(state.info.now.getTime())) {
    info.now = state.info.now.toISOString();
  }
  const tab = state.info.currentTab;
  if (tab === null) {
    info.currentTab = null;
  } else if (tab) {
    const currentTab: WireCurrentTab = {};
    if (isBrowserTabId(tab.id)) currentTab.id = tab.id;
    if (typeof tab.title === "string") currentTab.title = tab.title;
    if (typeof tab.url === "string") currentTab.url = tab.url;
    if (typeof tab.incognito === "boolean") currentTab.incognito = tab.incognito;
    info.currentTab = currentTab;
  }

  const wire: WireDownloadState = { info };
  if (state.path && typeof state.path.finalize === "function") wire.path = state.path.finalize();
  if (state.route && typeof state.route.finalize === "function")
    wire.route = state.route.finalize({ finalComponentIsFilename: !state.routeIsFolder });
  if (typeof state.routeIsFolder === "boolean") wire.routeIsFolder = state.routeIsFolder;
  return wire;
};

export const fromWireDownloadState = (state: WireDownloadState): { info: DownloadInfo } => {
  const { now, currentTab: wireCurrentTab, ...info } = state.info;
  const parsedNow = typeof now === "string" ? new Date(now) : undefined;
  let currentTab: DownloadInfo["currentTab"];
  if (wireCurrentTab === null) {
    currentTab = null;
  } else if (wireCurrentTab) {
    const tab: NonNullable<DownloadInfo["currentTab"]> = {};
    if (isBrowserTabId(wireCurrentTab.id)) tab.id = wireCurrentTab.id;
    if (typeof wireCurrentTab.title === "string") tab.title = wireCurrentTab.title;
    if (typeof wireCurrentTab.url === "string") tab.url = wireCurrentTab.url;
    if (typeof wireCurrentTab.incognito === "boolean") tab.incognito = wireCurrentTab.incognito;
    currentTab = tab;
  }
  return {
    info: {
      ...info,
      ...(typeof currentTab !== "undefined" ? { currentTab } : {}),
      ...(parsedNow && Number.isFinite(parsedNow.getTime()) ? { now: parsedNow } : {}),
    },
  };
};

type Message<T extends string> = { type: T };
type OptionalBodyMessage<T extends string, Body> = {
  type: T;
  body?: Body | undefined;
};
type RequiredBodyMessage<T extends string, Body> = { type: T; body: Body };

type Response<T extends string, Body = never> = [Body] extends [never]
  ? { type: T }
  : { type: T; body: Body };

export type WireOptionSchemaKey = {
  name: string;
  type: string;
  default: string | number | boolean;
};

export type WireIntegrationGrammar = {
  id: "directories" | "routing";
  option: "paths" | "filenamePatterns";
  ebnf: string;
  semantics: string[];
  examples: string[];
};

export type AutomaticRoutingValidationCandidate = {
  pageUrl: string;
  sourceUrl: string;
  sourceKind: PageSourceKind;
  suggestedFilename?: string | undefined;
};

export type ProtocolErrorResponse<Type extends string> = Response<
  Type,
  { status: typeof MESSAGE_TYPES.ERROR; error: string; message?: string | undefined }
>;

type OkResponse = Response<typeof MESSAGE_TYPES.OK>;
type DownloadResponse = Response<
  typeof MESSAGE_TYPES.DOWNLOAD,
  | { status: typeof MESSAGE_TYPES.OK; version: number; url: string }
  | {
      status: typeof MESSAGE_TYPES.ERROR;
      error: string;
      message?: string | undefined;
      version: number;
    }
>;

type AutoDownloadSourceResponse = Response<
  typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
  { status: "started" | "skipped" | "failed" }
>;

export type InternalResponseMap = {
  [MESSAGE_TYPES.WAKE_WARM]: OkResponse;
  [MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE]: AutoDownloadSourceResponse;
  [MESSAGE_TYPES.SOURCE_PANEL_READY]: OkResponse;
  [MESSAGE_TYPES.SOURCE_PANEL_STATE]: OkResponse;
  [MESSAGE_TYPES.SOURCE_PANEL_COPY]: Response<
    typeof MESSAGE_TYPES.SOURCE_PANEL_COPY,
    SourcePanelCopy
  >;
  [MESSAGE_TYPES.DIAGNOSTICS_GET]: Response<
    typeof MESSAGE_TYPES.DIAGNOSTICS_GET,
    DiagnosticSnapshot
  >;
  [MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES]: OkResponse;
  [MESSAGE_TYPES.HISTORY_GET]: Response<
    typeof MESSAGE_TYPES.HISTORY_GET,
    { entries: HistoryEntry[] }
  >;
  [MESSAGE_TYPES.HISTORY_CLEAR]: OkResponse;
  [MESSAGE_TYPES.HISTORY_CANCEL]: Response<
    typeof MESSAGE_TYPES.HISTORY_CANCEL,
    { canceled: boolean }
  >;
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET]: Response<
    typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
    { rejections: ExternalDownloadRejection[] }
  >;
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR]: OkResponse;
  [MESSAGE_TYPES.OPTIONS_LOADED]: OkResponse;
  [MESSAGE_TYPES.OPTIONS]: Response<typeof MESSAGE_TYPES.OPTIONS, Record<string, unknown>>;
  [MESSAGE_TYPES.OPTIONS_SCHEMA]: Response<
    typeof MESSAGE_TYPES.OPTIONS_SCHEMA,
    {
      keys: WireOptionSchemaKey[];
      types: { BOOL: string; VALUE: string };
    }
  >;
  [MESSAGE_TYPES.GET_KEYWORDS]: Response<
    typeof MESSAGE_TYPES.KEYWORD_LIST,
    {
      matchers: string[];
      variables: string[];
      automaticMatchers: string[];
      automaticContext: string;
      sourceKinds: PageSourceKind[];
    }
  >;
  [MESSAGE_TYPES.GET_GRAMMARS]: Response<
    typeof MESSAGE_TYPES.GRAMMAR_LIST,
    { version: number; grammars: WireIntegrationGrammar[] }
  >;
  [MESSAGE_TYPES.PREVIEW_MENUS]: Response<typeof MESSAGE_TYPES.MENU_PREVIEW, MenuTree>;
  [MESSAGE_TYPES.CHECK_ROUTES]: Response<
    typeof MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
    {
      optionErrors: OptionErrors;
      routeInfo: RoutePreview;
      lastDownload: WireDownloadState | null | undefined;
      interpolatedVariables: Record<string, string> | null;
      persistenceErrors: PersistenceFailure[];
    }
  >;
  [MESSAGE_TYPES.PING]: Response<
    typeof MESSAGE_TYPES.PONG,
    { version: number; capabilities: string[] }
  >;
  [MESSAGE_TYPES.GET_SCHEMA]: Response<
    typeof MESSAGE_TYPES.SCHEMA,
    {
      version: number;
      options: Array<WireOptionSchemaKey & { description: string }>;
    }
  >;
  [MESSAGE_TYPES.GET_CONFIG]: Response<
    typeof MESSAGE_TYPES.CONFIG,
    { version: number; config: Record<string, string | number | boolean> }
  >;
  [MESSAGE_TYPES.VALIDATE]: Response<
    typeof MESSAGE_TYPES.VALIDATE_RESULT,
    {
      version: number;
      menuPreview?: MenuTreeItem[] | undefined;
      pathErrors?: MenuTreeError[] | undefined;
      ruleErrors?: RuleError[] | undefined;
      ruleTrace?: unknown;
      automaticTrace?: unknown;
    }
  >;
  [MESSAGE_TYPES.APPLY_CONFIG]: Response<
    typeof MESSAGE_TYPES.APPLY_CONFIG_RESULT,
    {
      version: number;
      applied: Record<string, unknown>;
      rejected: Array<{ name: string; reason: string }>;
    }
  >;
  [MESSAGE_TYPES.DOWNLOAD]: DownloadResponse;
};

export type InternalEvent = Response<typeof MESSAGE_TYPES.DOWNLOADED, { state: WireDownloadState }>;

export type DownloadRequestBody = {
  url?: string | undefined;
  target?: "activeTab" | undefined;
  info?:
    | (Pick<
        DownloadInfo,
        | "pageUrl"
        | "selectionText"
        | "linkText"
        | "menuIndex"
        | "comment"
        | "modifiers"
        | "suggestedFilename"
        | "mime"
        | "mediaType"
        | "sourceKind"
      > & { srcUrl?: string | undefined })
    | undefined;
  comment?: string | undefined;
  version?: number | undefined;
};

export type AutoDownloadSourceRequestBody = {
  pageUrl: string;
  sourceUrl: string;
  sourceKind: PageSourceKind;
};

export type InternalMessage =
  | Message<typeof MESSAGE_TYPES.WAKE_WARM>
  | RequiredBodyMessage<typeof MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE, AutoDownloadSourceRequestBody>
  | Message<typeof MESSAGE_TYPES.SOURCE_PANEL_READY>
  | OptionalBodyMessage<typeof MESSAGE_TYPES.SOURCE_PANEL_STATE, { open: boolean }>
  | Message<typeof MESSAGE_TYPES.SOURCE_PANEL_COPY>
  | Message<typeof MESSAGE_TYPES.DIAGNOSTICS_GET>
  | Message<typeof MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES>
  | Message<typeof MESSAGE_TYPES.HISTORY_GET>
  | Message<typeof MESSAGE_TYPES.HISTORY_CLEAR>
  | RequiredBodyMessage<typeof MESSAGE_TYPES.HISTORY_CANCEL, { historyId: string }>
  | Message<typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET>
  | RequiredBodyMessage<
      typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
      { senderId: string }
    >
  | Message<typeof MESSAGE_TYPES.OPTIONS_LOADED>
  | Message<typeof MESSAGE_TYPES.OPTIONS>
  | Message<typeof MESSAGE_TYPES.OPTIONS_SCHEMA>
  | Message<typeof MESSAGE_TYPES.GET_KEYWORDS>
  | Message<typeof MESSAGE_TYPES.GET_GRAMMARS>
  | OptionalBodyMessage<typeof MESSAGE_TYPES.PREVIEW_MENUS, { paths?: string }>
  | OptionalBodyMessage<typeof MESSAGE_TYPES.CHECK_ROUTES, { state?: WireDownloadState }>
  | Message<typeof MESSAGE_TYPES.PING>
  | Message<typeof MESSAGE_TYPES.GET_SCHEMA>
  | Message<typeof MESSAGE_TYPES.GET_CONFIG>
  | OptionalBodyMessage<
      typeof MESSAGE_TYPES.VALIDATE,
      {
        paths?: string;
        filenamePatterns?: string;
        info?: ValidationInfo;
        automaticCandidate?: AutomaticRoutingValidationCandidate;
        validationSource?: "webmcp";
      }
    >
  | OptionalBodyMessage<
      typeof MESSAGE_TYPES.APPLY_CONFIG,
      { config?: Record<string, unknown>; expected?: Record<string, unknown> }
    >
  | OptionalBodyMessage<typeof MESSAGE_TYPES.DOWNLOAD, DownloadRequestBody>;

export type ExternalMessage = Extract<
  InternalMessage,
  | { type: typeof MESSAGE_TYPES.PING }
  | { type: typeof MESSAGE_TYPES.GET_SCHEMA }
  | { type: typeof MESSAGE_TYPES.GET_KEYWORDS }
  | { type: typeof MESSAGE_TYPES.GET_GRAMMARS }
  | { type: typeof MESSAGE_TYPES.VALIDATE }
  | { type: typeof MESSAGE_TYPES.DOWNLOAD }
>;

export type MessageOf<
  T extends InternalMessage["type"],
  M extends InternalMessage = InternalMessage,
> = Extract<M, { type: T }>;

export type ResponseFor<Request extends InternalMessage> =
  | InternalResponseMap[Request["type"]]
  | ProtocolErrorResponse<Request["type"]>;

export type ApplyConfigRequest = MessageOf<typeof MESSAGE_TYPES.APPLY_CONFIG>;
export type ApplyConfigResponse = ResponseFor<ApplyConfigRequest>;
export type SuccessfulApplyConfigResponse = Extract<
  ApplyConfigResponse,
  { type: typeof MESSAGE_TYPES.APPLY_CONFIG_RESULT }
>;

type RuntimeMessenger = {
  sendMessage(message: unknown): Promise<unknown>;
};

// WebExtension declarations do not correlate a request discriminator with its
// response. Keep the single host-boundary assertion here so callers and
// background handlers share the same protocol map.
export const sendInternalMessage = <Request extends InternalMessage>(
  runtime: RuntimeMessenger,
  request: Request,
): Promise<ResponseFor<Request>> => runtime.sendMessage(request) as Promise<ResponseFor<Request>>;

const INTERNAL_MESSAGE_TYPE_MAP = {
  [MESSAGE_TYPES.WAKE_WARM]: true,
  [MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE]: true,
  [MESSAGE_TYPES.SOURCE_PANEL_READY]: true,
  [MESSAGE_TYPES.SOURCE_PANEL_STATE]: true,
  [MESSAGE_TYPES.SOURCE_PANEL_COPY]: true,
  [MESSAGE_TYPES.DIAGNOSTICS_GET]: true,
  [MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES]: true,
  [MESSAGE_TYPES.HISTORY_GET]: true,
  [MESSAGE_TYPES.HISTORY_CLEAR]: true,
  [MESSAGE_TYPES.HISTORY_CANCEL]: true,
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET]: true,
  [MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR]: true,
  [MESSAGE_TYPES.OPTIONS_LOADED]: true,
  [MESSAGE_TYPES.OPTIONS]: true,
  [MESSAGE_TYPES.OPTIONS_SCHEMA]: true,
  [MESSAGE_TYPES.GET_KEYWORDS]: true,
  [MESSAGE_TYPES.GET_GRAMMARS]: true,
  [MESSAGE_TYPES.PREVIEW_MENUS]: true,
  [MESSAGE_TYPES.CHECK_ROUTES]: true,
  [MESSAGE_TYPES.PING]: true,
  [MESSAGE_TYPES.GET_SCHEMA]: true,
  [MESSAGE_TYPES.GET_CONFIG]: true,
  [MESSAGE_TYPES.VALIDATE]: true,
  [MESSAGE_TYPES.APPLY_CONFIG]: true,
  [MESSAGE_TYPES.DOWNLOAD]: true,
} as const satisfies Record<InternalMessage["type"], true>;

const EXTERNAL_MESSAGE_TYPE_MAP = {
  [MESSAGE_TYPES.PING]: true,
  [MESSAGE_TYPES.GET_SCHEMA]: true,
  [MESSAGE_TYPES.GET_KEYWORDS]: true,
  [MESSAGE_TYPES.GET_GRAMMARS]: true,
  [MESSAGE_TYPES.VALIDATE]: true,
  [MESSAGE_TYPES.DOWNLOAD]: true,
} as const satisfies Record<ExternalMessage["type"], true>;

export const INTERNAL_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  Object.keys(INTERNAL_MESSAGE_TYPE_MAP),
);
export const EXTERNAL_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  Object.keys(EXTERNAL_MESSAGE_TYPE_MAP),
);

const isInternalMessageType = (value: string): value is InternalMessage["type"] =>
  Object.hasOwn(INTERNAL_MESSAGE_TYPE_MAP, value);

const isExternalMessageType = (value: string): value is ExternalMessage["type"] =>
  Object.hasOwn(EXTERNAL_MESSAGE_TYPE_MAP, value);

const hasType = (value: unknown): value is Record<string, unknown> & { type: string } =>
  isStringKeyedRecord(value) && typeof value.type === "string";

const hasNoBody = (message: Record<string, unknown>): boolean =>
  !("body" in message) || typeof message.body === "undefined";

const hasOptionalString = (record: Record<string, unknown>, key: string): boolean =>
  typeof record[key] === "undefined" || typeof record[key] === "string";

const hasOptionalNullableString = (record: Record<string, unknown>, key: string): boolean =>
  record[key] == null || typeof record[key] === "string";

const isDownloadInfo = (value: unknown): boolean => {
  if (!isStringKeyedRecord(value)) {
    return false;
  }
  return (
    ["pageUrl", "srcUrl", "selectionText", "linkText", "mime", "mediaType"].every((key) =>
      hasOptionalString(value, key),
    ) &&
    (typeof value.sourceKind === "undefined" || isPageSourceKind(value.sourceKind)) &&
    ["suggestedFilename", "menuIndex", "comment"].every((key) =>
      hasOptionalNullableString(value, key),
    ) &&
    (typeof value.modifiers === "undefined" ||
      (Array.isArray(value.modifiers) && value.modifiers.every((item) => typeof item === "string")))
  );
};

const isWireCurrentTab = (value: unknown): boolean =>
  isStringKeyedRecord(value) &&
  ["title", "url"].every((key) => hasOptionalString(value, key)) &&
  (typeof value.id === "undefined" || isBrowserTabId(value.id)) &&
  (typeof value.incognito === "undefined" || typeof value.incognito === "boolean");

const isValidationInfo = (value: unknown): value is ValidationInfo =>
  isStringKeyedRecord(value) &&
  [...WIRE_INFO_STRING_FIELDS, "srcUrl", "linkUrl"].every((key) => hasOptionalString(value, key)) &&
  (typeof value.sourceKind === "undefined" || isPageSourceKind(value.sourceKind)) &&
  ["suggestedFilename", "menuIndex", "comment"].every((key) =>
    hasOptionalNullableString(value, key),
  ) &&
  (typeof value.modifiers === "undefined" ||
    (Array.isArray(value.modifiers) &&
      value.modifiers.every((item) => typeof item === "string"))) &&
  (typeof value.preview === "undefined" || typeof value.preview === "boolean") &&
  (typeof value.contentFetchDisabled === "undefined" ||
    typeof value.contentFetchDisabled === "boolean") &&
  (typeof value.counter === "undefined" || isRoutingCounter(value.counter)) &&
  (typeof value.now === "undefined" ||
    (typeof value.now === "string" && Number.isFinite(new Date(value.now).getTime()))) &&
  (typeof value.currentTab === "undefined" ||
    value.currentTab === null ||
    isWireCurrentTab(value.currentTab));

const isAutomaticRoutingValidationCandidate = (
  value: unknown,
): value is AutomaticRoutingValidationCandidate =>
  isStringKeyedRecord(value) &&
  typeof value.pageUrl === "string" &&
  typeof value.sourceUrl === "string" &&
  isPageSourceKind(value.sourceKind) &&
  hasOptionalString(value, "suggestedFilename");

const isWireDownloadInfo = (value: unknown): value is WireDownloadInfo =>
  isStringKeyedRecord(value) &&
  WIRE_INFO_STRING_FIELDS.every((key) => hasOptionalString(value, key)) &&
  (typeof value.sourceKind === "undefined" || isPageSourceKind(value.sourceKind)) &&
  ["suggestedFilename", "menuIndex", "comment"].every((key) =>
    hasOptionalNullableString(value, key),
  ) &&
  (typeof value.modifiers === "undefined" ||
    (Array.isArray(value.modifiers) &&
      value.modifiers.every((item) => typeof item === "string"))) &&
  (typeof value.preview === "undefined" || typeof value.preview === "boolean") &&
  (typeof value.contentFetchDisabled === "undefined" ||
    typeof value.contentFetchDisabled === "boolean") &&
  (typeof value.counter === "undefined" || isRoutingCounter(value.counter)) &&
  hasOptionalString(value, "now") &&
  (typeof value.currentTab === "undefined" ||
    value.currentTab === null ||
    isWireCurrentTab(value.currentTab));

export const isWireDownloadState = (value: unknown): value is WireDownloadState =>
  isStringKeyedRecord(value) &&
  isWireDownloadInfo(value.info) &&
  hasOptionalString(value, "path") &&
  hasOptionalString(value, "route") &&
  (typeof value.routeIsFolder === "undefined" || typeof value.routeIsFolder === "boolean");

const isApiVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isDownloadBody = (value: unknown): value is DownloadRequestBody => {
  if (!isStringKeyedRecord(value)) {
    return false;
  }
  return (
    hasOptionalString(value, "url") &&
    (typeof value.target === "undefined" || value.target === "activeTab") &&
    hasOptionalString(value, "comment") &&
    (typeof value.version === "undefined" || isApiVersion(value.version)) &&
    (typeof value.info === "undefined" || isDownloadInfo(value.info))
  );
};

const hasOptionalBody = (
  message: Record<string, unknown>,
  validate: (body: unknown) => boolean,
): boolean => !("body" in message) || typeof message.body === "undefined" || validate(message.body);

const isMessageBodyValid = (message: Record<string, unknown> & { type: string }): boolean => {
  switch (message.type) {
    case MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE:
      return (
        isStringKeyedRecord(message.body) &&
        typeof message.body.pageUrl === "string" &&
        typeof message.body.sourceUrl === "string" &&
        isPageSourceKind(message.body.sourceKind)
      );
    case MESSAGE_TYPES.PREVIEW_MENUS:
      return hasOptionalBody(
        message,
        (body) => isStringKeyedRecord(body) && hasOptionalString(body, "paths"),
      );
    case MESSAGE_TYPES.CHECK_ROUTES:
      return hasOptionalBody(
        message,
        (body) =>
          isStringKeyedRecord(body) &&
          (typeof body.state === "undefined" || isWireDownloadState(body.state)),
      );
    case MESSAGE_TYPES.VALIDATE:
      return hasOptionalBody(
        message,
        (body) =>
          isStringKeyedRecord(body) &&
          hasOptionalString(body, "paths") &&
          hasOptionalString(body, "filenamePatterns") &&
          (typeof body.validationSource === "undefined" || body.validationSource === "webmcp") &&
          (typeof body.info === "undefined" || isValidationInfo(body.info)) &&
          (typeof body.automaticCandidate === "undefined" ||
            isAutomaticRoutingValidationCandidate(body.automaticCandidate)),
      );
    case MESSAGE_TYPES.APPLY_CONFIG:
      return hasOptionalBody(
        message,
        (body) =>
          isStringKeyedRecord(body) &&
          (typeof body.config === "undefined" || isStringKeyedRecord(body.config)) &&
          (typeof body.expected === "undefined" || isStringKeyedRecord(body.expected)),
      );
    case MESSAGE_TYPES.DOWNLOAD:
      return hasOptionalBody(message, isDownloadBody);
    case MESSAGE_TYPES.HISTORY_CANCEL:
      return isStringKeyedRecord(message.body) && typeof message.body.historyId === "string";
    case MESSAGE_TYPES.SOURCE_PANEL_STATE:
      return hasOptionalBody(
        message,
        (body) => isStringKeyedRecord(body) && typeof body.open === "boolean",
      );
    case MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR:
      return (
        "body" in message &&
        isStringKeyedRecord(message.body) &&
        typeof message.body.senderId === "string" &&
        message.body.senderId.length > 0
      );
    case MESSAGE_TYPES.WAKE_WARM:
    case MESSAGE_TYPES.SOURCE_PANEL_READY:
    case MESSAGE_TYPES.SOURCE_PANEL_COPY:
    case MESSAGE_TYPES.DIAGNOSTICS_GET:
    case MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES:
    case MESSAGE_TYPES.HISTORY_GET:
    case MESSAGE_TYPES.HISTORY_CLEAR:
    case MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET:
    case MESSAGE_TYPES.OPTIONS_LOADED:
    case MESSAGE_TYPES.OPTIONS:
    case MESSAGE_TYPES.OPTIONS_SCHEMA:
    case MESSAGE_TYPES.GET_KEYWORDS:
    case MESSAGE_TYPES.GET_GRAMMARS:
    case MESSAGE_TYPES.PING:
    case MESSAGE_TYPES.GET_SCHEMA:
    case MESSAGE_TYPES.GET_CONFIG:
      return hasNoBody(message);
  }
  return false;
};

export const isInternalMessage = (value: unknown): value is InternalMessage =>
  hasType(value) && isMessageBodyValid(value) && isInternalMessageType(value.type);

export const isExternalMessage = (value: unknown): value is ExternalMessage =>
  hasType(value) && isMessageBodyValid(value) && isExternalMessageType(value.type);

export const getMessageType = (value: unknown): string | undefined =>
  hasType(value) ? value.type : undefined;
