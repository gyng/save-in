type ManualEditor = {
  textarea: HTMLTextAreaElement;
  saved: string;
  sync: () => void;
  statuses: HTMLElement[];
  saveStatus: HTMLElement;
  valid: boolean;
  saving: boolean;
  validationPending: boolean;
};

// Owns the dirty/baseline state shared by the text and visual representations
// of the two manual-save editors. DOM ids and Apply/Discard attributes remain
// the stable boundary used by the existing options page and older profiles.
export const createManualEditorState = (unsavedLabel: string) => {
  const editors: ManualEditor[] = [];

  const setup = (id: string) => {
    const textarea = document.querySelector(`#${id}`) as HTMLTextAreaElement;
    const buttons = [...document.querySelectorAll(`[data-apply="${id}"], [data-discard="${id}"]`)];
    if (!textarea || buttons.length === 0) {
      return;
    }

    const actionRows = [...new Set(buttons.map((button) => button.parentElement).filter(Boolean))];
    const statuses = actionRows.map((row) => {
      const status = document.createElement("span");
      status.className = "editor-dirty-status";
      status.setAttribute("aria-hidden", "true");
      status.textContent = unsavedLabel;
      status.hidden = true;
      row!.insertBefore(status, row!.querySelector(`[data-discard="${id}"]`));
      return status;
    });
    const saveStatus = document.createElement("span");
    saveStatus.className = "editor-save-status";
    saveStatus.setAttribute("role", "status");
    saveStatus.hidden = true;
    actionRows[0]!.insertBefore(saveStatus, statuses[0]);
    const editor: ManualEditor = {
      textarea,
      saved: textarea.value,
      sync: () => {},
      statuses,
      saveStatus,
      valid: true,
      saving: false,
      validationPending: false,
    };
    editors.push(editor);

    editor.sync = () => {
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
        if (!editor.saving) status.textContent = unsavedLabel;
      });
    };

    textarea.addEventListener("input", editor.sync);
    textarea.addEventListener("input", () => {
      editor.saveStatus.hidden = true;
    });
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
      editor.saved = editor.textarea.value;
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

  const markSaved = (id: string, label?: string, appliedValue?: unknown) => {
    const editor = find(id);
    if (!editor) return false;
    if (typeof appliedValue === "string") editor.textarea.value = appliedValue;
    if (typeof appliedValue !== "undefined") {
      editor.textarea.dispatchEvent(
        new CustomEvent("options-value-applied", { bubbles: true, detail: appliedValue }),
      );
    }
    editor.saved = editor.textarea.value;
    editor.saving = false;
    editor.statuses.forEach((status) => {
      status.textContent = label || unsavedLabel;
    });
    editor.sync();
    editor.saveStatus.textContent = label || "";
    editor.saveStatus.hidden = !label;
    return true;
  };

  const anyDirty = () => editors.some((editor) => editor.textarea.value !== editor.saved);
  const dirtyIds = () =>
    editors
      .filter((editor) => editor.textarea.value !== editor.saved)
      .map((editor) => editor.textarea.id);

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
    dirtyIds,
    discard,
    setValidity,
    setValidationPending,
    setValidationUnavailable,
    setSaving,
    markSaved,
  };
};
