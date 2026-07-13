import { webExtensionApi } from "../platform/web-extension-api.ts";

import { normalizeKeyComboForDisplay } from "./options-logic.ts";
import { renderHistory } from "./history-panel.ts";
import { addClickToCopy } from "./clicktocopy.ts";
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
import { buildTree } from "../menus/menu-tree.ts";
import { splitLines } from "../shared/util.ts";
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

const setupLastDownloadState = () => {
  document.querySelector("#last-dl-url")?.classList.add("is-empty");
};

type ValidationError = { message: string; error: string; warning?: boolean };
type MenuPreviewTree = {
  items: JsonRecord[];
  errors: Array<ValidationError & { parentId?: string }>;
};

const getOptionsSchema = () => optionsRuntime.getSchema();

// Latest interpolated variables from the most recent CHECK_ROUTES; read by
// the once-bound #see-variables-btn handler (see updateErrors)
let latestInterpolatedVariables: Record<string, string> | null = null;

const renderVariablesTable = () => {
  if (!latestInterpolatedVariables) {
    return;
  }
  const tableBody = document.querySelector("#variables-body");
  if (!tableBody) {
    return;
  }
  tableBody.classList.toggle("hide");
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
    interpolatedEl.style.fontFamily = "monospace";
    interpolatedEl.textContent = val;

    variableRow.appendChild(nameEl);
    variableRow.appendChild(interpolatedEl);
    tableBody.appendChild(variableRow);
  });
};

document.querySelector("#see-variables-btn")?.addEventListener("click", renderVariablesTable);

// Reveal + select the offending text in its editor. Best-effort: the error
// string is usually the offending line/clause, so we find and select it.
const jumpToError = (textareaId: string, needle: string) => {
  // Paths in Visual mode: jump to the matching visual row instead of switching
  // back to the textarea. Match the row whose directory field is contained in
  // the (raw) line; fall back to Text mode if nothing matches (e.g. a line the
  // visual editor couldn't represent).
  if (textareaId === "#paths" && needle) {
    const visual = document.querySelector("#paths-visual");
    if (visual instanceof HTMLElement && !visual.hidden) {
      const rows = [...document.querySelectorAll("#path-editor-rows .path-editor-row")];
      const target = rows.find((r) => {
        const dir = r.querySelector(".path-editor-dir");
        return (
          dir instanceof HTMLInputElement && dir.value.trim() && needle.includes(dir.value.trim())
        );
      });
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
  const idx = needle ? ta.value.indexOf(needle) : -1;
  if (idx >= 0) {
    ta.setSelectionRange(idx, idx + needle.length);
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
  r.title = "Jump to this error";

  const message = document.createElement("span");
  message.className = "error-message";
  message.textContent = err.message;
  r.appendChild(message);

  const error = document.createElement("span");
  error.className = "error-error";
  error.textContent = err.error;
  r.appendChild(error);

  const jump = () => jumpToError(textareaId, err.error);
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
    panel.textContent?.trim() ||
      webExtensionApi.i18n.getMessage("o_lNoValidationErrors") ||
      "No validation errors",
  );
};

// Validate the (possibly unsaved) editor contents live and render both error
// panels — VALIDATE dry-runs both grammars, so the panels track the menu
// preview (which also validates live) instead of the last-saved state.
const validationRequests = createLatestOnly(
  (request: { body: { paths: string; filenamePatterns: string }; initiator?: string }) =>
    webExtensionApi.runtime.sendMessage({ type: "VALIDATE", body: request.body }),
  (res: any) => {
    const body = (res && res.body) || {};
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
      updatePanel(pathsErrors, body.pathErrors || [], "#paths");
      updateErrorSummary(pathsErrors);
      manualEditorState.setValidity(
        "paths",
        !(body.pathErrors || []).some((err: ValidationError) => !err.warning),
      );
    }
    if (rulesErrors) {
      errorChannel(rulesErrors, "validation-service").innerHTML = "";
      updatePanel(rulesErrors, body.ruleErrors || [], "#filenamePatterns");
      updateErrorSummary(rulesErrors);
      manualEditorState.setValidity(
        "filenamePatterns",
        !(body.ruleErrors || []).some((err: ValidationError) => !err.warning),
      );
    }
  },
  (_error, request) => {
    (request.initiator ? [request.initiator] : ["paths", "filenamePatterns"]).forEach((id) => {
      manualEditorState.setValidationUnavailable(id);
      const panel = document.querySelector(`#error-${id}`);
      if (!panel) return;
      const channel = errorChannel(panel, "validation-service");
      channel.innerHTML = "";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent =
        webExtensionApi.i18n.getMessage("o_bRetryValidation") || "Retry validation";
      retry.addEventListener("click", () => {
        manualEditorState.setValidationPending(id);
        renderValidationErrors(id);
      });
      channel.append(
        webExtensionApi.i18n.getMessage("o_lValidationUnavailable") ||
          "Validation is temporarily unavailable. ",
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
      initiator,
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

  webExtensionApi.runtime.sendMessage({ type: "CHECK_ROUTES" }).then(({ body }) => {
    // Last download
    const hasLastDownload =
      body.lastDownload && body.lastDownload.info && body.lastDownload.info.url;
    if (hasLastDownload) {
      const lastDlUrl = document.querySelector("#last-dl-url");
      if (lastDlUrl) {
        lastDlUrl.textContent = body.lastDownload.info.url;
        lastDlUrl.classList.remove("is-empty");
      }
    }

    document.querySelector("#rules-applied-row")?.classList.toggle("hide", !hasLastDownload);

    // Routing result
    if (lastDlMatch) {
      lastDlMatch.innerHTML = "no matches";
    }
    if (lastDlMatch && body.routeInfo.path) {
      lastDlMatch.textContent = body.routeInfo.path;
    }

    // Variables
    if (hasLastDownload) {
      document.querySelector("#variables-table-row")?.classList.toggle("hide", !hasLastDownload);
    }
    // The #see-variables-btn click handler is bound once below; updateErrors
    // only refreshes the data it reads. Binding here would leak a listener on
    // every autosave and make the toggle unpredictable.
    latestInterpolatedVariables = body.interpolatedVariables;

    // Capture groups
    const hasCaptureMatches = body.routeInfo && Array.isArray(body.routeInfo.captures);

    document.querySelector("#capture-group-rows")?.classList.toggle("hide", !hasCaptureMatches);

    if (hasCaptureMatches && lastDlCapture) {
      lastDlCapture.textContent = "";

      // Skip first match as it's just the entire input
      body.routeInfo.captures
        .slice(1)
        .map((_capture: string, i: number) => {
          const div = document.createElement("div");
          div.className = "match-row";

          const code = document.createElement("code");
          code.innerText = `:$${i + 1}:`;
          code.classList.add("click-to-copy");
          addClickToCopy(code);
          div.appendChild(code);

          const value = document.createElement("div");
          value.className = "match-row-result";
          value.textContent = body.routeInfo.captures[i + 1];
          div.appendChild(value);

          return div;
        })
        .forEach((rowDiv: HTMLElement) => lastDlCapture.appendChild(rowDiv));
    }
  });
};

// Version from the live manifest; commit + stamp date from version.json
// (written by scripts/write-version.js at build/stage time — absent in a
// bare checkout, where just the version shows)
const renderVersionLabel = () => {
  const el = document.querySelector("#version-label") as HTMLAnchorElement;
  if (!el) {
    return;
  }

  const version = webExtensionApi.runtime.getManifest().version;
  el.textContent = `v${version}`;
  el.title = `save-in v${version} — view releases`;

  fetch("version.json")
    .then((res) => res.json())
    .then(({ commit }) => {
      el.title = `save-in v${version} (${commit}) — view releases`;
    })
    .catch(() => {});
};

// More Options → External API: show the live extension id and a ready-to-paste
// integration snippet, and PING the running background so the displayed version
// and capabilities are the real ones this build serves. See docs/INTEGRATIONS.md.
const renderExternalApi = () => {
  const idEl = document.querySelector("#ext-id");
  if (!idEl) {
    return;
  }
  const id = webExtensionApi.runtime.id;
  idEl.textContent = id;

  const snippet = document.querySelector("#api-snippet");
  if (snippet) {
    snippet.textContent = [
      `const ID = "${id}";`,
      `const pong = await webExtensionApi.runtime.sendMessage(ID, { type: "PING" });`,
      `// pong.body -> { version, capabilities }`,
      ``,
      `const res = await webExtensionApi.runtime.sendMessage(ID, {`,
      `  type: "DOWNLOAD",`,
      `  body: {`,
      `    url: "https://example.com/pic.jpg",`,
      `    info: { pageUrl: location.href, srcUrl: "https://example.com/pic.jpg" },`,
      `  },`,
      `});`,
      `// res.body -> { status: "OK", version, url } | { status: "ERROR", error, message }`,
    ].join("\n");
  }

  const versionEl = document.querySelector("#api-version");
  const capsEl = document.querySelector("#api-capabilities");
  webExtensionApi.runtime
    .sendMessage({ type: "PING" })
    .then((pong) => {
      const body = (pong && pong.body) || {};
      if (versionEl) {
        versionEl.textContent = body.version != null ? `v${body.version}` : "unknown";
      }
      if (capsEl) {
        capsEl.textContent = (body.capabilities || []).join(", ") || "—";
      }
    })
    .catch(() => {
      if (versionEl) {
        versionEl.textContent = "unavailable";
      }
      if (capsEl) {
        capsEl.textContent = "—";
      }
    });
};
// Set UI elements' value/checked
// Transforms applied to a stored value before it populates its options field.
// These would belong on the option schema as onOptionsLoad, but the schema
// reaches this page via the GET_SCHEMA message and structured clone drops
// functions — so field-display transforms live here instead. The logic is in
// DOM-free helpers live in options-logic.ts so they can be unit-tested.
const OPTION_FIELD_DISPLAY_TRANSFORMS = {
  contentClickToSaveCombo: (v: unknown) => normalizeKeyComboForDisplay(v as string | number),
};

const restoreOptionsHandler = (result: JsonRecord, schema: OptionSchema) => {
  // Zip result -> schema
  const schemaWithValues = schema.keys.map((o) => Object.assign({}, o, { value: result[o.name] }));

  schemaWithValues.forEach((o) => {
    const el = document.getElementById(o.name);
    if (!el) {
      return;
    }

    const fn =
      OPTION_FIELD_DISPLAY_TRANSFORMS[o.name as keyof typeof OPTION_FIELD_DISPLAY_TRANSFORMS] ||
      ((x: unknown) => x);
    const val = typeof o.value === "undefined" ? o.default : fn(o.value);

    const propMap = {
      [schema.types.BOOL]: "checked",
      [schema.types.VALUE]: "value",
    };
    const property = propMap[o.type];
    if (property === "checked" && el instanceof HTMLInputElement) {
      el.checked = Boolean(val);
    } else if (
      property === "value" &&
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement)
    ) {
      el.value = String(val);
    }
  });

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
const saveOptions = (e?: Event, scope?: string, scopeValue?: unknown): Promise<any> => {
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

    if (targetEl && !targetEl.classList.contains("show")) {
      el.scrollIntoView();
    }
    targetEl.classList.toggle("show");
    el.setAttribute("aria-expanded", targetEl.classList.contains("show") ? "true" : "false");
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
    document.querySelectorAll(".chrome-only").forEach((el) => {
      el.classList.toggle("show");
    });

    document.querySelectorAll(".chrome-enabled").forEach((el) => {
      el.removeAttribute("disabled");
    });

    document.querySelectorAll(".chrome-disabled").forEach((el: any) => {
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

// The two large editors (#paths, #filenamePatterns) persist only via their
// Apply button, not autosave: their Apply lights up while the editor value
// differs from what is stored, and dims once applied. Every other control
// still autosaves.
const manualEditorState = createManualEditorState(
  webExtensionApi.i18n.getMessage("optionsEditorUnsaved") || "Unsaved changes",
);
const setupManualEditor = manualEditorState.setup;
const refreshManualEditorBaselines = manualEditorState.refreshBaselines;
const anyManualEditorDirty = manualEditorState.anyDirty;

const showManualSaveError = (id: string, error: unknown) => {
  const panel = document.querySelector(`#error-${id}`);
  if (!panel) return;
  const channel = errorChannel(panel, "persistence");
  channel.innerHTML = "";
  channel.appendChild(
    renderErrorRow(
      {
        message: webExtensionApi.i18n.getMessage("o_lSaveFailed") || "Could not save changes",
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
    webExtensionApi.i18n.getMessage("optionsUnsavedChanges") ||
    "Discard your unsaved changes, or keep editing?";
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
  status.append(
    webExtensionApi.i18n.getMessage("o_lAutosaveFailed") || "Could not save this setting. ",
  );
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = webExtensionApi.i18n.getMessage("o_bRetrySave") || "Retry save";
  retry.addEventListener("click", retrySave);
  status.appendChild(retry);
  element.insertAdjacentElement("afterend", status);
};

const setupAutosave = (el: Element) => {
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

  tree.items.forEach((item: JsonRecord) => {
    const parentUl = listsByParent.get(item.parentId) || rootUl;
    const li = document.createElement("li");

    if (item.kind === "separator") {
      li.className = "menu-preview-separator";
      li.appendChild(document.createElement("hr"));
    } else {
      li.className = "menu-preview-item";

      // The row (title + dir) is a flex box so the submenu ul drops below
      // it as a block; hover highlights just the row
      const row = document.createElement("div");
      row.className = "menu-preview-row";

      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = item.title;
      row.appendChild(title);

      // Aliased items also show the directory they save into
      if (item.title !== item.parsedDir) {
        const dir = document.createElement("span");
        dir.className = "menu-preview-dir";
        dir.textContent = item.parsedDir;
        row.appendChild(dir);
      }

      // Any row jumps to its line in the editor (the row only, so clicking a
      // nested child jumps to the child, not its parent)
      if (item.raw) {
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.title = "Jump to this line";
        const jump = () => jumpToError("#paths", item.raw);
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
      listsByParent.set(item.id, childUl);
    }

    parentUl.appendChild(li);
  });

  // Mirror the real menu: the Last Used slot and its separator sit above
  // the configured paths when the option is enabled
  const lastUsed = document.querySelector("#enableLastLocation") as HTMLInputElement;
  if (lastUsed && lastUsed.checked) {
    const sep = document.createElement("li");
    sep.className = "menu-preview-separator";
    sep.appendChild(document.createElement("hr"));
    rootUl.insertBefore(sep, rootUl.firstChild);

    const li = document.createElement("li");
    li.className = "menu-preview-item menu-preview-lastused";
    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = webExtensionApi.i18n.getMessage("contextMenuLastUsed");
    row.appendChild(title);
    linkOptionPreview(row, lastUsed, "Show the Last used menu setting");
    li.appendChild(row);
    rootUl.insertBefore(li, rootUl.firstChild);
  }

  // Invalid paths can't be a menu item, so show them as a red row in place (in
  // the submenu they'd belong to). The row shows the offending line; the message
  // is a tooltip. Click jumps to (and selects) the line in the editor.
  tree.errors.forEach((error) => {
    const parentUl = (error.parentId && listsByParent.get(error.parentId)) || rootUl;
    const li = document.createElement("li");
    li.className = "menu-preview-item menu-preview-error";
    li.title = error.message;
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");

    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = error.error;
    row.appendChild(title);
    li.appendChild(row);

    const jump = () => jumpToError("#paths", error.error);
    li.addEventListener("click", jump);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });

    parentUl.appendChild(li);
  });

  container.appendChild(rootUl);
};

const updateMenuPreview = () => {
  const textarea = document.querySelector("#paths") as HTMLTextAreaElement;
  if (!textarea || !document.querySelector("#menu-preview-tree")) {
    return;
  }
  renderMenuPreview(
    document.querySelector("#menu-preview-tree")!,
    buildTree(splitLines(textarea.value)),
  );
};

(() => {
  const textarea = document.querySelector("#paths");
  if (!textarea) {
    return;
  }

  // The Last Used slot in the preview follows its checkbox
  document
    .querySelector("#enableLastLocation")
    ?.addEventListener("change", () => updateMenuPreview());

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
    manualEditorState.setSaving(
      id,
      true,
      webExtensionApi.i18n.getMessage("o_lSaving") || "Saving…",
    );
    try {
      const response = await saveOptions(undefined, id, submittedValue);
      manualEditorState.markSaved(
        id,
        webExtensionApi.i18n.getMessage("o_lSaved") || "Saved",
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
document.querySelectorAll("[data-discard]").forEach((button: any) => {
  button.addEventListener("click", () => {
    const id = button.dataset.discard;
    if (!manualEditorState.discard(id)) {
      return;
    }
    updateMenuPreview();
  });
});

setupSettingsTransfer({
  getSchema: getOptionsSchema,
  getStored: (keys) => webExtensionApi.storage.local.get(keys),
  apply: (config) => optionsRuntime.apply(config),
  restore: () => void restoreOptions(),
});

const updateOptionDependencies = setupOptionDependencies();

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
    renderVersionLabel,
    renderExternalApi,
    setupCounterPanel,
    setupVariablesPreview,
    setupDebugLogPanel,
    () => void restoreOptions(),
  ],
  configureRuntime: () => optionsRuntime.configure(),
  addMessageListener: (listener) => webExtensionApi.runtime.onMessage.addListener(listener),
  onDownloaded: () => {
    updateErrors();
    renderHistory();
    renderVariablesPreview();
    updateDebugLog();
    refreshCounterPanel();
  },
  startBrowserDetection: waitForBrowserDetection,
});
