// Generic help-disclosure toggle: any element with a `data-help-for` target
// becomes a button that shows/hides that target and reflects state via
// aria-expanded/aria-controls.
const addHelp = (el: Element): void => {
  const helpFor = el instanceof HTMLElement ? el.dataset.helpFor : undefined;
  if (helpFor) {
    el.setAttribute("aria-controls", helpFor);
    el.setAttribute("aria-expanded", "false");
  }
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const targetEl = helpFor ? document.getElementById(helpFor) : null;
    if (!targetEl) {
      return;
    }

    if (targetEl.hidden) {
      el.scrollIntoView();
    }
    targetEl.hidden = !targetEl.hidden;
    el.setAttribute("aria-expanded", targetEl.hidden ? "false" : "true");
  });
};

export const setupHelpDisclosures = (): void => {
  document.querySelectorAll(".help").forEach(addHelp);
};
