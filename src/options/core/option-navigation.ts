// Sections become sibling tabs, so an option one section names is never on
// screen with it. Send the reader there instead of naming a tab they have to
// go find (#196), reusing the same event the search results, previews, and the
// "Open routing rules" buttons already navigate with.
export const setupOptionJumpLinks = (): void => {
  document.querySelectorAll<HTMLElement>("[data-goto-option]").forEach((link) =>
    link.addEventListener("click", (event) => {
      const id = link.dataset.gotoOption;
      const target = id ? document.getElementById(id) : null;
      // A renamed or removed option leaves the anchor inert rather than
      // swallowing the click into nothing.
      if (!target) return;
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
    }),
  );
};

export const linkOptionPreview = (
  preview: HTMLElement,
  target: HTMLElement,
  title: string,
): void => {
  preview.setAttribute("role", "button");
  preview.setAttribute("tabindex", "0");
  preview.title = title;
  const navigate = () =>
    document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
  preview.addEventListener("click", navigate);
  preview.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    navigate();
  });
};
