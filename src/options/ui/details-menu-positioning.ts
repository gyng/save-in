import { positionFloatingElement, type FloatingPlacement } from "./floating-position.ts";

const popupSurface = (details: HTMLDetailsElement): HTMLElement | null =>
  details.querySelector<HTMLElement>(":scope > .menu-popover, :scope > .variables-preview-list");

const endAlignedSurface = (surface: HTMLElement): boolean =>
  surface.matches(
    ".history-columns-menu, .history-export-options, .history-more-options, " +
      ".path-editor-action-menu, .rule-editor-card-action-menu",
  );

export const positionDetailsMenu = (details: HTMLDetailsElement): FloatingPlacement | null => {
  if (!details.open) return null;
  const trigger = details.querySelector<HTMLElement>(":scope > summary");
  const surface = popupSurface(details);
  if (!trigger || !surface) return null;

  surface.style.inset = "auto";
  const direction = getComputedStyle(details).direction;
  const logicalEnd = endAlignedSurface(surface);
  const align = logicalEnd
    ? direction === "rtl"
      ? "start"
      : "end"
    : direction === "rtl"
      ? "end"
      : "start";
  const width = surface.classList.contains("variables-preview-list")
    ? details.getBoundingClientRect().width
    : undefined;
  return positionFloatingElement(surface, trigger.getBoundingClientRect(), {
    align,
    prefer: "below",
    ...(width === undefined ? {} : { width }),
  });
};

export const setupDetailsMenuPositioning = (root: Document | HTMLElement = document): void => {
  let frame = 0;
  const reposition = () => {
    frame = 0;
    root
      .querySelectorAll<HTMLDetailsElement>("details.details-popup[open]")
      .forEach(positionDetailsMenu);
  };
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(reposition);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["open"],
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  schedule();
};
