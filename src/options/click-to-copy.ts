import { copyText, type CopyText } from "./clipboard.ts";

export const addClickToCopy = (el: HTMLElement, copy: CopyText = copyText): void => {
  el.title = `Click to copy ${el.textContent} to clipboard`;

  el.addEventListener("click", () => {
    void copy(el.textContent ?? "").catch(() => {});
  });
};

document.querySelectorAll<HTMLElement>(".click-to-copy").forEach((element) => {
  addClickToCopy(element);
});
