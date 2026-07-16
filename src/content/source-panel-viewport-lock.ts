import type { SourcePanelContext } from "./source-panel-context.ts";

/** Locks page scroll while the panel covers the full viewport on narrow
 * screens (the panel becomes a full-screen sheet below 480px). */
export const wirePanelViewportLock = (ctx: SourcePanelContext): void => {
  const pageRoot = document.documentElement;
  const previousRootOverflow = pageRoot.style.getPropertyValue("overflow");
  const previousRootOverflowPriority = pageRoot.style.getPropertyPriority("overflow");
  let pageScrollLocked = false;
  const restorePageScroll = () => {
    if (
      pageRoot.style.getPropertyValue("overflow") !== "hidden" ||
      pageRoot.style.getPropertyPriority("overflow") !== "important"
    )
      return;
    if (previousRootOverflow)
      pageRoot.style.setProperty("overflow", previousRootOverflow, previousRootOverflowPriority);
    else pageRoot.style.removeProperty("overflow");
  };
  const syncPageScrollLock = () => {
    const shouldLock = window.innerWidth <= 480;
    if (shouldLock === pageScrollLocked) return;
    pageScrollLocked = shouldLock;
    if (shouldLock) pageRoot.style.setProperty("overflow", "hidden", "important");
    else restorePageScroll();
  };
  syncPageScrollLock();
  window.addEventListener("resize", syncPageScrollLock);
  ctx.cleanupTasks.push(() => {
    window.removeEventListener("resize", syncPageScrollLock);
    restorePageScroll();
  });
};
