import { sourcePanelViewport } from "./source-panel-format.ts";
import {
  DEFAULT_SOURCE_PANEL_LAYOUT,
  PANEL_DOCKS,
  saveSourcePanelLayout,
  sourcePanelLayout,
  type PanelDock,
} from "./source-panel-layout.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

/** Panel layout state (dock/floating placement and size) and the resize
 * handle that lets the user drag or keyboard-adjust it. Also owns
 * applyLayout/commitLayout/currentDock, which the header (dock picker,
 * drag-to-move) and row rendering (tooltip placement) call through ctx. */
export const wirePanelResize = (ctx: SourcePanelContext): void => {
  const { host } = ctx;
  ctx.layout = { ...sourcePanelLayout };
  const currentDock = (): PanelDock =>
    PANEL_DOCKS.find((candidate) => candidate === host.dataset.dock) ?? "right";
  ctx.currentDock = currentDock;
  const resize = document.createElement("div");
  resize.className = "resize";
  resize.tabIndex = 0;
  resize.setAttribute("aria-label", ctx.copy.resizeLabel);
  resize.title = ctx.copy.resizeLabel;
  ctx.resize = resize;
  const updateResizeAccessibility = () => {
    const placement = ctx.layout.placement;
    const viewport = sourcePanelViewport();
    if (placement === "floating") {
      resize.setAttribute("role", "separator");
      resize.setAttribute("aria-orientation", "vertical");
      resize.setAttribute("aria-valuemin", "320");
      resize.setAttribute("aria-valuemax", String(Math.max(320, Math.floor(viewport.width - 16))));
      resize.setAttribute("aria-valuenow", String(Math.round(ctx.layout.floatingWidth)));
      resize.setAttribute(
        "aria-valuetext",
        `${Math.round(ctx.layout.floatingWidth)} × ${Math.round(ctx.layout.floatingHeight)}`,
      );
      return;
    }
    const sideDock = placement === "right" || placement === "left";
    const maximum = Math.floor(sideDock ? viewport.width * 0.92 : viewport.height * 0.85);
    resize.setAttribute("role", "separator");
    resize.setAttribute("aria-orientation", sideDock ? "vertical" : "horizontal");
    resize.setAttribute("aria-valuemin", String(sideDock ? 280 : 220));
    resize.setAttribute("aria-valuemax", String(Math.max(sideDock ? 280 : 220, maximum)));
    resize.setAttribute(
      "aria-valuenow",
      String(Math.round(sideDock ? ctx.layout.sideWidth : ctx.layout.dockHeight)),
    );
    resize.removeAttribute("aria-valuetext");
  };
  const applyLayout = () => {
    const placement = ctx.layout.placement;
    const viewport = sourcePanelViewport();
    if (placement === "floating" && viewport.width > 480) {
      ctx.layout.floatingWidth = clamp(ctx.layout.floatingWidth, 320, viewport.width - 16);
      ctx.layout.floatingHeight = clamp(ctx.layout.floatingHeight, 260, viewport.height - 16);
      ctx.layout.floatingLeft = clamp(
        ctx.layout.floatingLeft,
        viewport.left + 8,
        viewport.left + viewport.width - ctx.layout.floatingWidth - 8,
      );
      ctx.layout.floatingTop = clamp(
        ctx.layout.floatingTop,
        viewport.top + 8,
        viewport.top + viewport.height - ctx.layout.floatingHeight - 8,
      );
    }
    host.dataset.dock = placement;
    host.classList.remove("dock-left", "dock-bottom", "dock-top", "floating");
    if (placement === "floating") host.classList.add("floating");
    else if (placement !== "right") host.classList.add(`dock-${placement}`);
    host.style.setProperty("--source-panel-side-size", `${ctx.layout.sideWidth}px`);
    host.style.setProperty("--source-panel-dock-size", `${ctx.layout.dockHeight}px`);
    host.style.setProperty("--source-panel-floating-left", `${ctx.layout.floatingLeft}px`);
    host.style.setProperty("--source-panel-floating-top", `${ctx.layout.floatingTop}px`);
    host.style.setProperty("--source-panel-floating-width", `${ctx.layout.floatingWidth}px`);
    host.style.setProperty("--source-panel-floating-height", `${ctx.layout.floatingHeight}px`);
    updateResizeAccessibility();
    ctx.updatePlacementControls();
  };
  ctx.applyLayout = applyLayout;
  const commitLayout = () => saveSourcePanelLayout(ctx.layout);
  ctx.commitLayout = commitLayout;
  let finishResize: (() => void) | null = null;
  resize.addEventListener("pointerdown", (event) => {
    finishResize?.();
    resize.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = host.getBoundingClientRect().width;
    const startHeight = host.getBoundingClientRect().height;
    const move = (moveEvent: PointerEvent) => {
      const viewport = sourcePanelViewport();
      if (ctx.layout.placement === "floating") {
        ctx.layout.floatingWidth = clamp(
          startWidth + moveEvent.clientX - startX,
          320,
          viewport.width - 16,
        );
        ctx.layout.floatingHeight = clamp(
          startHeight + moveEvent.clientY - startY,
          260,
          viewport.height - 16,
        );
        applyLayout();
        return;
      }
      const dock = currentDock();
      if (dock === "right" || dock === "left") {
        const delta = dock === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        ctx.layout.sideWidth = clamp(startWidth + delta, 280, viewport.width * 0.92);
      } else {
        const delta = dock === "bottom" ? startY - moveEvent.clientY : moveEvent.clientY - startY;
        ctx.layout.dockHeight = clamp(startHeight + delta, 220, viewport.height * 0.85);
      }
      applyLayout();
    };
    const finish = () => {
      if (finishResize !== finish) return;
      resize.removeEventListener("pointermove", move);
      resize.removeEventListener("pointerup", finish);
      resize.removeEventListener("pointercancel", finish);
      finishResize = null;
      commitLayout();
    };
    finishResize = finish;
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", finish);
    resize.addEventListener("pointercancel", finish);
  });
  resize.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 12;
    const viewport = sourcePanelViewport();
    let handled = true;
    if (ctx.layout.placement === "floating") {
      if (event.key === "ArrowLeft") ctx.layout.floatingWidth -= step;
      else if (event.key === "ArrowRight") ctx.layout.floatingWidth += step;
      else if (event.key === "ArrowUp") ctx.layout.floatingHeight -= step;
      else if (event.key === "ArrowDown") ctx.layout.floatingHeight += step;
      else handled = false;
      ctx.layout.floatingWidth = clamp(ctx.layout.floatingWidth, 320, viewport.width - 16);
      ctx.layout.floatingHeight = clamp(ctx.layout.floatingHeight, 260, viewport.height - 16);
    } else if (ctx.layout.placement === "right" || ctx.layout.placement === "left") {
      const boundaryDelta =
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      if (boundaryDelta === 0) handled = false;
      else
        ctx.layout.sideWidth += ctx.layout.placement === "right" ? -boundaryDelta : boundaryDelta;
      ctx.layout.sideWidth = clamp(ctx.layout.sideWidth, 280, viewport.width * 0.92);
    } else {
      const boundaryDelta = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (boundaryDelta === 0) handled = false;
      else
        ctx.layout.dockHeight += ctx.layout.placement === "bottom" ? -boundaryDelta : boundaryDelta;
      ctx.layout.dockHeight = clamp(ctx.layout.dockHeight, 220, viewport.height * 0.85);
    }
    if (!handled) return;
    event.preventDefault();
    applyLayout();
    commitLayout();
  });
  resize.addEventListener("dblclick", () => {
    if (ctx.layout.placement === "floating") {
      ctx.layout.floatingWidth = DEFAULT_SOURCE_PANEL_LAYOUT.floatingWidth;
      ctx.layout.floatingHeight = DEFAULT_SOURCE_PANEL_LAYOUT.floatingHeight;
    } else if (ctx.layout.placement === "right" || ctx.layout.placement === "left") {
      ctx.layout.sideWidth = DEFAULT_SOURCE_PANEL_LAYOUT.sideWidth;
    } else {
      ctx.layout.dockHeight = DEFAULT_SOURCE_PANEL_LAYOUT.dockHeight;
    }
    applyLayout();
    commitLayout();
  });
  ctx.cleanupTasks.push(() => finishResize?.());
};
