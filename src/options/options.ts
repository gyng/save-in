import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

import { normalizeKeyComboForDisplay } from "./options-logic.ts";
import { renderHistory } from "./history-panel.ts";
import { addClickToCopy } from "./click-to-copy.ts";
import {
  CURRENT_BROWSER,
  BROWSERS,
  WEB_EXTENSION_CAPABILITIES,
} from "../platform/chrome-detector.ts";
import { createManualEditorState } from "./manual-editor-state.ts";
import { createLatestOnly } from "./latest-only.ts";
import { assertApplySucceeded, collectOptionConfig, getAppliedValue } from "./options-save.ts";
import { createFieldSaveState } from "./field-save-state.ts";
import { setupOptionDependencies } from "./options-dependencies.ts";
import { linkOptionPreview } from "./option-navigation.ts";
import { refreshCounterPanel, setupCounterPanel } from "./counter-panel.ts";
import { setupDebugLogPanel, updateDebugLog } from "./debug-log-panel.ts";
import { renderVariablesPreview, setupVariablesPreview } from "./variables-preview.ts";
import { setupResetOptions } from "./reset-options.ts";
import { buildTree, getMenuTreeEntries } from "../menus/menu-tree.ts";
import type { MenuTree } from "../menus/menu-tree.ts";
import { resolveMenuAccessKey } from "../menus/access-key.ts";
import { splitLines } from "../shared/util.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { setupShortcutOptions } from "./shortcut-options.ts";
import { setupCheckboxRows } from "./checkbox-rows.ts";
import { setupSettingsTransfer } from "./settings-transfer.ts";
import { assertSettingsUndoSafe, markSavedNow } from "./saved-indicator.ts";
import { showUnsavedChangesDialog } from "./unsaved-changes-dialog.ts";
import { createLatestTaskRunner } from "./latest-task.ts";
import {
  createOptionsPersistence,
  type JsonRecord,
  type OptionSchema,
} from "./options-persistence.ts";
import { optionsRuntime } from "./options-runtime.ts";
import { bootstrapOptionsPage } from "./options-bootstrap.ts";
import { setupIntegrationPanel } from "./integration-panel.ts";
import { isStringKeyedRecord, sendInternalMessage } from "../shared/message-protocol.ts";
import { applyUiTheme, setupUiThemeControl } from "./theme.ts";
import { getPathSourceRange } from "./path-editor-model.ts";
import {
  registerPathSourceElement,
  revealSelectedPathSource,
  selectPathSource,
} from "./path-source-selection.ts";
import { setSyntaxEditorDiagnostics, SYNTAX_EDITOR_LINE_SELECTED_EVENT } from "./syntax-editor.ts";
import {
  directoryValidationLocation,
  validationErrorsToDiagnostics,
} from "./syntax-editor-model.ts";
import { dispatchEditorValidation } from "./editor-validation.ts";
import { createDeferredPageReload } from "./deferred-page-reload.ts";
import { setupDetailsMenuPositioning } from "./details-menu-positioning.ts";
import { refreshRouteDebuggerLatestDownload } from "./route-debugger.ts";

const setupLastDownloadState = () => {
  document.querySelector("#last-dl-url")?.classList.add("is-empty");
};

type ValidationError = {
  message: string;
  error: string;
  warning?: boolean;
  sourceRange?: { start: number; end: number };
  location?: {
    start: number;
    end: number;
    line: number;
    column: number;
  };
};
type IndexedValidationError = ValidationError & { sourceIndex: number };
type MenuPreviewTree = MenuTree;

const isValidationError = (value: unknown): value is ValidationError =>
  isStringKeyedRecord(value) &&
  typeof value.message === "string" &&
  typeof value.error === "string" &&
  (typeof value.warning === "undefined" || typeof value.warning === "boolean") &&
  (typeof value.sourceRange === "undefined" ||
    (isStringKeyedRecord(value.sourceRange) &&
      typeof value.sourceRange.start === "number" &&
      typeof value.sourceRange.end === "number")) &&
  (typeof value.location === "undefined" ||
    (isStringKeyedRecord(value.location) &&
      typeof value.location.start === "number" &&
      typeof value.location.end === "number" &&
      typeof value.location.line === "number" &&
      typeof value.location.column === "number"));

const isIndexedValidationError = (value: unknown): value is IndexedValidationError =>
  isStringKeyedRecord(value) &&
  typeof value.sourceIndex === "number" &&
  Number.isInteger(value.sourceIndex) &&
  value.sourceIndex >= 0 &&
  isValidationError(value);

const getOptionsSchema = () => optionsRuntime.getSchema();

// Latest interpolated variables from the most recent CHECK_ROUTES; read by
// the once-bound #see-variables-btn handler (see updateErrors)
let latestInterpolatedVariables: Record<string, string> | null = null;

const renderVariablesTable = () => {
  if (!latestInterpolatedVariables) {
    return;
  }
  const tableBody = document.querySelector<HTMLElement>("#variables-body");
  if (!tableBody) {
    return;
  }
  tableBody.hidden = !tableBody.hidden;
  tableBody.innerHTML = "";

  const variables = latestInterpolatedVariables;
  Object.keys(variables).forEach((key) => {
    const val = variables[key];

    const variableRow = document.createElement("tr");

    const nameEl = document.createElement("td");
    nameEl.textContent = key;
    nameEl.classList.add("click-to-copy");
    nameEl.classList.add("code");
    addClickToCopy(nameEl);

    const interpolatedEl = document.createElement("td");
    interpolatedEl.classList.add("last-download-value");
    interpolatedEl.textContent = val ?? "";

    variableRow.appendChild(nameEl);
    variableRow.appendChild(interpolatedEl);
    tableBody.appendChild(variableRow);
  });
};

document.querySelector("#see-variables-btn")?.addEventListener("click", renderVariablesTable);

// Reveal + select the offending text in its editor. Best-effort: the error
// string is usually the offending line/clause, so we find and select it.
const jumpToError = (
  textareaId: string,
  needle: string,
  sourceIndex?: number,
  location?: ValidationError["location"],
) => {
  // Paths in Visual mode: jump to the matching visual row instead of switching
  // back to the textarea. Match the row whose directory field is contained in
  // the (raw) line; fall back to Text mode if nothing matches (e.g. a line the
  // visual editor couldn't represent).
  if (textareaId === "#paths" && needle) {
    const visual = document.querySelector("#paths-visual");
    if (visual instanceof HTMLElement && !visual.hidden) {
      const rows = [...document.querySelectorAll("#path-editor-rows .path-editor-row")];
      const target =
        sourceIndex === undefined
          ? rows.find((r) => {
              const dir = r.querySelector(".path-editor-dir");
              return (
                dir instanceof HTMLInputElement &&
                dir.value.trim() &&
                needle.includes(dir.value.trim())
              );
            })
          : rows[sourceIndex];
      if (target) {
        target.scrollIntoView({ block: "center" });
        const dir = target.querySelector(".path-editor-dir");
        if (dir instanceof HTMLInputElement) {
          dir.focus();
          dir.select();
        }
        target.classList.add("path-editor-row-flash");
        window.setTimeout(() => target.classList.remove("path-editor-row-flash"), 1200);
        return;
      }
      const textBtn = document.querySelector("#paths-mode-text");
      if (textBtn instanceof HTMLElement) {
        textBtn.click();
      }
    }
  }

  const ta = document.querySelector(textareaId);
  if (!(ta instanceof HTMLTextAreaElement)) {
    return;
  }
  ta.scrollIntoView({ block: "center" });
  ta.focus();
  const sourceRange =
    textareaId === "#paths" && sourceIndex !== undefined
      ? getPathSourceRange(ta.value, sourceIndex)
      : null;
  const idx = location?.start ?? sourceRange?.start ?? (needle ? ta.value.indexOf(needle) : -1);
  if (idx >= 0) {
    ta.setSelectionRange(idx, location?.end ?? sourceRange?.end ?? idx + needle.length);
    // Nudge the caret into view (setSelectionRange alone may not scroll)
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const line = ta.value.slice(0, idx).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
  }
};

const renderErrorRow = (err: ValidationError, textareaId: string) => {
  const r = document.createElement("div");
  r.className = "error-row";
  r.setAttribute("role", "button");
  r.setAttribute("tabindex", "0");
  r.title = getMessage("validationJumpToIssue") || "Jump to this issue";

  const sourceIndex =
    "sourceIndex" in err && typeof err.sourceIndex === "number" ? err.sourceIndex : undefined;
  const textarea = document.querySelector(textareaId);
  const location =
    err.location ??
    (textarea instanceof HTMLTextAreaElement && sourceIndex !== undefined
      ? (directoryValidationLocation(textarea.value, sourceIndex, err.sourceRange) ?? undefined)
      : undefined);

  if (location) {
    const locationBadge = document.createElement("span");
    locationBadge.className = "error-location";
    locationBadge.textContent = `L${location.line}:${location.column + 1}`;
    r.appendChild(locationBadge);
  }

  const message = document.createElement("span");
  message.className = "error-message";
  message.textContent = err.message;
  r.appendChild(message);

  if (err.error) {
    const error = document.createElement("span");
    error.className = "error-error";
    error.textContent = err.error;
    r.appendChild(error);
  }

  const jump = () => jumpToError(textareaId, err.error, sourceIndex, location);
  r.addEventListener("click", jump);
  r.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jump();
    }
  });

  return r;
};

const errorChannel = (panel: Element, name: string) => {
  let channel = panel.querySelector(`[data-error-channel="${name}"]`);
  if (!channel) {
    channel = document.createElement("div");
    channel.setAttribute("data-error-channel", name);
    panel.appendChild(channel);
  }
  return channel;
};

const updateErrorSummary = (panel: Element) => {
  panel.setAttribute(
    "aria-label",
    panel.textContent?.trim() || getMessage("o_lNoValidationErrors") || "No validation errors",
  );
};

// Validate the (possibly unsaved) editor contents live and render both error
// panels — VALIDATE dry-runs both grammars, so the panels track the menu
// preview (which also validates live) instead of the last-saved state.
const validationRequests = createLatestOnly(
  (request: { body: { paths: string; filenamePatterns: string }; initiator?: string }) =>
    sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.VALIDATE,
      body: request.body,
    }),
  (res: unknown) => {
    const body = isStringKeyedRecord(res) && isStringKeyedRecord(res.body) ? res.body : {};
    const pathErrors = Array.isArray(body.pathErrors)
      ? body.pathErrors.filter(isIndexedValidationError)
      : [];
    const ruleErrors = Array.isArray(body.ruleErrors)
      ? body.ruleErrors.filter(isValidationError)
      : [];
    const pathsTextarea = document.querySelector("#paths");
    const rulesTextarea = document.querySelector("#filenamePatterns");
    const pathsErrors = document.querySelector("#error-paths");
    const rulesErrors = document.querySelector("#error-filenamePatterns");
    const updatePanel = (panel: Element, errors: ValidationError[], textareaId: string) => {
      const channel = errorChannel(panel, "validation");
      const signature = JSON.stringify(errors);
      if (channel.getAttribute("data-validation-signature") === signature) return;
      channel.setAttribute("data-validation-signature", signature);
      channel.innerHTML = "";
      errors.forEach((error) => channel.appendChild(renderErrorRow(error, textareaId)));
      updateErrorSummary(panel);
    };
    if (pathsErrors) {
      errorChannel(pathsErrors, "validation-service").innerHTML = "";
      updatePanel(pathsErrors, pathErrors, "#paths");
      updateErrorSummary(pathsErrors);
      manualEditorState.setValidity("paths", !pathErrors.some((err) => !err.warning));
      if (pathsTextarea instanceof HTMLTextAreaElement) {
        dispatchEditorValidation(pathsTextarea, pathErrors);
        setSyntaxEditorDiagnostics(
          pathsTextarea,
          validationErrorsToDiagnostics("directories", pathsTextarea.value, pathErrors),
        );
      }
    }
    if (rulesErrors) {
      errorChannel(rulesErrors, "validation-service").innerHTML = "";
      updatePanel(rulesErrors, ruleErrors, "#filenamePatterns");
      updateErrorSummary(rulesErrors);
      manualEditorState.setValidity("filenamePatterns", !ruleErrors.some((err) => !err.warning));
      if (rulesTextarea instanceof HTMLTextAreaElement) {
        dispatchEditorValidation(rulesTextarea, ruleErrors);
        setSyntaxEditorDiagnostics(
          rulesTextarea,
          validationErrorsToDiagnostics("routing", rulesTextarea.value, ruleErrors),
        );
      }
    }
  },
  (_error, request) => {
    (request.initiator ? [request.initiator] : ["paths", "filenamePatterns"]).forEach((id) => {
      manualEditorState.setValidationUnavailable(id);
      const textarea = document.querySelector(`#${id}`);
      if (textarea instanceof HTMLTextAreaElement) dispatchEditorValidation(textarea, []);
      const panel = document.querySelector(`#error-${id}`);
      if (!panel) return;
      const channel = errorChannel(panel, "validation-service");
      channel.innerHTML = "";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = getMessage("o_bRetryValidation") || "Retry validation";
      retry.addEventListener("click", () => {
        manualEditorState.setValidationPending(id);
        renderValidationErrors(id);
      });
      channel.append(
        getMessage("o_lValidationUnavailable") || "Validation is temporarily unavailable. ",
        retry,
      );
      updateErrorSummary(panel);
    });
  },
);

const renderValidationErrors = (initiator?: string) => {
  const pathsTa = document.querySelector("#paths");
  const rulesTa = document.querySelector("#filenamePatterns");
  const pathsErrors = document.querySelector("#error-paths");
  const rulesErrors = document.querySelector("#error-filenamePatterns");
  if (!pathsErrors && !rulesErrors) {
    return;
  }

  void validationRequests
    .run({
      ...(initiator === undefined ? {} : { initiator }),
      body: {
        paths: pathsTa instanceof HTMLTextAreaElement ? pathsTa.value : "",
        filenamePatterns: rulesTa instanceof HTMLTextAreaElement ? rulesTa.value : "",
      },
    })
    .catch(() => {}); // background not awake yet; the next edit retries
};

const updateErrors = () => {
  const lastDlMatch = document.querySelector("#last-dl-match");
  const lastDlCapture = document.querySelector("#last-dl-capture");

  // Errors are validated live (VALIDATE); CHECK_ROUTES fills the routing /
  // last-download / variables panes below.
  renderValidationErrors();

  sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES }).then(
    (response) => {
      if (!("routeInfo" in response.body)) {
        throw new Error("Invalid routing preview response");
      }
      const { body } = response;
      // Last download
      const lastDownloadUrl = body.lastDownload?.info.url;
      const hasLastDownload = typeof lastDownloadUrl === "string" && lastDownloadUrl.length > 0;
      if (hasLastDownload) {
        const lastDlUrl = document.querySelector("#last-dl-url");
        if (lastDlUrl) {
          lastDlUrl.textContent = lastDownloadUrl;
          lastDlUrl.classList.remove("is-empty");
        }
      }

      const rulesAppliedRow = document.querySelector<HTMLElement>("#rules-applied-row");
      if (rulesAppliedRow) rulesAppliedRow.hidden = !hasLastDownload;

      // Routing result
      if (lastDlMatch) {
        lastDlMatch.innerHTML = "no matches";
      }
      if (lastDlMatch && body.routeInfo.path) {
        lastDlMatch.textContent = body.routeInfo.path;
      }

      // Variables
      if (hasLastDownload) {
        const variablesTableRow = document.querySelector<HTMLElement>("#variables-table-row");
        if (variablesTableRow) variablesTableRow.hidden = !hasLastDownload;
      }
      // The #see-variables-btn click handler is bound once below; updateErrors
      // only refreshes the data it reads. Binding here would leak a listener on
      // every autosave and make the toggle unpredictable.
      latestInterpolatedVariables = body.interpolatedVariables;

      // Capture groups
      const captures = body.routeInfo.captures;
      const hasCaptureMatches = Array.isArray(captures);

      const captureGroupRows = document.querySelector<HTMLElement>("#capture-group-rows");
      if (captureGroupRows) captureGroupRows.hidden = !hasCaptureMatches;

      if (hasCaptureMatches && lastDlCapture) {
        lastDlCapture.textContent = "";

        // Skip first match as it's just the entire input
        captures
          .slice(1)
          .map((capture, i) => {
            const div = document.createElement("div");
            div.className = "match-row";

            const code = document.createElement("code");
            code.innerText = `:$${i + 1}:`;
            code.classList.add("click-to-copy");
            addClickToCopy(code);
            div.appendChild(code);

            const value = document.createElement("div");
            value.className = "match-row-result";
            value.textContent = capture ?? "";
            div.appendChild(value);

            return div;
          })
          .forEach((rowDiv: HTMLElement) => lastDlCapture.appendChild(rowDiv));
      }
    },
  );
};

// Set UI elements' value/checked
// Transforms applied to a stored value before it populates its options field.
// These would belong on the option schema as onOptionsLoad, but the schema
// reaches this page via the GET_SCHEMA message and structured clone drops
// functions — so field-display transforms live here instead. The logic is in
// DOM-free helpers live in options-logic.ts so they can be unit-tested.
const OPTION_FIELD_DISPLAY_TRANSFORMS = {
  contentClickToSaveCombo: (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? normalizeKeyComboForDisplay(value)
      : value,
};

const setOptionFieldValue = (
  option: OptionSchema["keys"][number],
  storedValue: unknown,
  schema: OptionSchema,
): boolean => {
  const el = document.getElementById(option.name);
  if (!el) return false;

  const transform =
    option.name === "contentClickToSaveCombo"
      ? OPTION_FIELD_DISPLAY_TRANSFORMS.contentClickToSaveCombo
      : (value: unknown) => value;
  const value = typeof storedValue === "undefined" ? option.default : transform(storedValue);
  if (option.type === schema.types.BOOL && el instanceof HTMLInputElement) {
    el.checked = Boolean(value);
    return true;
  }
  if (
    option.type === schema.types.VALUE &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement)
  ) {
    el.value = String(value);
    return true;
  }
  return false;
};

const restoreOptionsHandler = (result: JsonRecord, schema: OptionSchema) => {
  schema.keys.forEach((option) => setOptionFieldValue(option, result[option.name], schema));

  applyUiTheme(document.querySelector<HTMLInputElement>("#uiTheme")?.value);

  updateErrors();
  updateMenuPreview();
  // Stored values are now in the editors: they are clean, Apply dims
  refreshManualEditorBaselines();
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
  assertUndoSafe: () => assertSettingsUndoSafe(fieldSaveState.hasUnsaved(), anyManualEditorDirty()),
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
    if (fieldSaveState.status(option.name)) {
      // Keep this field's local draft authoritative and invalidate any older
      // in-flight completion. Other applied controls can still refresh.
      fieldSaveState.markDirty(option.name);
      return;
    }
    setOptionFieldValue(option, value, schema);
  });

  applyUiTheme(document.querySelector<HTMLInputElement>("#uiTheme")?.value);
  updateErrors();
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

const addHelp = (el: Element) => {
  const helpFor = el instanceof HTMLElement ? el.dataset.helpFor : undefined;
  if (helpFor) {
    el.setAttribute("aria-controls", helpFor);
    el.setAttribute("aria-expanded", "false");
  }
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const targetEl = helpFor ? document.getElementById(helpFor) : null;
    if (!targetEl) {
      return;
    }

    if (targetEl.hidden) {
      el.scrollIntoView();
    }
    targetEl.hidden = !targetEl.hidden;
    el.setAttribute("aria-expanded", targetEl.hidden ? "false" : "true");
  });
};

document.querySelectorAll(".help").forEach(addHelp);

// On Chrome the options page opens in a tab (options_ui.open_in_tab), so
// dialogs work on the local window in both browsers.
setupResetOptions({
  restoreOptions,
  updateErrors,
  getOptionNames: () => getOptionsSchema().then(({ keys }) => keys.map(({ name }) => name)),
});

const setupChromeDisables = () => {
  document.querySelectorAll<HTMLElement>(".filename-suggestion-only").forEach((el) => {
    el.hidden = !WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
  });
  document.querySelectorAll<HTMLElement>(".firefox-reroute-only").forEach((el) => {
    el.hidden =
      CURRENT_BROWSER !== BROWSERS.FIREFOX || WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
  });
  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    document.querySelectorAll<HTMLElement>(".firefox-only").forEach((el) => {
      el.hidden = true;
    });
    document.querySelectorAll(".chrome-enabled").forEach((el) => {
      el.removeAttribute("disabled");
    });

    document
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        ".chrome-disabled",
      )
      .forEach((el) => {
        el.disabled = true;
      });

    const tabContextMenus = WEB_EXTENSION_CAPABILITIES.tabContextMenus;
    document.querySelectorAll<HTMLInputElement>(".tab-context-required").forEach((el) => {
      el.disabled = !tabContextMenus;
    });
    document.querySelectorAll<HTMLElement>(".chrome-tab-context-badge").forEach((badge) => {
      badge.hidden = tabContextMenus;
    });
  }
};

// Debouncing only textareas: every keystroke there previously triggered a
// full save -> OPTIONS_LOADED -> contextMenus.removeAll()+rebuild round
// trip, racing any context menu the user had open while typing a long
// path/pattern. Single-value fields (checkboxes/selects/number/text
// inputs) are cheap to save on every event and stay immediate.
const AUTOSAVE_DEBOUNCE_MS = 400;

// True between a textarea edit and the debounced save that persists it;
// closing the page or switching tabs in that window would drop the edit
const fieldSaveState = createFieldSaveState();
// Scheduled autosave timers, so a Discard can cancel them before they fire
const pendingSaveCancellers = new Set<() => void>();

window.addEventListener("beforeunload", (e) => {
  if (fieldSaveState.hasUnsaved() || anyManualEditorDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// The large grammar editors persist only via their
// Apply button, not autosave: their Apply lights up while the editor value
// differs from what is stored, and dims once applied. Every other control
// still autosaves.
const manualEditorState = createManualEditorState(
  () => getMessage("optionsEditorUnsaved") || "Unsaved changes",
);
const setupManualEditor = manualEditorState.setup;
const refreshManualEditorBaselines = manualEditorState.refreshBaselines;
const anyManualEditorDirty = manualEditorState.anyDirty;
const localePageReload = createDeferredPageReload({
  isBlocked: () =>
    fieldSaveState.hasUnsaved() ||
    fieldSaveState.anySaving() ||
    manualEditorState.anyDirty() ||
    manualEditorState.anySaving(),
  reload: () => location.reload(),
});

const showManualSaveError = (id: string, error: unknown) => {
  const panel = document.querySelector(`#error-${id}`);
  if (!panel) return;
  const channel = errorChannel(panel, "persistence");
  channel.innerHTML = "";
  channel.appendChild(
    renderErrorRow(
      {
        message: getMessage("o_lSaveFailed") || "Could not save changes",
        error: String(error),
        warning: false,
      },
      `#${id}`,
    ),
  );
  updateErrorSummary(panel);
};

// Called before an in-page tab switch (main tabs don't unload the page).
export const confirmPendingChanges = async (): Promise<boolean> => {
  // An existing request already owns these values. Keep the current tab
  // visible until it settles instead of prompting and launching a duplicate.
  if (manualEditorState.anySaving() || fieldSaveState.anySaving()) {
    return false;
  }
  if (!fieldSaveState.hasUnsaved() && !anyManualEditorDirty()) {
    return true;
  }
  const message =
    getMessage("optionsUnsavedChanges") || "Discard your unsaved changes, or keep editing?";
  if ((await showUnsavedChangesDialog(message)) === "keep") return false;
  pendingSaveCancellers.forEach((cancel) => cancel());
  manualEditorState.dirtyIds().forEach((id) => manualEditorState.discard(id));
  fieldSaveState.clear();
  await restoreOptions();
  return true;
};

const clearAutosaveFailure = (element: Element) => {
  element.parentElement?.querySelector(`[data-autosave-error="${element.id}"]`)?.remove();
};

const showAutosaveFailure = (element: Element, retrySave: () => void) => {
  clearAutosaveFailure(element);
  const status = document.createElement("span");
  status.className = "autosave-error";
  status.dataset.autosaveError = element.id;
  status.setAttribute("role", "alert");
  status.append(getMessage("o_lAutosaveFailed") || "Could not save this setting. ");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = getMessage("o_bRetrySave") || "Retry save";
  retry.addEventListener("click", retrySave);
  status.appendChild(retry);
  element.insertAdjacentElement("afterend", status);
};

const setupAutosave = (el: Element) => {
  if (el.hasAttribute("data-no-autosave")) return;
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
  ) {
    return;
  }
  // The two big editors save manually via Apply, not autosave
  if (el.dataset && (el.dataset.manual === "true" || el.dataset.runtimeControl === "true")) {
    return;
  }

  let debounceTimer: number | null = null;
  let cancelPending: (() => void) | null = null;

  // Tied to the actual save firing (not every keystroke), so it still
  // reflects when a save really happened once debounced.
  const showSavedIndicator = () => {
    // Anchor the check to the row's .opt-title (content-width, wrapped below) so
    // it sits right after the label text; fall back to the label / the field.
    const label = el.closest("label");
    const title = label && label.querySelector(":scope > .opt-title");
    const target = el instanceof HTMLTextAreaElement ? el : title || el.parentElement;
    if (!target) {
      return;
    }
    target.classList.remove("saved");
    window.setTimeout(() => {
      target.classList.add("saved-base");
      target.classList.add("saved");
    }, 100);
  };

  const valueNow = (): unknown =>
    el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)
      ? el.checked
      : el.value;

  const saveRunner = createLatestTaskRunner<unknown>(async (value) => {
    const token = fieldSaveState.begin(el.id);
    clearAutosaveFailure(el);
    await saveOptions(undefined, el.id, value)
      .then(() => {
        if (fieldSaveState.succeed(el.id, token)) {
          clearAutosaveFailure(el);
          showSavedIndicator();
        }
        window.setTimeout(updateErrors, 200);
      })
      .catch(() => {
        fieldSaveState.fail(el.id, token);
        showAutosaveFailure(el, () => saveRunner.schedule(valueNow()));
      });
  });
  const queueSave = () => saveRunner.schedule(valueNow());

  if (el.type === "textarea") {
    el.addEventListener("input", () => {
      fieldSaveState.markDirty(el.id);
      cancelPending?.();
      const timer = window.setTimeout(() => {
        if (cancelPending) pendingSaveCancellers.delete(cancelPending);
        cancelPending = null;
        debounceTimer = null;
        queueSave();
      }, AUTOSAVE_DEBOUNCE_MS);
      debounceTimer = timer;
      cancelPending = () => {
        window.clearTimeout(timer);
        debounceTimer = null;
        if (cancelPending) pendingSaveCancellers.delete(cancelPending);
        cancelPending = null;
      };
      pendingSaveCancellers.add(cancelPending);
    });

    // Flush on blur so a quick click-away right after typing isn't lost
    el.addEventListener("blur", () => {
      if (debounceTimer === null) {
        return;
      }
      cancelPending?.();
      queueSave();
    });
  } else if (["text", "number"].includes(el.type)) {
    el.addEventListener("input", () => {
      fieldSaveState.markDirty(el.id);
      queueSave();
    });
  } else {
    el.addEventListener("change", () => {
      fieldSaveState.markDirty(el.id);
      queueSave();
    });
  }
};

// Live context-menu tree preview: mirrors what the paths textarea will
// produce, updating as the user types (before autosave persists it)
const MENU_PREVIEW_DEBOUNCE_MS = 250;

const renderMenuPreview = (container: Element, tree: MenuPreviewTree) => {
  container.textContent = "";

  const rootUl = document.createElement("ul");
  const listsByParent = new Map<string, HTMLUListElement>();

  getMenuTreeEntries(tree).forEach((entry) => {
    const parentUl = (entry.parentId && listsByParent.get(entry.parentId)) || rootUl;
    const li = document.createElement("li");

    if (!("kind" in entry)) {
      li.className = "menu-preview-item menu-preview-error";
      li.title = entry.message;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");

      const row = document.createElement("div");
      row.className = "menu-preview-row";
      registerPathSourceElement(row, entry.sourceIndex);
      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = entry.error;
      row.appendChild(title);
      li.appendChild(row);

      const jump = () => {
        selectPathSource(entry.sourceIndex, { document: container.ownerDocument });
        jumpToError("#paths", entry.error, entry.sourceIndex);
      };
      li.addEventListener("click", jump);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump();
        }
      });
    } else if (entry.kind === "separator") {
      li.className = "menu-preview-separator";
      registerPathSourceElement(li, entry.sourceIndex);
      li.appendChild(document.createElement("hr"));
    } else {
      li.className = "menu-preview-item";

      // The row (title + dir) is a flex box so the submenu ul drops below
      // it as a block; hover highlights just the row
      const row = document.createElement("div");
      row.className = "menu-preview-row";
      registerPathSourceElement(row, entry.sourceIndex);

      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = entry.title;
      row.appendChild(title);

      // Aliased items also show the directory they save into
      if (entry.title !== entry.parsedDir) {
        const dir = document.createElement("span");
        dir.className = "menu-preview-dir";
        dir.textContent = entry.parsedDir;
        row.appendChild(dir);
      }

      const numberedItems = document.querySelector<HTMLInputElement>("#enableNumberedItems");
      const accessKey = numberedItems?.checked
        ? resolveMenuAccessKey(entry.number, entry.accessKeyOverride)
        : null;
      if (accessKey !== null) {
        const key = document.createElement("kbd");
        key.className = "menu-preview-access-key";
        key.textContent = accessKey;
        key.setAttribute(
          "aria-label",
          `${getMessage("o_sContextMenu") || "Context menu access key"}: ${accessKey}`,
        );
        row.appendChild(key);
      }

      // Any row jumps to its line in the editor (the row only, so clicking a
      // nested child jumps to the child, not its parent)
      if (entry.raw) {
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        const jump = () => {
          selectPathSource(entry.sourceIndex, { document: container.ownerDocument });
          jumpToError("#paths", entry.raw, entry.sourceIndex);
        };
        row.addEventListener("click", jump);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
      }

      li.appendChild(row);

      const childUl = document.createElement("ul");
      li.appendChild(childUl);
      listsByParent.set(entry.id, childUl);
    }

    parentUl.appendChild(li);
  });

  // Mirror the real menu: the Last Used slot and its separator sit above
  // the configured paths when the option is enabled
  const lastUsed = document.querySelector<HTMLInputElement>("#enableLastLocation");
  if (lastUsed?.checked) {
    if (tree.items.some((item) => item.kind === "path")) {
      const sep = document.createElement("li");
      sep.className = "menu-preview-separator";
      sep.appendChild(document.createElement("hr"));
      rootUl.insertBefore(sep, rootUl.firstChild);
    }

    const li = document.createElement("li");
    li.className = "menu-preview-item menu-preview-lastused";
    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = getMessage("contextMenuLastUsed");
    row.appendChild(title);
    linkOptionPreview(row, lastUsed, "Show the Last used menu setting");
    li.appendChild(row);
    rootUl.insertBefore(li, rootUl.firstChild);
  }

  container.appendChild(rootUl);
  revealSelectedPathSource(container.ownerDocument);
};

const updateMenuPreview = () => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#paths");
  const preview = document.querySelector<HTMLElement>("#menu-preview-tree");
  if (!textarea || !preview) {
    return;
  }
  renderMenuPreview(preview, buildTree(splitLines(textarea.value)));
};

(() => {
  const textarea = document.querySelector("#paths");
  if (!textarea) {
    return;
  }

  // Menu-only settings redraw their matching affordances immediately.
  ["#enableLastLocation", "#enableNumberedItems"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => updateMenuPreview());
  });

  const highlightSelectedSource = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const sourceIndex: unknown = Reflect.get(event.detail ?? {}, "sourceIndex");
    if (typeof sourceIndex === "number" && Number.isInteger(sourceIndex) && sourceIndex >= 0) {
      selectPathSource(sourceIndex, { document: textarea.ownerDocument });
    }
  };
  textarea.addEventListener(SYNTAX_EDITOR_LINE_SELECTED_EVENT, highlightSelectedSource);

  let previewTimer: number | null = null;
  textarea.addEventListener("input", () => {
    manualEditorState.setValidationPending("paths");
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      updateMenuPreview();
      renderValidationErrors("paths");
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
})();

// The rules editor has no menu preview, but its error panel should still update
// live as you type — same as the paths editor above.
(() => {
  const rulesTa = document.querySelector("#filenamePatterns");
  if (!rulesTa) {
    return;
  }
  let timer: number | null = null;
  rulesTa.addEventListener("input", () => {
    manualEditorState.setValidationPending("filenamePatterns");
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      renderValidationErrors("filenamePatterns");
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
})();

setupManualEditor("paths");
setupManualEditor("filenamePatterns");

setupShortcutOptions();

setupCheckboxRows();

const uiThemeControl = document.querySelector<HTMLInputElement>("#uiTheme");
const uiThemePicker = document.querySelector<HTMLElement>(".theme-picker");
if (uiThemeControl && uiThemePicker) setupUiThemeControl(uiThemeControl, uiThemePicker);

["textarea", "input", "select"].forEach((type) => {
  document.querySelectorAll(type).forEach((el) => {
    // The quick-add rule builder owns its own fields (rule-builder.js); they are
    // not options, so autosave here would flash a stray "saved" check over them.
    if (el.closest(".rule-builder")) {
      return;
    }
    setupAutosave(el);
  });
});

// Apply: persist the manual editors, re-baseline (dims Apply/Discard),
// and refresh the validation + preview panes
document.querySelectorAll("[data-apply]").forEach((button) => {
  button.addEventListener("click", async () => {
    const id = button.getAttribute("data-apply") || "";
    const submittedValue = document.querySelector<HTMLTextAreaElement>(`#${id}`)?.value;
    const revision = manualEditorState.revision(id);
    manualEditorState.setSaving(id, true, getMessage("o_lSaving") || "Saving…");
    try {
      const response = await saveOptions(undefined, id, submittedValue);
      manualEditorState.markSaved(
        id,
        getMessage("o_lSaved") || "Saved",
        getAppliedValue(response, id),
        revision,
      );
      const errorPanel = document.querySelector(`#error-${id}`);
      if (errorPanel) {
        errorChannel(errorPanel, "persistence").innerHTML = "";
        updateErrorSummary(errorPanel);
      }
      window.setTimeout(() => {
        updateErrors();
        updateMenuPreview();
        renderVariablesPreview();
      }, 200);
    } catch (error) {
      manualEditorState.setSaving(id, false);
      showManualSaveError(id, error);
    }
  });
});

// Discard: revert the editor to its stored value without saving
document.querySelectorAll<HTMLElement>("[data-discard]").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.discard;
    if (!id || !manualEditorState.discard(id)) {
      return;
    }
    updateMenuPreview();
  });
});

setupSettingsTransfer({
  getSchema: getOptionsSchema,
  getStored: (keys) => webExtensionApi.storage.local.get(keys),
  apply: (config) => optionsRuntime.apply(config),
  restore: restoreOptions,
});

const updateOptionDependencies = setupOptionDependencies();

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

// Detection can complete synchronously (Chrome), so this must be defined
// after setupChromeDisables
const waitForBrowserDetection = () => {
  if (CURRENT_BROWSER === "UNKNOWN") {
    setTimeout(waitForBrowserDetection, 10);
  } else {
    setupChromeDisables();
    updateOptionDependencies();
  }
};

export const setupOptionsPage = bootstrapOptionsPage({
  document,
  ready: [
    setupLastDownloadState,
    setupIntegrationPanel,
    setupCounterPanel,
    setupDefaultDownloadsFolderLinks,
    setupDetailsMenuPositioning,
    setupVariablesPreview,
    setupDebugLogPanel,
    () => restoreOptions(),
  ],
  configureRuntime: () => optionsRuntime.configure(),
  addMessageListener: (listener) => webExtensionApi.runtime.onMessage.addListener(listener),
  onDownloaded: () => {
    updateErrors();
    renderHistory();
    renderVariablesPreview();
    updateDebugLog();
    refreshCounterPanel();
    refreshRouteDebuggerLatestDownload();
  },
  startBrowserDetection: waitForBrowserDetection,
});
