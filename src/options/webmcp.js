// EXPERIMENTAL — WebMCP (Chrome origin trial, https://developer.chrome.com/docs/ai/webmcp).
// Registers save-in's config + download tools on this page's document so an
// in-browser AI agent can discover and call them. It wraps the same messaging
// API (GET_SCHEMA / VALIDATE / APPLY_CONFIG / DOWNLOAD) documented in
// docs/INTEGRATIONS.md. No-op wherever document.modelContext is absent, and the
// API surface is explicitly "subject to change" — treat this as a preview.

const SaveInWebMCP = {
  // The imperative API moved from navigator.* to document.* (Chrome 150); try
  // both so this keeps working across the origin trial
  getModelContext: () =>
    (typeof document !== "undefined" && document.modelContext) ||
    (typeof navigator !== "undefined" && navigator.modelContext) ||
    null,

  // `send` messages the background and resolves to the response body; injected
  // so the tools stay testable
  buildTools: (send) => [
    {
      name: "save_in_get_schema",
      description: "List Save In's configurable options (name, type, default, description).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => send({ type: "GET_SCHEMA" }),
    },
    {
      name: "save_in_validate_config",
      description:
        "Dry-run Save In directory paths and/or routing rules. Returns errors and a menu preview without saving. Call this before save_in_apply_config for paths/filenamePatterns.",
      inputSchema: {
        type: "object",
        properties: {
          paths: { type: "string", description: "Directory menu structure, one path per line" },
          filenamePatterns: { type: "string", description: "Routing / rename rules" },
        },
      },
      execute: (input) => send({ type: "VALIDATE", body: input || {} }),
    },
    {
      name: "save_in_apply_config",
      description:
        "Apply a partial Save In configuration, validated against the schema (unknown keys and type mismatches are rejected).",
      inputSchema: {
        type: "object",
        properties: {
          config: {
            type: "object",
            description: "Partial { optionName: value } map (see save_in_get_schema)",
          },
        },
        required: ["config"],
      },
      execute: (input) =>
        send({ type: "APPLY_CONFIG", body: { config: (input && input.config) || {} } }),
    },
    {
      name: "save_in_download",
      description: "Save a URL through Save In's routing and rename rules.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to save" },
          pageUrl: { type: "string", description: "The page the URL came from" },
          comment: { type: "string", description: "Free text, targetable in routing rules" },
        },
        required: ["url"],
      },
      execute: (input) =>
        send({
          type: "DOWNLOAD",
          body: {
            url: input && input.url,
            info: { pageUrl: input && input.pageUrl, srcUrl: input && input.url },
            comment: input && input.comment,
          },
        }),
    },
  ],

  register: (ctx, send) => {
    SaveInWebMCP.buildTools(send).forEach((tool) => {
      try {
        // registerTool may return a promise; never let a preview-API hiccup
        // break the options page
        Promise.resolve(ctx.registerTool(tool)).catch(() => {});
      } catch {
        // ignore — experimental surface
      }
    });
  },
};

// Auto-register on the options page when a WebMCP context is present, and
// reflect the outcome in the options-page status line
(() => {
  const ctx = SaveInWebMCP.getModelContext();
  const statusEl =
    typeof document !== "undefined" && document.getElementById
      ? document.getElementById("webmcp-status")
      : null;

  if (ctx && typeof ctx.registerTool === "function" && typeof browser !== "undefined") {
    const count = SaveInWebMCP.buildTools(() => {}).length;
    SaveInWebMCP.register(ctx, (message) =>
      browser.runtime.sendMessage(message).then((res) => (res && res.body) || res),
    );
    if (statusEl) {
      statusEl.textContent = `Active — ${count} tools registered`;
    }
  } else if (statusEl) {
    statusEl.textContent = "Not available in this browser";
  }
})();

if (typeof module !== "undefined") {
  module.exports = SaveInWebMCP;
}
