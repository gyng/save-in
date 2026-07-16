// Apply/Discard wiring for the two large grammar editors (paths,
// filenamePatterns). Apply persists the manual editor, re-baselines it (dims
// Apply/Discard), and refreshes the validation + preview panes; Discard
// reverts the editor to its stored value without saving.
import { getMessage } from "../../platform/localization.ts";
import { getAppliedValue } from "./options-save.ts";
import { errorChannel, showManualSaveError, updateErrorSummary } from "./routing-preview-panel.ts";
import { updateMenuPreview } from "./menu-preview.ts";

export type ManualEditorActionsPorts = {
  saveOptions: (e: Event | undefined, scope: string, scopeValue: unknown) => Promise<unknown>;
  refreshPreview: () => void;
  renderVariablesPreview: () => void;
  manualEditorState: {
    revision: (id: string) => number | undefined;
    setSaving: (id: string, saving: boolean, label?: string) => void;
    markSaved: (id: string, label: string, appliedValue: unknown, revision?: number) => void;
    discard: (id: string) => boolean;
  };
};

export const createManualEditorActions = (ports: ManualEditorActionsPorts) => {
  const setupApplyButtons = (): void => {
    document.querySelectorAll("[data-apply]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.getAttribute("data-apply") || "";
        const submittedValue = document.querySelector<HTMLTextAreaElement>(`#${id}`)?.value;
        const revision = ports.manualEditorState.revision(id);
        ports.manualEditorState.setSaving(id, true, getMessage("o_lSaving") || "Saving…");
        try {
          const response = await ports.saveOptions(undefined, id, submittedValue);
          ports.manualEditorState.markSaved(
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
            ports.refreshPreview();
            updateMenuPreview();
            ports.renderVariablesPreview();
          }, 200);
        } catch (error) {
          ports.manualEditorState.setSaving(id, false);
          showManualSaveError(id, error);
        }
      });
    });
  };

  const setupDiscardButtons = (): void => {
    document.querySelectorAll<HTMLElement>("[data-discard]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.discard;
        if (!id || !ports.manualEditorState.discard(id)) {
          return;
        }
        updateMenuPreview();
      });
    });
  };

  return { setupApplyButtons, setupDiscardButtons };
};
