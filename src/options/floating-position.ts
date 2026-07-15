export type FloatingRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type FloatingViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FloatingPlacement = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  side: "above" | "below";
};

type FloatingPlacementOptions = {
  align?: "start" | "end";
  edge?: number;
  gap?: number;
  prefer?: "above" | "below" | "auto";
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const calculateFloatingPlacement = (
  anchor: FloatingRect,
  surface: { width: number; height: number },
  viewport: FloatingViewport,
  options: FloatingPlacementOptions = {},
): FloatingPlacement => {
  const edge = options.edge ?? 8;
  const gap = options.gap ?? 4;
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const inlineStart = viewport.left + edge;
  const inlineEnd = viewportRight - edge;
  const blockStart = viewport.top + edge;
  const blockEnd = viewportBottom - edge;
  const maxWidth = Math.max(0, inlineEnd - inlineStart);
  const width = Math.min(surface.width, maxWidth);
  const spaceAbove = Math.max(0, anchor.top - gap - blockStart);
  const spaceBelow = Math.max(0, blockEnd - anchor.bottom - gap);
  const prefer = options.prefer ?? "auto";
  const side =
    prefer === "above"
      ? surface.height <= spaceAbove || spaceAbove >= spaceBelow
        ? "above"
        : "below"
      : prefer === "below"
        ? surface.height <= spaceBelow || spaceBelow >= spaceAbove
          ? "below"
          : "above"
        : surface.height > spaceBelow && spaceAbove > spaceBelow
          ? "above"
          : "below";
  const maxHeight = Math.min(surface.height, side === "above" ? spaceAbove : spaceBelow);
  const preferredLeft = options.align === "end" ? anchor.right - width : anchor.left;
  const left = clamp(preferredLeft, inlineStart, inlineEnd - width);
  const top =
    side === "above"
      ? Math.max(blockStart, anchor.top - gap - maxHeight)
      : Math.min(blockEnd - maxHeight, anchor.bottom + gap);

  return { left, top, maxWidth, maxHeight, side };
};

export const floatingViewport = (): FloatingViewport => {
  const viewport = window.visualViewport;
  if (viewport) {
    return {
      left: viewport.offsetLeft,
      top: viewport.offsetTop,
      width: viewport.width,
      height: viewport.height,
    };
  }
  return {
    left: 0,
    top: 0,
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
};

type PositionFloatingElementOptions = FloatingPlacementOptions & {
  width?: number;
};

export const positionFloatingElement = (
  element: HTMLElement,
  anchor: FloatingRect,
  options: PositionFloatingElementOptions = {},
): FloatingPlacement => {
  element.style.position = "fixed";
  element.style.maxWidth = "";
  element.style.maxHeight = "";
  if (options.width !== undefined) element.style.width = `${options.width}px`;
  const bounds = element.getBoundingClientRect();
  const placement = calculateFloatingPlacement(
    anchor,
    { width: bounds.width, height: bounds.height },
    floatingViewport(),
    options,
  );
  if (options.width !== undefined) {
    element.style.width = `${Math.min(options.width, placement.maxWidth)}px`;
  }
  element.style.maxWidth = `${placement.maxWidth}px`;
  element.style.maxHeight = `${placement.maxHeight}px`;
  element.style.left = `${placement.left}px`;
  element.style.top = `${placement.top}px`;
  return placement;
};
