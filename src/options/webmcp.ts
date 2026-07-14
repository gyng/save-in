import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { isStringKeyedRecord, withUrl } from "../shared/util.ts";
import { isPageSourceKind, PAGE_SOURCE_KINDS } from "../shared/page-source.ts";

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
const AUTOMATIC_CANDIDATE_PROPERTIES = new Set(["pageUrl", "sourceUrl", "sourceKind"]);
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
  "context",
  "menuIndex",
  "comment",
];
const TRACE_CURRENT_TAB_STRING_FIELDS = ["title"];
const TRACE_CURRENT_TAB_PROPERTIES = new Set(TRACE_CURRENT_TAB_STRING_FIELDS);
const TRACE_PROPERTIES = new Set([...TRACE_STRING_FIELDS, "currentTab"]);
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
// API (GET_SCHEMA / VALIDATE / APPLY_CONFIG / DOWNLOAD) documented in
// docs/INTEGRATIONS.md. No-op wherever document.modelContext is absent, and the
// API surface is explicitly "subject to change" — treat this as a preview.

export const SaveInWebMCP = {
  // The imperative API moved from navigator.* to document.* (Chrome 150); try
  // both so this keeps working across the origin trial
  getModelContext: (): WebMcpContext | null => {
    const context =
      (typeof document !== "undefined" && document.modelContext) ||
      (typeof navigator !== "undefined" && navigator.modelContext) ||
      null;
    return context ? { registerTool: (tool) => context.registerTool(tool) } : null;
  },

  // `send` messages the background and resolves to the response body; injected
  // so the tools stay testable
  buildTools: (send: WebMcpSend): WebMcpTool[] => {
    const tools: PreparedWebMcpTool[] = [
      {
        name: "save_in_get_schema",
        description: "List Save In's configurable options (name, type, default, description).",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input) => {
          const unknown = firstUnknownProperty(input, NO_PROPERTIES);
          return unknown
            ? inputError(unknown.field, unknown.message)
            : send({ type: "GET_SCHEMA" });
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
                context: { type: "string" },
                menuIndex: { type: "string" },
                comment: { type: "string" },
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
              if (tabError)
                return inputError(`info.currentTab.${tabError.field}`, tabError.message);
            }
          }
          const candidate = input.automaticCandidate;
          if (typeof candidate !== "undefined") {
            if (!isStringKeyedRecord(candidate)) {
              return inputError("automaticCandidate", "Expected an object");
            }
            const unknownCandidate = firstUnknownProperty(
              candidate,
              AUTOMATIC_CANDIDATE_PROPERTIES,
            );
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
            if (!hasOwn(input, "filenamePatterns")) {
              return inputError("automaticCandidate", "Provide filenamePatterns to trace");
            }
          }
          if (!hasOwn(input, "paths") && !hasOwn(input, "filenamePatterns")) {
            return inputError("$", "Provide paths or filenamePatterns");
          }
          return send({ type: "VALIDATE", body: input });
        },
      },
      {
        name: "save_in_apply_config",
        description:
          "Immediately validate, persist, and activate a partial Save In configuration. Unknown keys and type mismatches are rejected; omitted settings remain unchanged.",
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
          return send({ type: "APPLY_CONFIG", body: { config: input.config } });
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
  },

  register: async (ctx: WebMcpContext, send: WebMcpSend): Promise<number> => {
    const registrations = SaveInWebMCP.buildTools(send).map((tool) => {
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
  },
};

export const setupWebMcpStatus = (localize: typeof getMessage = getMessage): void => {
  const ctx = SaveInWebMCP.getModelContext();
  const statusEl = document.getElementById("webmcp-status");

  if (ctx && typeof ctx.registerTool === "function" && webExtensionApi) {
    const count = SaveInWebMCP.buildTools((message) =>
      webExtensionApi.runtime.sendMessage(message),
    ).length;
    if (statusEl) statusEl.textContent = localize("webMcpStatusRegistering") || "Registering…";
    void SaveInWebMCP.register(ctx, (message: WebMcpMessage) =>
      webExtensionApi.runtime.sendMessage(message).then((res) => (res && res.body) || res),
    ).then((registered) => {
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
