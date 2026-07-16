import {
  enhanceReferenceTables,
  ensureReferenceEmptyState,
  filterReferenceRows,
  groupReferenceRows,
  syncReferenceVocabulary,
} from "../reference/reference-page.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { addClickToCopy } from "../ui/click-to-copy.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { sendInternalMessage } from "../../shared/message-protocol.ts";
import { bindTabInteractions, syncTabSelection } from "./tab-controls.ts";
import { getMessage } from "../../platform/localization.ts";

type ReferenceKind = "variables" | "clauses";

const enhanceReference = async (kind: ReferenceKind) => {
  const target = document.querySelector<HTMLElement>(`#options-reference-${kind}`);
  if (!target) return;

  try {
    const keywordResponse = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.GET_KEYWORDS,
    });
    const keywords = "matchers" in keywordResponse.body ? keywordResponse.body : undefined;
    const terms = kind === "variables" ? keywords?.variables : keywords?.matchers;
    if (Array.isArray(terms)) {
      syncReferenceVocabulary(
        target,
        kind,
        kind === "variables" ? terms : terms.map((term: string) => `${term}:`),
      );
    }
  } catch {}
  groupReferenceRows(target, kind);
  enhanceReferenceTables(target);
  ensureReferenceEmptyState(target);
  target.querySelector(".reference-loading-status")?.remove();
  target.querySelectorAll<HTMLElement>(".click-to-copy").forEach((token) => {
    token.tabIndex = 0;
    token.setAttribute("role", "button");
    addClickToCopy(token);
  });
};

export const setupOptionsReferences = () => {
  void enhanceReference("variables");
  void enhanceReference("clauses");

  const dialog = document.querySelector<HTMLDialogElement>("#reference-dialog");
  const filter = document.querySelector<HTMLInputElement>(".reference-dialog-filter");
  const descriptionRegion = dialog?.querySelector<HTMLElement>(".reference-dialog-descriptions");
  const descriptions = [
    ...(dialog?.querySelectorAll<HTMLElement>("[data-reference-description]") ?? []),
  ];
  const dialogTabs = [...(dialog?.querySelectorAll<HTMLElement>("[data-reference-tab]") ?? [])];
  const launchers = [...document.querySelectorAll<HTMLElement>("[data-reference-tab]")].filter(
    (control) => !dialog?.contains(control),
  );
  const panels = [...document.querySelectorAll<HTMLElement>("#reference-dialog [role='tabpanel']")];
  let opener: HTMLElement | null = null;
  const selectReference = (id: string, focusFilter: boolean) => {
    const selected = document.querySelector<HTMLElement>(`#${id}`);
    if (!dialog || !selected || !panels.includes(selected)) return;
    const selectedIndex = dialogTabs.findIndex((tab) => tab.dataset.referenceTab === id);
    if (selectedIndex < 0) return;
    syncTabSelection(dialogTabs, panels, selectedIndex);
    const filterCopy = {
      "options-reference-variables": getMessage("html_filterVariables") || "Filter variables",
      "options-reference-clauses": getMessage("html_filterClauses") || "Filter clauses",
      "options-reference-templates":
        getMessage("html_filterRoutingTemplates") || "Filter routing templates",
    }[id];
    if (filterCopy) filter?.setAttribute("placeholder", filterCopy);
    const description = descriptions.find(
      (candidate) => candidate.dataset.referenceDescription === id,
    );
    descriptions.forEach((candidate) => (candidate.hidden = candidate !== description));
    /* v8 ignore next -- The options document contract owns the description region. */
    if (descriptionRegion) descriptionRegion.hidden = !description;
    if (description) filter?.setAttribute("aria-describedby", description.id);
    else filter?.removeAttribute("aria-describedby");
    if (filter) {
      filter.value = "";
      filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    if (!dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (focusFilter) filter?.focus();
  };

  launchers.forEach((launcher) => {
    launcher.addEventListener("click", (event) => {
      event.preventDefault();
      if (launcher.dataset.referenceTab) selectReference(launcher.dataset.referenceTab, true);
    });
  });
  bindTabInteractions(dialogTabs, (index, focus) => {
    const tab = dialogTabs[index];
    if (!tab?.dataset.referenceTab) return;
    selectReference(tab.dataset.referenceTab, false);
    if (focus) tab.focus();
  });
  filter?.addEventListener("input", () => {
    const active = panels.find((panel) => !panel.hidden);
    if (active && active.id !== "options-reference-templates") {
      filterReferenceRows(active, filter.value);
    }
  });
  dialog?.querySelector(".reference-dialog-close")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog?.addEventListener("close", () => {
    dialogTabs.forEach((tab, index) => {
      tab.setAttribute("aria-selected", "false");
      tab.tabIndex = index === 0 ? 0 : -1;
    });
    opener?.focus();
  });
};
