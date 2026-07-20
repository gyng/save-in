import {
  SOURCE_PANEL_COPY_VALUE_SLOT,
  formatSourcePanelCopy,
} from "../shared/source-panel-copy.ts";
import { positionDraggedSourcePanel } from "./source-panel-model.ts";
import { sourcePanelViewport } from "./source-panel-format.ts";
import { setButtonIcon } from "./source-panel-icons.ts";
import { PANEL_DOCKS } from "./source-panel-layout.ts";
import { closePanelHost } from "./source-panel-host.ts";
import type { PanelPlacement } from "./source-panel-layout.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

/** Header chrome: title, close button, dock picker, "copy filtered URLs",
 * and drag-to-move for the floating placement. */
export const wirePanelHeader = (ctx: SourcePanelContext): void => {
  const { host } = ctx;
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  title.textContent = ctx.copy.title;
  close.className = "header-button close";
  setButtonIcon(close, "close");
  close.title = ctx.copy.close;
  close.setAttribute("aria-label", ctx.copy.closeLabel);
  const dockPicker = document.createElement("details");
  dockPicker.className = "dock-picker";
  const dockButton = document.createElement("summary");
  dockButton.className = "header-button dock";
  setButtonIcon(dockButton, "dock");
  dockButton.setAttribute("aria-label", ctx.copy.changeDockLabel);
  dockButton.setAttribute("aria-haspopup", "menu");
  dockButton.setAttribute("aria-expanded", "false");
  const dockMenu = document.createElement("div");
  dockMenu.className = "dock-menu";
  dockMenu.setAttribute("role", "menu");
  dockMenu.hidden = true;
  const placementButtons = new Map<PanelPlacement, HTMLButtonElement>();
  ([...PANEL_DOCKS, "floating"] as const).forEach((placement) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placement = placement;
    button.setAttribute("role", "menuitemradio");
    button.textContent = ctx.copy.dockPositions[placement];
    button.addEventListener("click", () => {
      ctx.layout.placement = placement;
      ctx.setPanelMenuOpen(dockPicker, dockButton, dockMenu, false);
      ctx.applyLayout();
      ctx.commitLayout();
    });
    placementButtons.set(placement, button);
    dockMenu.append(button);
  });
  ctx.updatePlacementControls = () => {
    const placement = ctx.layout.placement;
    dockButton.title = formatSourcePanelCopy(
      ctx.copy.dockPositionTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      ctx.copy.dockPositions[placement],
    );
    placementButtons.forEach((button, value) => {
      button.setAttribute("aria-checked", String(value === placement));
    });
  };
  dockPicker.append(dockButton, dockMenu);
  ctx.wirePanelMenu(dockPicker, dockButton, dockMenu);
  dockButton.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.setPanelMenuOpen(dockPicker, dockButton, dockMenu, !dockPicker.open);
  });
  ctx.applyLayout();
  const closePanel = () => {
    closePanelHost(host);
  };
  ctx.closePanel = closePanel;
  close.addEventListener("click", closePanel);
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const copyUrls = document.createElement("button");
  copyUrls.className = "header-button copy-urls";
  setButtonIcon(copyUrls, "copy");
  copyUrls.title = ctx.copy.copyFilteredUrls;
  copyUrls.setAttribute("aria-label", ctx.copy.copyFilteredUrlsLabel);
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-group";
  const dragGrip = document.createElement("span");
  dragGrip.className = "drag-grip";
  dragGrip.setAttribute("aria-hidden", "true");
  const sourceCount = document.createElement("span");
  sourceCount.className = "source-count";
  titleGroup.append(dragGrip, title, sourceCount);
  headerActions.append(copyUrls, dockPicker, close);
  header.append(titleGroup, headerActions);
  let finishDrag: (() => void) | null = null;
  header.addEventListener("pointerdown", (event) => {
    if (!host.classList.contains("floating") || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, summary")) return;
    finishDrag?.();
    header.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = host.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const { left, top } = positionDraggedSourcePanel(
        rect,
        { x: startX, y: startY },
        { x: moveEvent.clientX, y: moveEvent.clientY },
        sourcePanelViewport(),
      );
      ctx.layout.floatingLeft = left;
      ctx.layout.floatingTop = top;
      ctx.applyLayout();
    };
    const finish = () => {
      if (finishDrag !== finish) return;
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", finish);
      header.removeEventListener("pointercancel", finish);
      finishDrag = null;
      ctx.commitLayout();
    };
    finishDrag = finish;
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", finish);
    header.addEventListener("pointercancel", finish);
  });
  let copyResetTimer = 0;
  let disposed = false;
  copyUrls.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(ctx.visibleSources.map(({ url }) => url).join("\n"))
      .then(() => {
        if (disposed) return;
        window.clearTimeout(copyResetTimer);
        setButtonIcon(copyUrls, "check");
        const copiedMessage = formatSourcePanelCopy(
          ctx.copy.copiedUrlsTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          ctx.visibleSources.length,
        );
        copyUrls.title = copiedMessage;
        copyUrls.setAttribute("aria-label", copiedMessage);
        ctx.announce(copiedMessage);
        copyResetTimer = window.setTimeout(() => {
          copyResetTimer = 0;
          setButtonIcon(copyUrls, "copy");
          copyUrls.title = ctx.copy.copyFilteredUrls;
          copyUrls.setAttribute("aria-label", ctx.copy.copyFilteredUrlsLabel);
        }, 1200);
      })
      .catch(() => {
        if (disposed) return;
        setButtonIcon(copyUrls, "error");
        copyUrls.title = ctx.copy.copyFailed;
        copyUrls.setAttribute("aria-label", ctx.copy.copyFailed);
        ctx.announce(ctx.copy.copyFailed);
      });
  });
  ctx.header = header;
  ctx.title = title;
  ctx.close = close;
  ctx.dockPicker = dockPicker;
  ctx.dockButton = dockButton;
  ctx.copyUrls = copyUrls;
  ctx.sourceCount = sourceCount;
  ctx.placementButtons = placementButtons;
  ctx.cleanupTasks.push(() => {
    disposed = true;
    finishDrag?.();
    window.clearTimeout(copyResetTimer);
  });
};
