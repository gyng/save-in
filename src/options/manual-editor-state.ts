import { pathLinesToNodes, pathNodesToLines } from "./path-editor-model.ts";
import { parseVisualRoutingRules } from "./rule-visual-editor-model.ts";

type ManualEditor = {
  textarea: HTMLTextAreaElement;
  saved: string;
  sync: () => void;
  statuses: HTMLElement[];
  saveStatus: HTMLElement;
  valid: boolean;
  saving: boolean;
  validationPending: boolean;
  revision: number;
};

const visualRowSources = (id: string, source: string): string[] => {
  if (id === "paths") return pathNodesToLines(pathLinesToNodes(source));
  if (id === "filenamePatterns") {
    return parseVisualRoutingRules(source).rules.map((rule) => rule.source);
  }
  return [];
};

// Owns the dirty/baseline state shared by the text and visual representations
// of the two manual-save editors. DOM ids and Apply/Discard attributes remain
// the stable boundary used by the existing options page and older profiles.
export const createManualEditorState = (unsavedLabel: string | (() => string)) => {
  const editors: ManualEditor[] = [];
  const getUnsavedLabel = () =>
    typeof unsavedLabel === "function" ? unsavedLabel() : unsavedLabel;

  const setup = (id: string) => {
    const textarea = document.getElementById(id);
    const buttons = [
      ...document.querySelectorAll<HTMLElement>(`[data-apply="${id}"], [data-discard="${id}"]`),
    ];
    if (!(textarea instanceof HTMLTextAreaElement) || buttons.length === 0) {
      return;
    }

    const actionRows = [
      ...new Set(
        buttons
          .map((button) => button.parentElement)
          .filter((row): row is HTMLElement => row !== null),
      ),
    ];
    const firstActionRow = actionRows[0];
    /* v8 ignore next -- Connected action buttons always contribute a parent row. */
    if (!firstActionRow) return;
    const visualSurfaces = buttons
      .map((button) => button.closest<HTMLElement>("#paths-visual, #rules-visual"))
      .filter((surface, index, surfaces): surface is HTMLElement =>
        Boolean(surface && surfaces.indexOf(surface) === index),
      );
    const syncDirtyRows = (saved: string, current: string): void => {
      const savedRows = visualRowSources(id, saved);
      const currentRows = visualRowSources(id, current);
      const selector = id === "paths" ? ".path-editor-row" : ".rule-editor-card";
      const indexKey = id === "paths" ? "sourceIndex" : "ruleIndex";
      visualSurfaces.forEach((surface) => {
        surface.querySelectorAll<HTMLElement>(selector).forEach((row) => {
          const index = Number(row.dataset[indexKey]);
          row.classList.toggle(
            "is-dirty-row",
            Number.isSafeInteger(index) && currentRows[index] !== savedRows[index],
          );
        });
      });
    };
    const statuses = actionRows.map((row) => {
      const status = document.createElement("span");
      status.className = "editor-dirty-status";
      status.setAttribute("role", "status");
      status.textContent = getUnsavedLabel();
      status.hidden = true;
      row.insertBefore(status, row.querySelector(`[data-discard="${id}"]`));
      return status;
    });
    const firstStatus = statuses[0];
    /* v8 ignore next -- Each non-empty action-row list produces one status. */
    if (!firstStatus) return;
    const saveStatus = document.createElement("span");
    saveStatus.className = "editor-save-status";
    saveStatus.setAttribute("role", "status");
    saveStatus.hidden = true;
    firstActionRow.insertBefore(saveStatus, firstStatus);
    const sync = () => {
      const dirty = textarea.value !== editor.saved;
      buttons.forEach((button) => {
        const isApply = button.hasAttribute("data-apply");
        button.toggleAttribute(
          "disabled",
          !dirty || editor.saving || (isApply && (!editor.valid || editor.validationPending)),
        );
      });
      statuses.forEach((status) => {
        status.hidden = !dirty;
        if (!editor.saving) status.textContent = getUnsavedLabel();
      });
      syncDirtyRows(editor.saved, textarea.value);
    };
    const editor: ManualEditor = {
      textarea,
      saved: textarea.value,
      sync,
      statuses,
      saveStatus,
      valid: true,
      saving: false,
      validationPending: false,
      revision: 0,
    };
    editors.push(editor);

    textarea.addEventListener("input", () => {
      editor.revision += 1;
      editor.sync();
      editor.saveStatus.hidden = true;
    });
    textarea.addEventListener("visual-editor-rendered", () => editor.sync());
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        const apply = buttons.find((button) => button.hasAttribute("data-apply"));
        if (apply && !apply.hasAttribute("disabled")) {
          apply.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } else if (
        event.key === "Escape" &&
        (event.ctrlKey || event.metaKey) &&
        textarea.getAttribute("aria-expanded") !== "true" &&
        textarea.value !== editor.saved
      ) {
        event.preventDefault();
        buttons
          .find((button) => button.hasAttribute("data-discard"))
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    editor.sync();
  };

  const refreshBaselines = () => {
    editors.forEach((editor) => {
      // A restore/import is authoritative and must invalidate any Apply that
      // started against the previous value, even when no input event fired.
      editor.revision += 1;
      editor.saved = editor.textarea.value;
      editor.saving = false;
      editor.saveStatus.hidden = true;
      editor.sync();
    });
  };

  const find = (id: string) => editors.find((editor) => editor.textarea.id === id);

  const setValidity = (id: string, valid: boolean) => {
    const editor = find(id);
    if (!editor) return false;
    editor.valid = valid;
    editor.validationPending = false;
    editor.textarea.setAttribute("aria-busy", "false");
    if (valid) editor.textarea.removeAttribute("aria-invalid");
    else editor.textarea.setAttribute("aria-invalid", "true");
    editor.sync();
    return true;
  };

  const setValidationPending = (id: string) => {
    const editor = find(id);
    if (!editor) return false;
    editor.validationPending = true;
    editor.textarea.setAttribute("aria-busy", "true");
    editor.sync();
    return true;
  };

  const setValidationUnavailable = (id: string) => {
    const editor = find(id);
    if (!editor) return false;
    editor.validationPending = false;
    editor.valid = false;
    editor.textarea.setAttribute("aria-busy", "false");
    editor.sync();
    return true;
  };

  const setSaving = (id: string, saving: boolean, label?: string) => {
    const editor = find(id);
    if (!editor) return false;
    editor.saving = saving;
    editor.sync();
    if (saving && label) {
      editor.saveStatus.textContent = label;
      editor.saveStatus.hidden = false;
    } else if (!saving) editor.saveStatus.hidden = true;
    return true;
  };

  const markSaved = (
    id: string,
    label?: string,
    appliedValue?: unknown,
    expectedRevision?: number,
  ) => {
    const editor = find(id);
    if (!editor) return false;
    if (expectedRevision != null && editor.revision !== expectedRevision) {
      // The submitted revision still became the persisted baseline even when
      // the user typed a newer revision while it was saving. A restore/import
      // clears `saving`, so a response from before that authoritative baseline
      // change remains ignored.
      if (editor.saving && typeof appliedValue === "string") editor.saved = appliedValue;
      editor.saving = false;
      editor.sync();
      return false;
    }
    if (typeof appliedValue === "string") editor.textarea.value = appliedValue;
    if (typeof appliedValue !== "undefined") {
      editor.textarea.dispatchEvent(
        new CustomEvent("options-value-applied", { bubbles: true, detail: appliedValue }),
      );
    }
    editor.saved = editor.textarea.value;
    editor.saving = false;
    editor.statuses.forEach((status) => {
      status.textContent = label || getUnsavedLabel();
    });
    editor.sync();
    editor.saveStatus.textContent = label || "";
    editor.saveStatus.hidden = !label;
    return true;
  };

  const applyExternalBaseline = (id: string, appliedValue: unknown) => {
    const editor = find(id);
    if (!editor || typeof appliedValue !== "string") return false;
    const preserveDraft = editor.textarea.value !== editor.saved;

    // This persisted value is newer than any save already in flight. Invalidate
    // that save's revision while retaining the user's visible draft.
    editor.revision += 1;
    editor.saved = appliedValue;
    editor.saving = false;
    editor.saveStatus.hidden = true;
    if (!preserveDraft) {
      editor.textarea.value = appliedValue;
      editor.textarea.dispatchEvent(
        new CustomEvent("options-value-applied", { bubbles: true, detail: appliedValue }),
      );
    }
    editor.sync();
    return true;
  };

  const anyDirty = () => editors.some((editor) => editor.textarea.value !== editor.saved);
  const anySaving = () => editors.some((editor) => editor.saving);
  const dirtyIds = () =>
    editors
      .filter((editor) => editor.textarea.value !== editor.saved)
      .map((editor) => editor.textarea.id);
  const revision = (id: string) => find(id)?.revision;
  const canSave = (id: string) => {
    const editor = find(id);
    return Boolean(editor && editor.valid && !editor.validationPending && !editor.saving);
  };

  const discard = (id: string) => {
    const editor = editors.find((candidate) => candidate.textarea.id === id);
    if (!editor) {
      return false;
    }
    editor.textarea.value = editor.saved;
    editor.textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return true;
  };

  return {
    setup,
    refreshBaselines,
    anyDirty,
    anySaving,
    dirtyIds,
    revision,
    canSave,
    discard,
    setValidity,
    setValidationPending,
    setValidationUnavailable,
    setSaving,
    markSaved,
    applyExternalBaseline,
  };
};
