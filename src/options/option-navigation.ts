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
