import {
  enhanceReferenceTables,
  filterReferenceRows,
  groupReferenceRows,
  syncReferenceVocabulary,
} from "./reference-page.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { addClickToCopy } from "./click-to-copy.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";

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
  const tabs = [...document.querySelectorAll<HTMLElement>("[data-reference-tab]")];
  const panels = [...document.querySelectorAll<HTMLElement>("#reference-dialog [role='tabpanel']")];
  let opener: HTMLElement | null = null;
  const selectReference = (id: string) => {
    const selected = document.querySelector<HTMLElement>(`#${id}`);
    if (!dialog || !selected || !panels.includes(selected)) return;
    panels.forEach((panel) => (panel.hidden = panel !== selected));
    tabs.forEach((tab) =>
      tab.setAttribute("aria-selected", String(tab.dataset.referenceTab === id)),
    );
    const label = id.replace("options-reference-", "");
    filter?.setAttribute("placeholder", `Filter ${label}`);
    if (filter) {
      filter.value = "";
      filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    if (!dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    filter?.focus();
  };

  tabs.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (link.dataset.referenceTab) selectReference(link.dataset.referenceTab);
    });
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
    tabs.forEach((tab) => tab.setAttribute("aria-selected", "false"));
    opener?.focus();
  });
};
