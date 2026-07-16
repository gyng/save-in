import { positionFloatingElement, type FloatingPlacement } from "./floating-position.ts";

type LogicalAlignment = "start" | "end";

type AnchoredFloatingSurfaceOptions = {
  align?: LogicalAlignment;
  isOpen?: () => boolean;
  prefer?: "above" | "below" | "auto";
};

export type AnchoredFloatingSurface = {
  cleanup(): void;
  position(): FloatingPlacement | null;
  schedule(): void;
};

export const setupAnchoredFloatingSurface = (
  anchor: HTMLElement,
  surface: HTMLElement,
  options: AnchoredFloatingSurfaceOptions = {},
): AnchoredFloatingSurface => {
  let frame: number | undefined;
  const position = (): FloatingPlacement | null => {
    if (options.isOpen && !options.isOpen()) return null;
    const logicalAlignment = options.align ?? "start";
    const direction = getComputedStyle(anchor).direction;
    const align =
      direction === "rtl" ? (logicalAlignment === "start" ? "end" : "start") : logicalAlignment;
    return positionFloatingElement(surface, anchor.getBoundingClientRect(), {
      align,
      prefer: options.prefer ?? "below",
    });
  };
  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      position();
    });
  };
  const cleanup = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    anchor.removeEventListener("pointerenter", schedule);
    anchor.removeEventListener("focusin", schedule);
    document.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
  };

  anchor.addEventListener("pointerenter", schedule);
  anchor.addEventListener("focusin", schedule);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  return { cleanup, position, schedule };
};
