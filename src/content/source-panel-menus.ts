import { positionFloatingElement } from "../shared/floating-position.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

/** Positioning, open-state tracking, and outside-click closing for the small
 * popup menus nested inside the panel (dock picker, per-row "more" menu). */
export const wirePanelMenus = (ctx: SourcePanelContext): void => {
  const { host, shadow, panel } = ctx;
  let panelMenuFrame: number | undefined;
  type OpenPanelMenu = { trigger: HTMLElement; menu: HTMLElement };
  const openPanelMenus = new Map<HTMLDetailsElement, OpenPanelMenu>();
  const positionPanelMenus = () => {
    panelMenuFrame = undefined;
    const panelBounds = panel.getBoundingClientRect();
    openPanelMenus.forEach(({ trigger, menu }, details) => {
      if (!details.isConnected || !trigger.isConnected || !menu.isConnected) {
        openPanelMenus.delete(details);
        return;
      }
      menu.style.inset = "auto";
      positionFloatingElement(menu, trigger.getBoundingClientRect(), {
        align: getComputedStyle(details).direction === "rtl" ? "start" : "end",
        prefer: "below",
        relativeTo: panelBounds,
        viewport: {
          left: panelBounds.left,
          top: panelBounds.top,
          width: panelBounds.width,
          height: panelBounds.height,
        },
      });
    });
  };
  const schedulePanelMenuPosition = () => {
    if (panelMenuFrame !== undefined) cancelAnimationFrame(panelMenuFrame);
    panelMenuFrame = requestAnimationFrame(positionPanelMenus);
  };
  shadow.addEventListener("scroll", schedulePanelMenuPosition, true);
  window.addEventListener("resize", schedulePanelMenuPosition);
  window.visualViewport?.addEventListener("resize", schedulePanelMenuPosition);
  window.visualViewport?.addEventListener("scroll", schedulePanelMenuPosition);

  let panelMenuSequence = 0;
  const setPanelMenuOpen = (
    details: HTMLDetailsElement,
    trigger: HTMLElement,
    menu: HTMLElement,
    open: boolean,
  ) => {
    if (open) {
      openPanelMenus.forEach((entry, candidate) => {
        setPanelMenuOpen(candidate, entry.trigger, entry.menu, false);
      });
      details.open = true;
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      panel.append(menu);
      openPanelMenus.set(details, { trigger, menu });
      schedulePanelMenuPosition();
      queueMicrotask(() => {
        if (details.open)
          menu.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
      });
      return;
    }
    const restoreFocus = menu.contains(shadow.activeElement);
    openPanelMenus.delete(details);
    details.open = false;
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    details.append(menu);
    if (restoreFocus) trigger.focus();
  };
  const wirePanelMenu = (details: HTMLDetailsElement, trigger: HTMLElement, menu: HTMLElement) => {
    menu.id = `save-in-source-panel-menu-${++panelMenuSequence}`;
    trigger.setAttribute("aria-controls", menu.id);
    menu.addEventListener("keydown", (event) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
        (item) => !(item instanceof HTMLButtonElement) || !item.disabled,
      );
      if (items.length === 0) return;
      const activeIndex = items.indexOf(shadow.activeElement as HTMLElement);
      let nextIndex: number | undefined;
      if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % items.length;
      else if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + items.length) % items.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = items.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPanelMenuOpen(details, trigger, menu, false);
        trigger.focus();
        return;
      } else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });
  };
  const closeOpenMenus = () => {
    const entries = [...openPanelMenus];
    entries.forEach(([details, { trigger, menu }]) => {
      setPanelMenuOpen(details, trigger, menu, false);
    });
    return entries.length > 0;
  };
  const closeMenusOutside = (event: PointerEvent) => {
    if (event.target !== host) closeOpenMenus();
  };
  const closeMenusInsidePanel = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".dock-picker, .row-more, .dock-menu, .action-menu") !== null
    )
      return;
    closeOpenMenus();
  };
  document.addEventListener("pointerdown", closeMenusOutside, true);
  shadow.addEventListener("pointerdown", closeMenusInsidePanel);

  ctx.setPanelMenuOpen = setPanelMenuOpen;
  ctx.wirePanelMenu = wirePanelMenu;
  ctx.schedulePanelMenuPosition = schedulePanelMenuPosition;
  ctx.closeOpenMenus = closeOpenMenus;
  ctx.cleanupTasks.push(() => {
    if (panelMenuFrame !== undefined) cancelAnimationFrame(panelMenuFrame);
    shadow.removeEventListener("scroll", schedulePanelMenuPosition, true);
    window.removeEventListener("resize", schedulePanelMenuPosition);
    window.visualViewport?.removeEventListener("resize", schedulePanelMenuPosition);
    window.visualViewport?.removeEventListener("scroll", schedulePanelMenuPosition);
    document.removeEventListener("pointerdown", closeMenusOutside, true);
    shadow.removeEventListener("pointerdown", closeMenusInsidePanel);
  });
};
