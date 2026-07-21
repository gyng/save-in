// Autosave scheduling and the "is it safe to navigate away right now?" guard
// for the options page. Single-value fields (checkboxes/selects/number/text
// inputs) save immediately; the two large textareas are debounced (see
// AUTOSAVE_DEBOUNCE_MS) so every keystroke doesn't trigger a full save ->
// OPTIONS_LOADED -> contextMenus.removeAll()+rebuild round trip while a
// context menu might be open.
import { getMessage } from "../../platform/localization.ts";
import { createLatestTaskRunner } from "../ui/latest-task.ts";
import { savedIndicatorTarget } from "./saved-indicator.ts";
import { showUnsavedChangesDialog } from "../dialogs/unsaved-changes-dialog.ts";
import { createFieldSaveState } from "./field-save-state.ts";

const AUTOSAVE_DEBOUNCE_MS = 400;

export type ManualEditorDirtyState = {
  anySaving: () => boolean;
  anyDirty: () => boolean;
  dirtyIds: () => string[];
  discard: (id: string) => boolean;
};

export type PendingChangesPorts = {
  saveOptions: (e: Event | undefined, scope: string, scopeValue: unknown) => Promise<unknown>;
  restoreOptions: () => Promise<void>;
  // Refreshes derived UI (routing preview) a moment after a field autosaves.
  afterAutosave: () => void;
  manualEditorState: ManualEditorDirtyState;
};

export const createPendingChangesTracker = (ports: PendingChangesPorts) => {
  // True between a textarea edit and the debounced save that persists it;
  // closing the page or switching tabs in that window would drop the edit.
  const fieldSaveState = createFieldSaveState();

  // Scheduled autosave timers, so a Discard can cancel them before they fire
  const pendingSaveCancellers = new Set<() => void>();

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

  const setupAutosave = (el: Element): void => {
    if (el.hasAttribute("data-no-autosave")) return;
    // An option is addressed by its schema name, which is its element id — that
    // is how collectOptionConfig and setOptionFieldValue find it. A field with
    // no id therefore cannot be one, and saving it scoped the save to "", which
    // collectOptionConfig reads as no scope at all and answers with every
    // option: a page widget like the clause-preview filter rewrote the whole
    // configuration and rebuilt the menus on blur, and reported itself unsaved
    // in between. The .rule-builder check below cannot cover this — it only
    // reaches fields inside markup that carries that class.
    if (!el.id) return;
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
      const target = savedIndicatorTarget(el);
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
      await ports
        .saveOptions(undefined, el.id, value)
        .then(() => {
          if (fieldSaveState.succeed(el.id, token)) {
            clearAutosaveFailure(el);
            showSavedIndicator();
          }
          window.setTimeout(ports.afterAutosave, 200);
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
        function cancel() {
          window.clearTimeout(timer);
          debounceTimer = null;
          pendingSaveCancellers.delete(cancel);
          cancelPending = null;
        }
        const timer = window.setTimeout(() => {
          pendingSaveCancellers.delete(cancel);
          cancelPending = null;
          debounceTimer = null;
          queueSave();
        }, AUTOSAVE_DEBOUNCE_MS);
        debounceTimer = timer;
        cancelPending = cancel;
        pendingSaveCancellers.add(cancel);
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

  // Wires every autosave-eligible control on the page. The quick-add rule
  // builder owns its own fields (rule-builder.ts); they are not options, so
  // autosaving them here would flash a stray "saved" check over them.
  const setupAllFieldsAutosave = (): void => {
    ["textarea", "input", "select"].forEach((type) => {
      document.querySelectorAll(type).forEach((el) => {
        if (el.closest(".rule-builder")) {
          return;
        }
        setupAutosave(el);
      });
    });
  };

  const setupBeforeUnloadGuard = (): void => {
    window.addEventListener("beforeunload", (e) => {
      if (fieldSaveState.hasUnsaved() || ports.manualEditorState.anyDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  };

  // Called before an in-page tab switch (main tabs don't unload the page).
  const confirmPendingChanges = async (): Promise<boolean> => {
    // An existing request already owns these values. Keep the current tab
    // visible until it settles instead of prompting and launching a duplicate.
    if (ports.manualEditorState.anySaving() || fieldSaveState.anySaving()) {
      return false;
    }
    if (!fieldSaveState.hasUnsaved() && !ports.manualEditorState.anyDirty()) {
      return true;
    }
    const message =
      getMessage("optionsUnsavedChanges") || "Discard your unsaved changes, or keep editing?";
    if ((await showUnsavedChangesDialog(message)) === "keep") return false;
    pendingSaveCancellers.forEach((cancel) => cancel());
    ports.manualEditorState.dirtyIds().forEach((id) => ports.manualEditorState.discard(id));
    fieldSaveState.clear();
    await ports.restoreOptions();
    return true;
  };

  return {
    setupAutosave,
    setupAllFieldsAutosave,
    setupBeforeUnloadGuard,
    confirmPendingChanges,
    hasUnsavedField: fieldSaveState.hasUnsaved,
    anyFieldSaving: fieldSaveState.anySaving,
    // Exposed for syncOptionsPageAfterWebMcpApply, which must not clobber a
    // field the user is actively (or still-dirty) editing with an externally
    // applied value.
    fieldStatus: fieldSaveState.status,
    markFieldDirty: fieldSaveState.markDirty,
  };
};
