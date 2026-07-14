// Options-page entry point for the rolldown bundle. Side-effect-imports every
// script the options page loads, in options.html order (head scripts first,
// then body scripts). Emitted as bare scope-hoisted ESM and loaded as a classic
// script by the staged options.html. The e2e's evalOptions only reaches DOM +
// WebExtension API binding, so nothing here
// needs re-exposing on globalThis.

// <head> scripts
import "../platform/web-extension-api.ts";
import { localizeDocument, setDocumentLanguage } from "../options/l10n.ts";
import { getMessage, initializeLocalization } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import "../platform/chrome-detector.ts";

// <body> scripts (options.html load order)
import "../options/options-logic.ts";
import "../options/history-view.ts";
import { renderHistory, setHistoryLocalizer } from "../options/history-panel.ts";
import {
  confirmPendingChanges,
  setupOptionsPage,
  syncOptionsPageAfterWebMcpApply,
} from "../options/options.ts";
import "../options/dismissible-details.ts";
import { setupPermissionsBanner } from "../options/permissions-banner.ts";
import "../options/click-to-copy.ts";
import "../options/autocomplete.ts";
import { setupPathEditor } from "../options/path-editor.ts";
import { setupRuleBuilder } from "../options/rule-builder.ts";
import { setupOptionsReferences } from "../options/options-reference.ts";
import { setupTabs } from "../options/tabs.ts";
import { setupOptionSearch } from "../options/option-search.ts";
import { setupSourceShortcut } from "../options/source-shortcut.ts";
import { setupWebMcpStatus } from "../options/webmcp.ts";
import { setupAboutDialog } from "../options/about-dialog.ts";
import { setupPrivacyDialog } from "../options/privacy-dialog.ts";
import { setupLanguageSelector } from "../options/language-selector.ts";
import { applyUiTheme } from "../options/theme.ts";
import { setupSyntaxEditors } from "../options/syntax-editor.ts";
import { setupRouteDebugger } from "../options/route-debugger.ts";
import { setupRuleVisualEditor } from "../options/rule-visual-editor.ts";
import { setupWelcomeDialog } from "../options/welcome-dialog.ts";

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const stored = await webExtensionApi.storage.local
      .get(["uiLocale", "uiTheme"])
      .catch(() => ({}));
    applyUiTheme(Reflect.get(stored, "uiTheme"));
    const uiLocale = Reflect.get(stored, "uiLocale");
    await initializeLocalization(uiLocale);
    setDocumentLanguage(
      uiLocale,
      typeof webExtensionApi.i18n.getUILanguage === "function"
        ? webExtensionApi.i18n.getUILanguage()
        : "",
    );
    localizeDocument(getMessage);
    setHistoryLocalizer(getMessage);
    void renderHistory();
    setupSyntaxEditors();
    setupRouteDebugger();
    setupRuleVisualEditor();
    setupOptionsPage();
    void setupPermissionsBanner();
    setupPathEditor();
    setupRuleBuilder();
    setupOptionsReferences();
    setupTabs({
      confirmPendingChanges,
      onGuardError: (error) => {
        const message = getMessage("o_lSaveFailed") || "Could not save changes";
        window.alert(`${message}\n${String(error)}`);
      },
    });
    setupOptionSearch();
    setupSourceShortcut();
    setupWebMcpStatus(getMessage, syncOptionsPageAfterWebMcpApply);
    setupPrivacyDialog();
    setupAboutDialog();
    setupLanguageSelector();
    void setupWelcomeDialog();
  },
  { once: true },
);
