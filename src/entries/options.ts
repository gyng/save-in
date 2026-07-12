// Options-page entry point for the rolldown bundle. Side-effect-imports every
// script the options page loads, in options.html order (head scripts first,
// then body scripts). Emitted as bare scope-hoisted ESM and loaded as a classic
// script by the staged options.html. The e2e's evalOptions only reaches DOM +
// WebExtension API binding, so nothing here
// needs re-exposing on globalThis.

// <head> scripts
import "../platform/web-extension-api.ts";
import "../options/l10n.ts";
import "../shared/constants.ts";
import "../platform/chrome-detector.ts";

// <body> scripts (options.html load order)
import "../options/options-logic.ts";
import "../options/history-view.ts";
import "../options/history-panel.ts";
import "../options/options.ts";
import "../options/dismissible-details.ts";
import "../options/permissions-banner.ts";
import "../options/clicktocopy.ts";
import "../options/autocomplete.ts";
import "../options/path-editor.ts";
import "../options/rule-builder.ts";
import "../options/options-reference.ts";
import "../options/tabs.ts";
import "../options/option-search.ts";
import "../options/source-shortcut.ts";
import "../options/webmcp.ts";
import "../options/about-dialog.ts";
