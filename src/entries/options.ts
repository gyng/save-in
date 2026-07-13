// Options-page entry point for the rolldown bundle. Side-effect-imports every
// script the options page loads, in options.html order (head scripts first,
// then body scripts). Emitted as bare scope-hoisted ESM and loaded as a classic
// script by the staged options.html. The e2e's evalOptions only reaches DOM +
// WebExtension API binding, so nothing here
// needs re-exposing on globalThis.

// <head> scripts
import "../platform/web-extension-api.ts";
import { localizeDocument } from "../options/l10n.ts";
import "../shared/constants.ts";
import "../platform/chrome-detector.ts";

// <body> scripts (options.html load order)
import "../options/options-logic.ts";
import "../options/history-view.ts";
import { renderHistory } from "../options/history-panel.ts";
import { confirmPendingChanges, setupOptionsPage } from "../options/options.ts";
import "../options/dismissible-details.ts";
import { setupPermissionsBanner } from "../options/permissions-banner.ts";
import "../options/clicktocopy.ts";
import "../options/autocomplete.ts";
import { setupPathEditor } from "../options/path-editor.ts";
import { setupRuleBuilder } from "../options/rule-builder.ts";
import { setupOptionsReferences } from "../options/options-reference.ts";
import { setupTabs } from "../options/tabs.ts";
import { setupOptionSearch } from "../options/option-search.ts";
import { setupSourceShortcut } from "../options/source-shortcut.ts";
import "../options/webmcp.ts";
import { setupAboutDialog } from "../options/about-dialog.ts";

document.addEventListener(
  "DOMContentLoaded",
  () => {
    localizeDocument();
    void renderHistory();
    setupOptionsPage();
    void setupPermissionsBanner();
    setupPathEditor();
    setupRuleBuilder();
    setupOptionsReferences();
    setupTabs({ confirmPendingChanges });
    setupOptionSearch();
    setupSourceShortcut();
    setupAboutDialog();
  },
  { once: true },
);
