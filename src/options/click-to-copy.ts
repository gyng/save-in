import { copyText, type CopyText } from "./clipboard.ts";
import { getMessage } from "../platform/localization.ts";

export const addClickToCopy = (el: HTMLElement, copy: CopyText = copyText): void => {
  const refreshLabel = () => {
    const value = el.textContent?.trim() || "value";
    const action = getMessage("referenceCopyValue", value) || `Copy ${value}`;
    if (!el.hasAttribute("aria-label") || el.dataset.copyLabelGenerated === "true") {
      el.setAttribute("aria-label", action);
      el.dataset.copyLabelGenerated = "true";
    }
    /* v8 ignore next -- The branch above guarantees a generated or caller-provided label. */
    el.title = el.getAttribute("aria-label") || action;
  };
  refreshLabel();
  if (el.dataset.copyToClipboard === "true") return;
  el.dataset.copyToClipboard = "true";
  el.tabIndex = 0;
  el.setAttribute("role", "button");

  const activate = () => {
    void copy(el.textContent ?? "")
      .then(() => {
        el.classList.add("copied");
        window.setTimeout(() => el.classList.remove("copied"), 1000);
        let status = document.querySelector<HTMLElement>("#copy-to-clipboard-status");
        if (!status) {
          status = document.createElement("div");
          status.id = "copy-to-clipboard-status";
          status.className = "visually-hidden";
          status.setAttribute("role", "status");
          status.setAttribute("aria-live", "polite");
          document.body.append(status);
        }
        status.textContent = getMessage("sourcePanelCopied") || "Copied";
      })
      .catch(() => {});
  };

  el.addEventListener("click", activate);
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  });
};

document.querySelectorAll<HTMLElement>(".click-to-copy").forEach((element) => {
  addClickToCopy(element);
});
