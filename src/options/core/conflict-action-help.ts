// Explains the existing-file choice Save In carries out itself. Firefox has no
// native "ask" or "skip", so Save In lets the save start and reacts to
// Firefox's own rename; that costs a request, can stay silent, and for saves to
// the top of Downloads opens Save As wherever Firefox last saved. Chrome's
// native prompt needs no caption.
import { CONFLICT_ACTION, type ConflictAction } from "../../shared/constants.ts";
import { conflictResolutionFor, type ConflictCapabilities } from "../../shared/conflict-action.ts";

const CONFLICT_ACTIONS: ReadonlySet<string> = new Set(Object.values(CONFLICT_ACTION));
const isConflictAction = (value: string): value is ConflictAction => CONFLICT_ACTIONS.has(value);

export const updateConflictActionHelp = (
  capabilities: ConflictCapabilities,
  root: ParentNode = document,
): void => {
  const select = root.querySelector<HTMLSelectElement>("#conflictAction");
  const resolution =
    select && isConflictAction(select.value)
      ? conflictResolutionFor(select.value, capabilities)
      : null;
  const visible: string[] = [];
  root.querySelectorAll<HTMLElement>("[data-conflict-resolution]").forEach((help) => {
    help.hidden = help.dataset.conflictResolution !== resolution;
    if (!help.hidden && help.id) visible.push(help.id);
  });
  if (!select) return;
  if (visible.length > 0) select.setAttribute("aria-describedby", visible.join(" "));
  else select.removeAttribute("aria-describedby");
};

export const setupConflictActionHelp = (
  capabilities: ConflictCapabilities,
  root: ParentNode = document,
): void => {
  const update = () => updateConflictActionHelp(capabilities, root);
  root.querySelector<HTMLSelectElement>("#conflictAction")?.addEventListener("change", update);
  // Restore and import set the value without a change event.
  document.addEventListener("options-restored", update);
  update();
};
