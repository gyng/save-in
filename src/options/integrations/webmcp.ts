import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { getMessage } from "../../platform/localization.ts";
import { isStringKeyedRecord, withUrl } from "../../shared/util.ts";
import { isPageSourceKind, PAGE_SOURCE_KINDS } from "../../shared/page-source.ts";
import { cssSelectorErrors } from "../core/css-selector-validation.ts";
import { CLICK_GESTURES, isClickGesture } from "../../shared/click-gesture.ts";

type WebMcpMessage = { type: string; body?: unknown };
type WebMcpSend = (message: WebMcpMessage) => unknown;
type WebMcpSchema = {
  type: string;
  properties: Record<string, unknown>;
  additionalProperties?: boolean;
  required?: string[];
};
type WebMcpAnnotations = {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
};
type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: WebMcpSchema;
  annotations: WebMcpAnnotations;
  execute: (input?: unknown) => unknown;
};
type PreparedWebMcpTool = Omit<WebMcpTool, "execute"> & {
  execute: (input: Record<string, unknown>) => unknown;
};
type WebMcpContext = { registerTool: (tool: WebMcpTool) => unknown };

type WebMcpInputError = { field: string; message: string };
const MAX_INPUT_CHARACTERS = 1_000_000;

const inputError = (field: string, message: string): Promise<unknown> =>
  Promise.resolve({ status: "ERROR", errors: [{ field, message }] });

const prepareInput = (
  value: unknown,
): { input: Record<string, unknown> } | { error: WebMcpInputError } => {
  if (typeof value === "undefined") return { input: {} };
  if (!isStringKeyedRecord(value)) {
    return { error: { field: "$", message: "Expected an object" } };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_INPUT_CHARACTERS) {
      return { error: { field: "$", message: "Input is too large" } };
    }
    Object.keys(value);
  } catch {
    return { error: { field: "$", message: "Expected a JSON-compatible object" } };
  }
  return { input: value };
};

const unavailableError = () => ({
  status: "ERROR",
  errors: [{ field: "$", message: "Save In is temporarily unavailable" }],
});

const invalidOptionalString = (
  input: Record<string, unknown>,
  key: string,
): WebMcpInputError | null =>
  typeof input[key] !== "undefined" && typeof input[key] !== "string"
    ? { field: key, message: "Expected a string" }
    : null;

const firstInvalidOptionalString = (
  input: Record<string, unknown>,
  keys: string[],
): WebMcpInputError | null => {
  for (const key of keys) {
    const error = invalidOptionalString(input, key);
    if (error) return error;
  }
  return null;
};

const firstUnknownProperty = (
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): WebMcpInputError | null => {
  const field = Object.keys(input).find((key) => !allowed.has(key));
  return field ? { field, message: "Unknown property" } : null;
};

// The option the registration gate below reads. Named here because the tools
// must refuse to write the one switch that decides whether they exist.
const WEBMCP_ENABLED_OPTION = "webmcpEnabled";
const WEBMCP_ENABLED_REFUSAL = "Only the user can turn agent access on or off.";

const NO_PROPERTIES = new Set<string>();
const VALIDATE_PROPERTIES = new Set(["paths", "filenamePatterns", "info", "automaticCandidate"]);
const APPLY_PROPERTIES = new Set(["config"]);
const DOWNLOAD_PROPERTIES = new Set([
  "url",
  "pageUrl",
  "comment",
  "suggestedFilename",
  "mime",
  "mediaType",
  "sourceKind",
]);
const AUTOMATIC_CANDIDATE_PROPERTIES = new Set([
  "pageUrl",
  "sourceUrl",
  "sourceKind",
  "suggestedFilename",
  "currentTab",
]);
const TRACE_STRING_FIELDS = [
  "srcUrl",
  "url",
  "sourceUrl",
  "linkUrl",
  "pageUrl",
  "frameUrl",
  "linkText",
  "mediaType",
  "mime",
  "referrerUrl",
  "selectionText",
  "filename",
  "initialFilename",
  "resolvedFilename",
  "context",
  "gesture",
  "menuIndex",
  "comment",
  "sha256",
];
const TRACE_CURRENT_TAB_STRING_FIELDS = ["title"];
const TRACE_CURRENT_TAB_PROPERTIES = new Set(TRACE_CURRENT_TAB_STRING_FIELDS);
const TRACE_PROPERTIES = new Set([
  ...TRACE_STRING_FIELDS,
  "sourceKind",
  "counter",
  "now",
  "currentTab",
]);
const hasOwn = (input: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(input, key);
const isValidDownloadUrl = (url: string) =>
  withUrl(
    url,
    (parsed) => ["http:", "https:", "ftp:", "data:", "blob:"].includes(parsed.protocol),
    false,
  );

// EXPERIMENTAL — WebMCP (Chrome origin trial, https://developer.chrome.com/docs/ai/webmcp).
// Registers save-in's config + download tools on this page's document so an
// in-browser AI agent can discover and call them. It wraps the same messaging
// API (GET_SCHEMA / GET_CONFIG / VALIDATE / APPLY_CONFIG / DOWNLOAD) documented in
// docs/integrating/INTEGRATIONS.md. No-op wherever document.modelContext is absent, and the
// API surface is explicitly "subject to change" — treat this as a preview.

// The imperative API moved from navigator.* to document.* (Chrome 150); try
// both so this keeps working across the origin trial
export const getModelContext = (): WebMcpContext | null => {
  const context =
    (typeof document !== "undefined" && document.modelContext) ||
    (typeof navigator !== "undefined" && navigator.modelContext) ||
    null;
  return context ? { registerTool: (tool) => context.registerTool(tool) } : null;
};

// `send` messages the background and resolves to the response body; injected
// so the tools stay testable
export const buildTools = (send: WebMcpSend): WebMcpTool[] => {
  const tools: PreparedWebMcpTool[] = [
    {
      name: "save_in_get_schema",
      description: "List Save In's configurable options (name, type, default, description).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, NO_PROPERTIES);
        return unknown ? inputError(unknown.field, unknown.message) : send({ type: "GET_SCHEMA" });
      },
    },
    {
      name: "save_in_get_config",
      description:
        "Read current saved settings in the same option-name/value format accepted by save_in_apply_config.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, NO_PROPERTIES);
        return unknown ? inputError(unknown.field, unknown.message) : send({ type: "GET_CONFIG" });
      },
    },
    {
      name: "save_in_list_vocabulary",
      description:
        "List path variables, routing matchers, automatic-source matchers, and source kinds. Use this to translate a request into supported config vocabulary.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, NO_PROPERTIES);
        return unknown
          ? inputError(unknown.field, unknown.message)
          : send({ type: "GET_KEYWORDS" });
      },
    },
    {
      name: "save_in_get_grammars",
      description:
        "Return the EBNF, semantic constraints, option name, and examples for each editable Save In language.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, NO_PROPERTIES);
        return unknown
          ? inputError(unknown.field, unknown.message)
          : send({ type: "GET_GRAMMARS" });
      },
    },
    {
      name: "save_in_validate_config",
      description:
        "Dry-run directory and routing rules without saving. Optionally trace unified automatic routing against a sample page source.",
      inputSchema: {
        type: "object",
        properties: {
          paths: { type: "string", description: "Directory menu structure, one path per line" },
          filenamePatterns: { type: "string", description: "Routing / rename rules" },
          automaticCandidate: {
            type: "object",
            description: "Sample page source for a context: ^auto$ routing trace",
            properties: {
              pageUrl: { type: "string" },
              sourceUrl: { type: "string" },
              sourceKind: { type: "string", enum: [...PAGE_SOURCE_KINDS] },
              suggestedFilename: {
                type: "string",
                description: "Optional filename hint; defaults to the source URL filename",
              },
              currentTab: {
                type: "object",
                description: "The page being saved from; supplies :pagetitle: naming",
                properties: { title: { type: "string" } },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
            required: ["pageUrl", "sourceUrl", "sourceKind"],
          },
          info: {
            type: "object",
            description:
              "Sample matcher values; use srcUrl/sourceUrl for the resource and currentTab.title for page title.",
            properties: {
              srcUrl: { type: "string" },
              url: { type: "string" },
              sourceUrl: { type: "string" },
              linkUrl: { type: "string" },
              pageUrl: { type: "string" },
              frameUrl: { type: "string" },
              linkText: { type: "string" },
              mediaType: { type: "string" },
              mime: { type: "string" },
              referrerUrl: { type: "string" },
              selectionText: { type: "string" },
              filename: { type: "string" },
              initialFilename: { type: "string" },
              resolvedFilename: { type: "string" },
              context: { type: "string" },
              gesture: { type: "string", enum: Object.values(CLICK_GESTURES) },
              menuIndex: { type: "string" },
              comment: { type: "string" },
              sourceKind: { type: "string", enum: [...PAGE_SOURCE_KINDS] },
              counter: { type: "integer", minimum: 0 },
              now: { type: "string", format: "date-time" },
              sha256: { type: "string" },
              currentTab: {
                type: "object",
                properties: { title: { type: "string" } },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const error =
          firstUnknownProperty(input, VALIDATE_PROPERTIES) ||
          firstInvalidOptionalString(input, ["paths", "filenamePatterns"]);
        if (error) return inputError(error.field, error.message);
        if (typeof input.info !== "undefined" && !isStringKeyedRecord(input.info)) {
          return inputError("info", "Expected an object");
        }
        if (isStringKeyedRecord(input.info)) {
          const unknownInfo = firstUnknownProperty(input.info, TRACE_PROPERTIES);
          if (unknownInfo) return inputError(`info.${unknownInfo.field}`, unknownInfo.message);
          const infoError = firstInvalidOptionalString(input.info, TRACE_STRING_FIELDS);
          if (infoError) return inputError(`info.${infoError.field}`, infoError.message);
          if (
            typeof input.info.sourceKind !== "undefined" &&
            !isPageSourceKind(input.info.sourceKind)
          ) {
            return inputError("info.sourceKind", "Unknown source kind");
          }
          if (typeof input.info.gesture !== "undefined" && !isClickGesture(input.info.gesture)) {
            return inputError("info.gesture", "Unknown click gesture");
          }
          if (
            typeof input.info.counter !== "undefined" &&
            (typeof input.info.counter !== "number" ||
              !Number.isSafeInteger(input.info.counter) ||
              input.info.counter < 0)
          ) {
            return inputError("info.counter", "Expected a non-negative integer");
          }
          if (
            typeof input.info.now !== "undefined" &&
            (typeof input.info.now !== "string" ||
              !Number.isFinite(new Date(input.info.now).getTime()))
          ) {
            return inputError("info.now", "Expected an ISO date and time");
          }
          const currentTab = input.info.currentTab;
          if (typeof currentTab !== "undefined" && !isStringKeyedRecord(currentTab)) {
            return inputError("info.currentTab", "Expected an object");
          }
          if (isStringKeyedRecord(currentTab)) {
            const unknownTab = firstUnknownProperty(currentTab, TRACE_CURRENT_TAB_PROPERTIES);
            if (unknownTab)
              return inputError(`info.currentTab.${unknownTab.field}`, unknownTab.message);
            const tabError = firstInvalidOptionalString(
              currentTab,
              TRACE_CURRENT_TAB_STRING_FIELDS,
            );
            if (tabError) return inputError(`info.currentTab.${tabError.field}`, tabError.message);
          }
        }
        const candidate = input.automaticCandidate;
        if (typeof candidate !== "undefined") {
          if (!isStringKeyedRecord(candidate)) {
            return inputError("automaticCandidate", "Expected an object");
          }
          const unknownCandidate = firstUnknownProperty(candidate, AUTOMATIC_CANDIDATE_PROPERTIES);
          if (unknownCandidate) {
            return inputError(
              `automaticCandidate.${unknownCandidate.field}`,
              unknownCandidate.message,
            );
          }
          for (const field of ["pageUrl", "sourceUrl", "sourceKind"] as const) {
            if (typeof candidate[field] !== "string" || candidate[field] === "") {
              return inputError(`automaticCandidate.${field}`, "Expected a non-empty string");
            }
          }
          if (!isPageSourceKind(candidate.sourceKind)) {
            return inputError("automaticCandidate.sourceKind", "Unknown source kind");
          }
          const filenameError = invalidOptionalString(candidate, "suggestedFilename");
          if (filenameError) {
            return inputError(`automaticCandidate.${filenameError.field}`, filenameError.message);
          }
          const candidateTab = candidate.currentTab;
          if (typeof candidateTab !== "undefined") {
            if (!isStringKeyedRecord(candidateTab)) {
              return inputError("automaticCandidate.currentTab", "Expected an object");
            }
            const unknownTab = firstUnknownProperty(candidateTab, TRACE_CURRENT_TAB_PROPERTIES);
            if (unknownTab) {
              return inputError(
                `automaticCandidate.currentTab.${unknownTab.field}`,
                unknownTab.message,
              );
            }
            const tabError = firstInvalidOptionalString(
              candidateTab,
              TRACE_CURRENT_TAB_STRING_FIELDS,
            );
            if (tabError) {
              return inputError(
                `automaticCandidate.currentTab.${tabError.field}`,
                tabError.message,
              );
            }
          }
          if (!hasOwn(input, "filenamePatterns")) {
            return inputError("automaticCandidate", "Provide filenamePatterns to trace");
          }
        }
        if (!hasOwn(input, "paths") && !hasOwn(input, "filenamePatterns")) {
          return inputError("$", "Provide paths or filenamePatterns");
        }
        return send({
          type: "VALIDATE",
          body: { ...input, validationSource: "webmcp" },
        });
      },
    },
    {
      name: "save_in_apply_config",
      description:
        "Validate and immediately apply each valid setting. The result lists applied and rejected keys; a mixed request can partially succeed. Omitted settings remain unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          config: {
            type: "object",
            description: "Partial { optionName: value } map (see save_in_get_schema)",
          },
        },
        additionalProperties: false,
        required: ["config"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, APPLY_PROPERTIES);
        if (unknown) return inputError(unknown.field, unknown.message);
        if (!isStringKeyedRecord(input.config)) {
          return inputError("config", "Expected an object");
        }
        if (Object.keys(input.config).length === 0) {
          return inputError("config", "Provide at least one setting");
        }
        // Two keys this layer refuses, for reasons the background cannot have:
        // a css: selector is only checkable where there is a DOM, and the
        // switch that decides whether these tools exist is not one of the
        // settings they may set — an agent able to turn it back on would
        // outlive the moment the user withdrew its access, and the checkbox
        // would re-check itself saying so. Refusing the whole request would
        // drop the caller's other valid settings without naming them, so
        // reject just these the way the background rejects every other one.
        const patterns = input.config.filenamePatterns;
        const invalidCss =
          typeof patterns === "string" ? cssSelectorErrors(patterns)[0] : undefined;
        const rejections = [
          ...(invalidCss ? [{ name: "filenamePatterns", reason: invalidCss.message }] : []),
          ...(Object.hasOwn(input.config, WEBMCP_ENABLED_OPTION)
            ? [{ name: WEBMCP_ENABLED_OPTION, reason: WEBMCP_ENABLED_REFUSAL }]
            : []),
        ];
        // Nothing refused is the ordinary case, and an empty list is the same
        // thing as having no first entry — so let the narrowing say it once.
        const [first] = rejections;
        if (!first) return send({ type: "APPLY_CONFIG", body: { config: input.config } });

        const refused = new Set(rejections.map(({ name }) => name));
        const rest = Object.fromEntries(
          Object.entries(input.config).filter(([name]) => !refused.has(name)),
        );
        if (Object.keys(rest).length === 0) {
          return inputError(`config.${first.name}`, first.reason);
        }
        return Promise.resolve(send({ type: "APPLY_CONFIG", body: { config: rest } })).then(
          (response) =>
            isStringKeyedRecord(response) && Array.isArray(response.rejected)
              ? { ...response, rejected: [...response.rejected, ...rejections] }
              : response,
        );
      },
    },
    {
      name: "save_in_download",
      description:
        "Immediately start saving one URL through Save In's current routing and rename rules. Returns acceptance, not download completion.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "An http, https, ftp, data, or blob URL to save",
          },
          pageUrl: { type: "string", description: "The page the URL came from" },
          comment: { type: "string", description: "Free text, targetable in routing rules" },
          suggestedFilename: { type: "string", description: "Preferred source filename" },
          mime: { type: "string", description: "Source MIME type" },
          mediaType: { type: "string", description: "Browser media category" },
          sourceKind: { type: "string", enum: [...PAGE_SOURCE_KINDS] },
        },
        additionalProperties: false,
        required: ["url"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => {
        const unknown = firstUnknownProperty(input, DOWNLOAD_PROPERTIES);
        if (unknown) return inputError(unknown.field, unknown.message);
        if (typeof input.url !== "string" || input.url.trim() === "") {
          return inputError("url", "Expected a non-empty string");
        }
        const error = firstInvalidOptionalString(input, [
          "pageUrl",
          "comment",
          "suggestedFilename",
          "mime",
          "mediaType",
          "sourceKind",
        ]);
        if (error) return inputError(error.field, error.message);
        if (typeof input.sourceKind !== "undefined" && !isPageSourceKind(input.sourceKind)) {
          return inputError("sourceKind", "Unknown source kind");
        }
        const url = input.url.trim();
        if (!isValidDownloadUrl(url)) {
          return inputError("url", "Use an http, https, ftp, data, or blob URL");
        }
        const pageUrl = typeof input.pageUrl === "string" ? input.pageUrl.trim() : undefined;
        return send({
          type: "DOWNLOAD",
          body: {
            url,
            info: {
              pageUrl: pageUrl || undefined,
              srcUrl: url,
              suggestedFilename: input.suggestedFilename,
              mime: input.mime,
              mediaType: input.mediaType,
              sourceKind: input.sourceKind,
            },
            comment: input.comment,
          },
        });
      },
    },
  ];
  return tools.map((tool) => ({
    ...tool,
    execute: (value?: unknown) => {
      const prepared = prepareInput(value);
      if ("error" in prepared) {
        return inputError(prepared.error.field, prepared.error.message);
      }
      try {
        return Promise.resolve(tool.execute(prepared.input))
          .then((result) => (result == null ? unavailableError() : result))
          .catch(unavailableError);
      } catch {
        return Promise.resolve(unavailableError());
      }
    },
  }));
};

export const registerWebMcp = async (ctx: WebMcpContext, send: WebMcpSend): Promise<number> => {
  const registrations = buildTools(send).map((tool) => {
    try {
      return Promise.resolve(ctx.registerTool(tool)).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  });
  const results = await Promise.all(registrations);
  return results.filter(Boolean).length;
};

export const setupWebMcpStatus = (
  localize: typeof getMessage = getMessage,
  onConfigApplied?: (applied: Record<string, unknown>) => Promise<void> | void,
): void => {
  const ctx = getModelContext();
  const statusEl = document.getElementById("webmcp-status");
  // The tools an agent can call read and change every setting, so a browser
  // that supports WebMCP is not on its own a reason to hand them over: the
  // switch is. An absent switch cannot say the user opted in, so it does not.
  // Whether the browser supports WebMCP at all is reported either way — it is
  // true regardless of the switch, and it is what a user who turns the switch
  // on in the wrong browser needs to be told.
  const enabled = document.querySelector<HTMLInputElement>("#webmcpEnabled")?.checked === true;

  if (ctx && typeof ctx.registerTool === "function" && webExtensionApi && !enabled) {
    if (statusEl) statusEl.textContent = localize("webMcpStatusOff") || "Off";
    return;
  }

  if (ctx && typeof ctx.registerTool === "function" && webExtensionApi) {
    const send = async (message: WebMcpMessage) => {
      const response = await webExtensionApi.runtime.sendMessage(message);
      const body = (response && response.body) || response;
      if (
        message.type === "APPLY_CONFIG" &&
        isStringKeyedRecord(body) &&
        isStringKeyedRecord(body.applied) &&
        Object.keys(body.applied).length > 0
      ) {
        // Persistence has already succeeded. A failed page refresh must not
        // misreport the config mutation as a failed tool call.
        await Promise.resolve(onConfigApplied?.(body.applied)).catch(() => {});
      }
      return body;
    };
    const count = buildTools(send).length;
    if (statusEl) statusEl.textContent = localize("webMcpStatusRegistering") || "Registering…";
    void registerWebMcp(ctx, send).then((registered) => {
      if (!statusEl) return;
      statusEl.textContent =
        registered === count
          ? localize("webMcpStatusActive", [count]) || `Active — ${count} tools registered`
          : registered > 0
            ? localize("webMcpStatusLimited", [registered, count]) ||
              `Limited — ${registered} of ${count} tools registered`
            : localize("webMcpStatusRegistrationFailed") ||
              "Unavailable — tool registration failed";
    });
  } else if (statusEl) {
    statusEl.textContent =
      localize("webMcpStatusUnavailableBrowser") || "Not available in this browser";
  }
};
