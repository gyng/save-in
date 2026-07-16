// Composition root for the options page. Wires the feature modules together
// through the options-bootstrap.ts ports/ready[] pattern: importing this
// module builds the wiring closures but does not touch the DOM, except where
// noted below as load-bearing at import time.
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { getMessage } from "../../platform/localization.ts";
import { renderHistory } from "../history/history-panel.ts";
import { CURRENT_BROWSER } from "../../platform/chrome-detector.ts";
import { createManualEditorState } from "../syntax-editor/manual-editor-controller.ts";
import { assertApplySucceeded, collectOptionConfig } from "./options-save.ts";
import { setupOptionDependencies } from "./options-dependencies.ts";
import { refreshCounterPanel, setupCounterPanel } from "../integrations/counter-panel.ts";
import { setupDebugLogPanel, updateDebugLog } from "../integrations/debug-log-panel.ts";
import { renderVariablesPreview, setupVariablesPreview } from "../reference/variables-preview.ts";
import { setupResetOptions } from "./reset-options.ts";
import { setupShortcutOptions } from "./shortcut-options.ts";
import { setupCheckboxRows } from "../ui/checkbox-rows.ts";
import { setupSettingsTransfer } from "./settings-transfer.ts";
import { setupHelpDisclosures } from "../ui/disclosure-help.ts";
import { assertSettingsUndoSafe, markSavedNow } from "./saved-indicator.ts";
import {
  createOptionsPersistence,
  type JsonRecord,
  type OptionSchema,
} from "./options-persistence.ts";
import { optionsRuntime } from "./options-runtime.ts";
import { bootstrapOptionsPage } from "./options-bootstrap.ts";
import { setupIntegrationPanel } from "../integrations/integration-panel.ts";
import { applyUiTheme, setupUiThemeControl } from "./theme.ts";
import { createDeferredPageReload } from "./deferred-page-reload.ts";
import { setupDetailsMenuPositioning } from "../ui/details-menu-positioning.ts";
import { refreshRouteDebuggerLatestDownload } from "../route-debugger/route-debugger.ts";
import { subscribeDownloadRefresh, notifyDownloadRefresh } from "./download-refresh.ts";
import { createPendingChangesTracker } from "./pending-changes.ts";
import { createRoutingPreviewPanel, setupSeeVariablesButton } from "./routing-preview-panel.ts";
import { updateMenuPreview, setupPathsPreviewWiring } from "./menu-preview.ts";
import { createManualEditorActions } from "./manual-editor-actions.ts";
import { setOptionFieldValue } from "./option-field-sync.ts";
import { applyBrowserCapabilityUi } from "./browser-capability-ui.ts";
import { setupOptionJumpLinks } from "./option-navigation.ts";

const setupLastDownloadState = () => {
  document.querySelector("#last-dl-url")?.classList.add("is-empty");
};

const getOptionsSchema = () => optionsRuntime.getSchema();

const restoreOptionsHandler = (result: JsonRecord, schema: OptionSchema) => {
  schema.keys.forEach((option) => setOptionFieldValue(option, result[option.name], schema));

  applyUiTheme(document.querySelector<HTMLInputElement>("#uiTheme")?.value);

  routingPreview.updateErrors();
  updateMenuPreview();
  // Stored values are now in the editors: they are clean, Apply dims
  manualEditorState.refreshBaselines();
  updateOptionDependencies();
  document.dispatchEvent(new Event("options-restored"));
};

const optionsPersistence = createOptionsPersistence({
  getSchema: getOptionsSchema,
  getStored: (keys) => webExtensionApi.storage.local.get(keys),
  apply: (config, expected) => optionsRuntime.apply(config, expected),
  collect: collectOptionConfig,
  assertApplied: assertApplySucceeded,
  markSaved: markSavedNow,
  assertUndoSafe: () =>
    assertSettingsUndoSafe(pendingChanges.hasUnsavedField(), manualEditorState.anyDirty()),
  onRestore: restoreOptionsHandler,
});

const restoreOptions = () => optionsPersistence.restore();

export const syncOptionsPageAfterWebMcpApply = async (
  applied: Record<string, unknown>,
): Promise<void> => {
  if (Object.keys(applied).length === 0) return;

  const schema = await getOptionsSchema();
  const changes = optionsPersistence.acceptExternal(applied);
  schema.keys.forEach((option) => {
    if (!Object.hasOwn(applied, option.name)) return;
    const value = applied[option.name];
    if (manualEditorState.applyExternalBaseline(option.name, value)) return;
    if (pendingChanges.fieldStatus(option.name)) {
      // Keep this field's local draft authoritative and invalidate any older
      // in-flight completion. Other applied controls can still refresh.
      pendingChanges.markFieldDirty(option.name);
      return;
    }
    setOptionFieldValue(option, value, schema);
  });

  applyUiTheme(document.querySelector<HTMLInputElement>("#uiTheme")?.value);
  routingPreview.updateErrors();
  updateMenuPreview();
  updateOptionDependencies();
  document.dispatchEvent(new Event("options-restored"));
  markSavedNow(changes);
  if (changes.some(({ name }) => name === "uiLocale")) localePageReload.request();
};
const saveOptions = (e?: Event, scope?: string, scopeValue?: unknown): Promise<unknown> => {
  e?.preventDefault();
  return optionsPersistence.save(scope, scopeValue);
};

// On Chrome the options page opens in a tab (options_ui.open_in_tab), so
// dialogs work on the local window in both browsers.
const setupResetOptionsPanel = (): void => {
  setupResetOptions({
    restoreOptions,
    updateErrors: routingPreview.updateErrors,
    getOptionNames: () => getOptionsSchema().then(({ keys }) => keys.map(({ name }) => name)),
  });
};

// The large grammar editors persist only via their
// Apply button, not autosave: their Apply lights up while the editor value
// differs from what is stored, and dims once applied. Every other control
// still autosaves.
const manualEditorState = createManualEditorState(
  () => getMessage("optionsEditorUnsaved") || "Unsaved changes",
);
const setupManualEditor = manualEditorState.setup;

const routingPreview = createRoutingPreviewPanel(manualEditorState);

const pendingChanges = createPendingChangesTracker({
  saveOptions,
  restoreOptions,
  afterAutosave: () => routingPreview.updateErrors(),
  manualEditorState,
});
export const confirmPendingChanges = pendingChanges.confirmPendingChanges;

const localePageReload = createDeferredPageReload({
  isBlocked: () =>
    pendingChanges.hasUnsavedField() ||
    pendingChanges.anyFieldSaving() ||
    manualEditorState.anyDirty() ||
    manualEditorState.anySaving(),
  reload: () => location.reload(),
});

const setupManualEditors = (): void => {
  setupManualEditor("paths");
  setupManualEditor("filenamePatterns");
};

const setupThemePicker = (): void => {
  const uiThemeControl = document.querySelector<HTMLInputElement>("#uiTheme");
  const uiThemePicker = document.querySelector<HTMLElement>(".theme-picker");
  if (uiThemeControl && uiThemePicker) setupUiThemeControl(uiThemeControl, uiThemePicker);
};

const manualEditorActions = createManualEditorActions({
  saveOptions,
  refreshPreview: () => routingPreview.updateErrors(),
  renderVariablesPreview,
  manualEditorState,
});

const setupSettingsTransferPanel = (): void => {
  setupSettingsTransfer({
    getSchema: getOptionsSchema,
    getStored: (keys) => webExtensionApi.storage.local.get(keys),
    apply: (config) => optionsRuntime.apply(config),
    restore: restoreOptions,
  });
};

const setupDefaultDownloadsFolderLinks = () => {
  document
    .querySelectorAll<HTMLAnchorElement>("[data-open-default-downloads-folder]")
    .forEach((link) =>
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Promise.resolve(webExtensionApi.downloads.showDefaultFolder()).catch(() => {});
      }),
    );
};

// Panels refresh from the same DOWNLOADED broadcast; register them once so
// the composition root just notifies subscribers instead of hard-wiring the
// fan-out inline. Subscribing is a plain array push (see download-refresh.ts),
// so it is safe to do eagerly here.
subscribeDownloadRefresh(routingPreview.updateErrors);
subscribeDownloadRefresh(renderHistory);
subscribeDownloadRefresh(renderVariablesPreview);
subscribeDownloadRefresh(updateDebugLog);
subscribeDownloadRefresh(refreshCounterPanel);
subscribeDownloadRefresh(refreshRouteDebuggerLatestDownload);

// setupOptionDependencies() wires "change" listeners AND is called
// synchronously by waitForBrowserDetection below when browser detection
// resolves synchronously (Chrome). bootstrapOptionsPage invokes
// startBrowserDetection before it runs ready[], so updateOptionDependencies
// must already be assigned by then — this stays eager rather than moving
// into ready[].
const updateOptionDependencies = setupOptionDependencies();

// Detection can complete synchronously (Chrome), so this must be defined
// after setupOptionDependencies.
const waitForBrowserDetection = () => {
  if (CURRENT_BROWSER === "UNKNOWN") {
    setTimeout(waitForBrowserDetection, 10);
  } else {
    applyBrowserCapabilityUi();
    updateOptionDependencies();
  }
};

export const setupOptionsPage = bootstrapOptionsPage({
  document,
  ready: [
    setupLastDownloadState,
    setupHelpDisclosures,
    setupResetOptionsPanel,
    pendingChanges.setupBeforeUnloadGuard,
    setupManualEditors,
    () =>
      setupPathsPreviewWiring({
        setValidationPending: manualEditorState.setValidationPending,
        renderValidationErrors: routingPreview.renderValidationErrors,
      }),
    routingPreview.setupRulesValidationWiring,
    setupSeeVariablesButton,
    setupShortcutOptions,
    setupCheckboxRows,
    setupThemePicker,
    pendingChanges.setupAllFieldsAutosave,
    manualEditorActions.setupApplyButtons,
    manualEditorActions.setupDiscardButtons,
    setupSettingsTransferPanel,
    setupIntegrationPanel,
    setupCounterPanel,
    setupDefaultDownloadsFolderLinks,
    setupOptionJumpLinks,
    setupDetailsMenuPositioning,
    setupVariablesPreview,
    setupDebugLogPanel,
    () => restoreOptions(),
  ],
  configureRuntime: () => optionsRuntime.configure(),
  addMessageListener: (listener) => webExtensionApi.runtime.onMessage.addListener(listener),
  onDownloaded: notifyDownloadRefresh,
  startBrowserDetection: waitForBrowserDetection,
});
