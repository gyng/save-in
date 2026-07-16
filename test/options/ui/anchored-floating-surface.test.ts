// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupAnchoredFloatingSurface } from "../../../src/options/ui/anchored-floating-surface.ts";

describe("anchored floating surfaces", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(240);
  });

  afterEach(() => vi.restoreAllMocks());

  it("positions an open surface against its anchor", () => {
    const anchor = document.createElement("button");
    const surface = document.createElement("div");
    document.body.append(anchor, surface);
    anchor.getBoundingClientRect = vi.fn(
      () => ({ left: 40, right: 120, top: 30, bottom: 60, width: 80, height: 30 }) as DOMRect,
    );
    surface.getBoundingClientRect = vi.fn(
      () => ({ left: 0, right: 180, top: 0, bottom: 100, width: 180, height: 100 }) as DOMRect,
    );

    const floating = setupAnchoredFloatingSurface(anchor, surface);
    expect(floating.position()).toMatchObject({ left: 40, top: 64, side: "below" });
    expect(surface.style.position).toBe("fixed");
    floating.cleanup();
  });

  it("maps logical alignment through right-to-left direction", () => {
    const anchor = document.createElement("button");
    const surface = document.createElement("div");
    anchor.style.direction = "rtl";
    document.body.append(anchor, surface);
    anchor.getBoundingClientRect = vi.fn(
      () => ({ left: 120, right: 220, top: 30, bottom: 60, width: 100, height: 30 }) as DOMRect,
    );
    surface.getBoundingClientRect = vi.fn(
      () => ({ left: 0, right: 160, top: 0, bottom: 80, width: 160, height: 80 }) as DOMRect,
    );

    const floating = setupAnchoredFloatingSurface(anchor, surface, { align: "start" });
    expect(floating.position()?.left).toBe(60);
    floating.cleanup();
  });

  it("maps logical end in right-to-left layouts and coalesces scheduled positions", () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => (callbacks.push(callback), callbacks.length));
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const anchor = document.createElement("button");
    const surface = document.createElement("div");
    anchor.style.direction = "rtl";
    document.body.append(anchor, surface);
    anchor.getBoundingClientRect = vi.fn(
      () => ({ left: 120, right: 220, top: 30, bottom: 60, width: 100, height: 30 }) as DOMRect,
    );
    surface.getBoundingClientRect = vi.fn(
      () => ({ left: 0, right: 160, top: 0, bottom: 80, width: 160, height: 80 }) as DOMRect,
    );
    const floating = setupAnchoredFloatingSurface(anchor, surface, { align: "end" });

    floating.schedule();
    floating.schedule();
    callbacks.at(-1)?.(0);
    floating.cleanup();

    expect(request).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith(1);
    expect(surface.style.left).toBe("120px");
  });

  it("does not measure a closed surface", () => {
    const anchor = document.createElement("button");
    const surface = document.createElement("div");
    const measure = vi.fn();
    surface.getBoundingClientRect = measure;

    const floating = setupAnchoredFloatingSurface(anchor, surface, { isOpen: () => false });
    expect(floating.position()).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    floating.cleanup();
  });
});
