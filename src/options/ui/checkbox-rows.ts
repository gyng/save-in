export const setupCheckboxRows = () => {
  document.querySelectorAll('label:has(> input[type="checkbox"])').forEach((label) => {
    const checkbox = label.querySelector(":scope > input[type=checkbox]");
    if (!checkbox || label.querySelector(":scope > .opt-title")) return;
    const title = document.createElement("span");
    title.className = "opt-title";
    let node = checkbox.nextSibling;
    while (node) {
      const next = node.nextSibling;
      if (node instanceof Element && node.matches(".caption, .caption-line")) break;
      title.appendChild(node);
      node = next;
    }
    checkbox.after(title);
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.tagName === "LABEL" &&
      event.target.querySelector(":scope > input[type=checkbox]")
    ) {
      event.preventDefault();
      return;
    }
    const help = event.target.closest(".caption, .caption-line");
    if (!help) return;
    const interactive = event.target.closest("a, button, input, select, textarea, label, summary");
    if (interactive && help.contains(interactive)) return;
    const label = help.closest("label");
    if (label?.querySelector(":scope > input[type=checkbox]")) event.preventDefault();
  });
};
