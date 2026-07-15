import { getMessage } from "../platform/localization.ts";
import { setupAnchoredFloatingSurface } from "./anchored-floating-surface.ts";

export type SavedChange = { name: string; before: unknown; after: unknown };

const savedPopoverPositioning = new WeakMap<HTMLElement, () => void>();

export const assertSettingsUndoSafe = (hasFieldDrafts: boolean, hasManualDrafts: boolean): void => {
  if (hasFieldDrafts || hasManualDrafts) {
    throw new Error(
      getMessage("savedUndoBlocked") || "Finish or discard your other edits before undoing",
    );
  }
};

const displayName = (name: string): string => {
  const field = document.getElementById(name);
  const label =
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
      ? field.labels?.item(0)
      : null;
  const localized = label?.querySelector<HTMLElement>(".opt-title")?.textContent?.trim();
  return (
    localized ||
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase())
  );
};

const displayValue = (value: unknown): string => {
  if (value === true) return getMessage("webhookStateOn") || "On";
  if (value === false) return getMessage("webhookStateOff") || "Off";
  if (value == null || value === "") return getMessage("html_none") || "None";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
};

const renderSavedChanges = (changes: SavedChange[], undo?: () => Promise<void> | void): void => {
  const status = document.querySelector<HTMLElement>(".save-status");
  if (status) {
    savedPopoverPositioning.get(status)?.();
    savedPopoverPositioning.delete(status);
  }
  status?.querySelector(".saved-change-popover")?.remove();
  status?.querySelector(".saved-change-undo")?.remove();
  status?.classList.remove("saved-has-changes");
  status?.removeAttribute("aria-describedby");
  if (!status || changes.length === 0) {
    status?.removeAttribute("tabindex");
    return;
  }

  status.classList.add("saved-has-changes");
  status.tabIndex = 0;
  status.setAttribute("aria-describedby", "saved-change-popover");
  const popover = document.createElement("div");
  popover.id = "saved-change-popover";
  popover.className = "saved-change-popover";
  popover.setAttribute("role", "tooltip");
  const floatingPopover = setupAnchoredFloatingSurface(status, popover, {
    isOpen: () => getComputedStyle(popover).display !== "none",
  });
  savedPopoverPositioning.set(status, floatingPopover.cleanup);
  const heading = document.createElement("strong");
  heading.textContent =
    changes.length === 1
      ? getMessage("savedSettingUpdated") || "Setting updated"
      : getMessage("savedSettingsUpdated", changes.length) || `${changes.length} settings updated`;
  const list = document.createElement("ul");
  changes.forEach(({ name, before, after }) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = displayName(name);
    const delta = document.createElement("span");
    delta.textContent = `${displayValue(before)} → ${displayValue(after)}`;
    item.append(label, delta);
    list.append(item);
  });
  popover.append(heading, list);
  if (undo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-change-undo";
    button.textContent = getMessage("savedUndo") || "Undo";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await undo();
      } catch (error) {
        button.disabled = false;
        button.textContent =
          error instanceof Error && error.message
            ? error.message
            : getMessage("savedUndoFailed") || "Undo failed — select to retry";
      }
    });
    status.append(button);
  }
  status.append(popover);
  floatingPopover.schedule();
};

export const markSavedNow = (
  changes: SavedChange[] = [],
  undo?: () => Promise<void> | void,
): void => {
  const indicator = document.querySelector<HTMLElement>("#lastSavedAt");
  if (!indicator) return;
  indicator.textContent = new Date().toLocaleTimeString();
  indicator.classList.remove("saved-confirmed");
  void indicator.offsetWidth;
  indicator.classList.add("saved-confirmed");
  renderSavedChanges(changes, undo);
};
