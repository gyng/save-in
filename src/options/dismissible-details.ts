export const setupOutsideDismiss = (
  details: HTMLDetailsElement | null = document.querySelector(".nav-resources"),
): void => {
  if (!details) return;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (details.open && target instanceof Node && !details.contains(target)) details.open = false;
  });
};

document
  .querySelectorAll<HTMLDetailsElement>(
    ".nav-resources, .history-columns, .history-export-menu, .history-more-menu",
  )
  .forEach((details) => setupOutsideDismiss(details));
