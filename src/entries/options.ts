// Options-page entry point for the rolldown bundle. Side-effect-imports every
// script the options page loads, in options.html order (head scripts first,
// then body scripts). Emitted as bare scope-hoisted ESM and loaded as a classic
// script by the staged options.html. The e2e's evalOptions only reaches DOM +
// WebExtension API binding, so nothing here
// needs re-exposing on globalThis.

// <head> scripts
import "../platform/web-extension-api.ts";
import { initializeLocalizedDocument, localizeDocument } from "../options/core/l10n.ts";
import { getMessage, initializeLocalization } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import "../platform/chrome-detector.ts";

// <body> scripts (options.html load order)
import "../options/core/options-logic.ts";
import "../options/history/history-view.ts";
import { renderHistory, setHistoryLocalizer } from "../options/history/history-panel.ts";
import {
  confirmPendingChanges,
  setupOptionsPage,
  syncOptionsPageAfterWebMcpApply,
} from "../options/core/options.ts";
import "../options/ui/dismissible-details.ts";
import { setupPermissionsBanner } from "../options/ui/permissions-banner.ts";
import "../options/ui/click-to-copy.ts";
import "../options/syntax-editor/autocomplete.ts";
import { setupPathEditor } from "../options/path-editor/path-editor.ts";
import { setupRuleBuilder } from "../options/rule-editor/rule-builder.ts";
import { appendRule } from "../options/rule-editor/rule-builder.ts";
import { setupOptionsReferences } from "../options/core/options-reference.ts";
import { setupTabs } from "../options/core/tabs.ts";
import { setupOptionSearch } from "../options/core/option-search.ts";
import { setupSourceShortcut } from "../options/core/source-shortcut.ts";
import { setupWebMcpStatus } from "../options/integrations/webmcp.ts";
import { setupPromptAssistantPanel } from "../options/integrations/prompt-assistant-panel.ts";
import { setupAboutDialog } from "../options/dialogs/about-dialog.ts";
import { setupPrivacyDialog } from "../options/dialogs/privacy-dialog.ts";
import { setupLanguageSelector } from "../options/core/language-selector.ts";
import { applyUiTheme } from "../options/core/theme.ts";
import { setupSyntaxEditors } from "../options/syntax-editor/syntax-editor.ts";
import { setupRouteDebugger } from "../options/route-debugger/route-debugger.ts";
import { setupRuleVisualEditor } from "../options/rule-editor/rule-visual-editor.ts";
import { showWelcomeDialog, setupWelcomeDialog } from "../options/dialogs/welcome-dialog.ts";
import { optionsRuntime } from "../options/core/options-runtime.ts";
import { assertApplySucceeded } from "../options/core/options-save.ts";
import {
  applySourceRuleDraft,
  setupSourceRuleDraft,
} from "../options/rule-editor/source-rule-draft.ts";

const applyWelcomePreset = async (paths: string): Promise<void> => {
  const response = assertApplySucceeded(await optionsRuntime.apply({ paths }));
  await syncOptionsPageAfterWebMcpApply(response.body.applied);
};

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const root = document.documentElement;
    const stored = await webExtensionApi.storage.local
      .get(["uiLocale", "uiTheme"])
      .catch(() => ({}));
    applyUiTheme(Reflect.get(stored, "uiTheme"));
    const uiLocale = Reflect.get(stored, "uiLocale");
    try {
      await initializeLocalizedDocument(
        uiLocale,
        typeof webExtensionApi.i18n.getUILanguage === "function"
          ? webExtensionApi.i18n.getUILanguage()
          : "",
        {
          root,
          localeControl: document.querySelector<HTMLSelectElement>("#uiLocale"),
          reveal: false,
          initialize: initializeLocalization,
          localize: () => localizeDocument(getMessage),
        },
      );
      setHistoryLocalizer(getMessage);
      void renderHistory();
      setupSyntaxEditors();
      setupRouteDebugger();
      setupRuleVisualEditor();
      const optionsReady = setupOptionsPage();
      void setupPermissionsBanner();
      setupPathEditor();
      setupRuleBuilder();
      setupOptionsReferences();
      setupTabs({
        confirmPendingChanges,
        label: getMessage("html_settingsSaveIn") || "Save In settings",
        onGuardError: (error) => {
          const message = getMessage("o_lSaveFailed") || "Could not save changes";
          window.alert(`${message}\n${String(error)}`);
        },
      });
      setupOptionSearch();
      setupSourceShortcut();
      setupWebMcpStatus(getMessage, syncOptionsPageAfterWebMcpApply);
      setupPrivacyDialog();
      setupAboutDialog(() => showWelcomeDialog(undefined, undefined, false, applyWelcomePreset));
      setupLanguageSelector();
      void setupWelcomeDialog(undefined, undefined, applyWelcomePreset);
      await optionsReady;
      setupPromptAssistantPanel(getMessage, { appendRule });
      setupSourceRuleDraft();
      await applySourceRuleDraft();
    } finally {
      root.classList.remove("localization-pending");
    }
  },
  { once: true },
);
