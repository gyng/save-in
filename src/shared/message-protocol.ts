import { MESSAGE_TYPES } from "./constants.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";

type Message<T extends string, B = never> = [B] extends [never]
  ? { type: T }
  : { type: T; body?: B | undefined };

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
      > & { srcUrl?: string | undefined })
    | undefined;
  comment?: string | undefined;
  version?: number | undefined;
};

export type InternalMessage =
  | Message<typeof MESSAGE_TYPES.WAKE_WARM>
  | Message<typeof MESSAGE_TYPES.SOURCE_PANEL_READY>
  | Message<typeof MESSAGE_TYPES.SOURCE_PANEL_STATE, { open?: boolean }>
  | Message<typeof MESSAGE_TYPES.HISTORY_GET>
  | Message<typeof MESSAGE_TYPES.HISTORY_CLEAR>
  | Message<typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET>
  | Message<typeof MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR, { senderId: string }>
  | Message<typeof MESSAGE_TYPES.OPTIONS_LOADED>
  | Message<typeof MESSAGE_TYPES.OPTIONS>
  | Message<typeof MESSAGE_TYPES.OPTIONS_SCHEMA>
  | Message<typeof MESSAGE_TYPES.GET_KEYWORDS>
  | Message<typeof MESSAGE_TYPES.PREVIEW_MENUS, { paths?: string }>
  | Message<typeof MESSAGE_TYPES.CHECK_ROUTES, { state?: DownloadPipelineState }>
  | Message<typeof MESSAGE_TYPES.PING>
  | Message<typeof MESSAGE_TYPES.GET_SCHEMA>
  | Message<
      typeof MESSAGE_TYPES.VALIDATE,
      {
        paths?: string;
        filenamePatterns?: string;
        info?: Partial<DownloadInfo> & { srcUrl?: string };
      }
    >
  | Message<
      typeof MESSAGE_TYPES.APPLY_CONFIG,
      { config?: Record<string, unknown>; expected?: Record<string, unknown> }
    >
  | Message<typeof MESSAGE_TYPES.DOWNLOAD, DownloadRequestBody>;

export type ExternalMessage = Extract<
  InternalMessage,
  | { type: typeof MESSAGE_TYPES.PING }
  | { type: typeof MESSAGE_TYPES.GET_SCHEMA }
  | { type: typeof MESSAGE_TYPES.VALIDATE }
  | { type: typeof MESSAGE_TYPES.DOWNLOAD }
>;

export type MessageOf<
  T extends InternalMessage["type"],
  M extends InternalMessage = InternalMessage,
> = Extract<M, { type: T }>;

export const INTERNAL_MESSAGE_TYPES = new Set<InternalMessage["type"]>([
  MESSAGE_TYPES.WAKE_WARM,
  MESSAGE_TYPES.SOURCE_PANEL_READY,
  MESSAGE_TYPES.SOURCE_PANEL_STATE,
  MESSAGE_TYPES.HISTORY_GET,
  MESSAGE_TYPES.HISTORY_CLEAR,
  MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
  MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
  MESSAGE_TYPES.OPTIONS_LOADED,
  MESSAGE_TYPES.OPTIONS,
  MESSAGE_TYPES.OPTIONS_SCHEMA,
  MESSAGE_TYPES.GET_KEYWORDS,
  MESSAGE_TYPES.PREVIEW_MENUS,
  MESSAGE_TYPES.CHECK_ROUTES,
  MESSAGE_TYPES.PING,
  MESSAGE_TYPES.GET_SCHEMA,
  MESSAGE_TYPES.VALIDATE,
  MESSAGE_TYPES.APPLY_CONFIG,
  MESSAGE_TYPES.DOWNLOAD,
]);

export const EXTERNAL_MESSAGE_TYPES = new Set<ExternalMessage["type"]>([
  MESSAGE_TYPES.PING,
  MESSAGE_TYPES.GET_SCHEMA,
  MESSAGE_TYPES.VALIDATE,
  MESSAGE_TYPES.DOWNLOAD,
]);

const hasType = (value: unknown): value is Record<string, unknown> & { type: string } =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";

export const isStringKeyedRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    ["pageUrl", "srcUrl", "selectionText", "linkText", "suggestedFilename"].every((key) =>
      hasOptionalString(value, key),
    ) &&
    ["menuIndex", "comment"].every((key) => hasOptionalNullableString(value, key)) &&
    (typeof value.modifiers === "undefined" ||
      (Array.isArray(value.modifiers) && value.modifiers.every((item) => typeof item === "string")))
  );
};

const isValidationInfo = (value: unknown): boolean =>
  isStringKeyedRecord(value) &&
  ["srcUrl", "url", "sourceUrl", "linkUrl", "pageUrl", "filename", "initialFilename"].every((key) =>
    hasOptionalString(value, key),
  ) &&
  hasOptionalNullableString(value, "comment");

const isDownloadBody = (value: unknown): value is DownloadRequestBody => {
  if (!isStringKeyedRecord(value)) {
    return false;
  }
  return (
    hasOptionalString(value, "url") &&
    (typeof value.target === "undefined" || value.target === "activeTab") &&
    hasOptionalString(value, "comment") &&
    (typeof value.version === "undefined" ||
      (typeof value.version === "number" && Number.isFinite(value.version))) &&
    (typeof value.info === "undefined" || isDownloadInfo(value.info))
  );
};

const hasOptionalBody = (
  message: Record<string, unknown>,
  validate: (body: unknown) => boolean,
): boolean => !("body" in message) || typeof message.body === "undefined" || validate(message.body);

const isMessageBodyValid = (message: Record<string, unknown>): boolean => {
  switch (message.type) {
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
          (typeof body.state === "undefined" ||
            (isStringKeyedRecord(body.state) && isStringKeyedRecord(body.state.info))),
      );
    case MESSAGE_TYPES.VALIDATE:
      return hasOptionalBody(
        message,
        (body) =>
          isStringKeyedRecord(body) &&
          hasOptionalString(body, "paths") &&
          hasOptionalString(body, "filenamePatterns") &&
          (typeof body.info === "undefined" || isValidationInfo(body.info)),
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
    case MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR:
      return (
        "body" in message &&
        isStringKeyedRecord(message.body) &&
        typeof message.body.senderId === "string" &&
        message.body.senderId.length > 0
      );
    case MESSAGE_TYPES.SOURCE_PANEL_STATE:
      return hasOptionalBody(
        message,
        (body) => isStringKeyedRecord(body) && typeof body.open === "boolean",
      );
    case MESSAGE_TYPES.WAKE_WARM:
    case MESSAGE_TYPES.SOURCE_PANEL_READY:
    case MESSAGE_TYPES.HISTORY_GET:
    case MESSAGE_TYPES.HISTORY_CLEAR:
    case MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET:
    case MESSAGE_TYPES.OPTIONS_LOADED:
    case MESSAGE_TYPES.OPTIONS:
    case MESSAGE_TYPES.OPTIONS_SCHEMA:
    case MESSAGE_TYPES.GET_KEYWORDS:
    case MESSAGE_TYPES.PING:
    case MESSAGE_TYPES.GET_SCHEMA:
      return hasNoBody(message);
    default:
      return false;
  }
};

export const isInternalMessage = (value: unknown): value is InternalMessage =>
  hasType(value) &&
  INTERNAL_MESSAGE_TYPES.has(value.type as InternalMessage["type"]) &&
  isMessageBodyValid(value);

export const isExternalMessage = (value: unknown): value is ExternalMessage =>
  hasType(value) &&
  EXTERNAL_MESSAGE_TYPES.has(value.type as ExternalMessage["type"]) &&
  isMessageBodyValid(value);

export const getMessageType = (value: unknown): string | undefined =>
  hasType(value) ? value.type : undefined;
