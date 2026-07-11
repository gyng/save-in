// Shared globals for the no-bundler background scripts (see AGENTS.md:
// plain scripts in one global scope, loaded in manifest order). These
// declarations back the opt-in `// @ts-check` files checked by
// `npm run typecheck`. They are intentionally loose in places — tighten
// them as more files opt in.

interface OptionError {
  message: string;
  error: string;
  warning?: boolean;
}

// info attached to a download state in menu-click.js / messaging.js
// constants.js
// Doubles as contextMenus contexts and as mediaType names, hence the intersection

// chrome-detector.js

// option.js — the loaded options bag; keys are option names

// module-object globals (one per src file); refine as files opt in
// download-state.js — the per-download record store (in-memory + storage.session)
// offscreen-client.js — Chrome SW side of the offscreen document
// util.js — small shared helpers (withUrl, splitLines)
// options page: path-editor.js (used by rule-builder.js for undoable edits)
// options page: history-view.js — pure history-table helpers
// options page: options-logic.js — pure helpers extracted from options.js
// Named Notifier/RequestHeaders (not Notification/Headers) so the runtime
// globals do not shadow the platform classes of the same name

// Chrome service worker entry (src/background.js); es2022+dom lib has no
// worker globals, so declare the one we use

// src/vendor/content-disposition.js
declare function getFilenameFromContentDispositionHeader(header: string): string | undefined;

// window-hosted mutable state; in the Chrome service worker `window`
// aliases `self` (src/background.js)
interface Window {
  SI_DEBUG?: boolean | number;
  ready?: Promise<unknown>;
  init: () => Promise<unknown>;
  reset: () => Promise<unknown>;
  optionErrors: {
    paths: OptionError[];
    filenamePatterns: OptionError[];
  };
  lastDownloadState?: import("../src/download-types.ts").DownloadPipelineState | null;
  // options page: tab-switch unsaved-changes guard (options.js)
  confirmPendingChanges?: () => void;
}

// Experimental WebMCP (Chrome origin trial) — not yet in lib.dom. Used by the
// options-page adapter in src/options/webmcp.js, which feature-detects it.
interface ModelContext {
  registerTool: (tool: any) => any;
  [k: string]: any;
}
interface Document {
  modelContext?: ModelContext;
}
interface Navigator {
  modelContext?: ModelContext;
}
