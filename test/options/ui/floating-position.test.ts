// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  calculateFloatingPlacement,
  floatingViewport,
  positionFloatingElement,
} from "../../../src/options/ui/floating-position.ts";

const viewport = { left: 0, top: 0, width: 320, height: 240 };

describe("floating placement", () => {
  it("clamps a surface to every viewport edge", () => {
    expect(
      calculateFloatingPlacement(
        { left: 300, right: 310, top: 20, bottom: 40 },
        { width: 180, height: 100 },
        viewport,
      ),
    ).toMatchObject({ left: 132, top: 44, maxWidth: 304, maxHeight: 100, side: "below" });
  });

  it("opens above when the lower viewport cannot contain the surface", () => {
    expect(
      calculateFloatingPlacement(
        { left: 40, right: 100, top: 190, bottom: 210 },
        { width: 160, height: 120 },
        viewport,
      ),
    ).toMatchObject({ left: 40, top: 66, maxHeight: 120, side: "above" });
  });

  it("caps oversized surfaces to a visual viewport with an offset", () => {
    expect(
      calculateFloatingPlacement(
        { left: 90, right: 110, top: 80, bottom: 100 },
        { width: 500, height: 500 },
        { left: 50, top: 40, width: 200, height: 160 },
        { prefer: "below" },
      ),
    ).toEqual({ left: 58, top: 104, maxWidth: 184, maxHeight: 88, side: "below" });
  });

  it("honors an above preference when both sides fit", () => {
    expect(
      calculateFloatingPlacement(
        { left: 80, right: 120, top: 120, bottom: 140 },
        { width: 100, height: 60 },
        viewport,
        { prefer: "above" },
      ).side,
    ).toBe("above");
  });

  it("aligns an RTL surface to the anchor's inline end", () => {
    expect(
      calculateFloatingPlacement(
        { left: 120, right: 220, top: 40, bottom: 60 },
        { width: 160, height: 80 },
        viewport,
        { align: "end" },
      ).left,
    ).toBe(60);
  });

  it("falls back from either preferred side when only the other side fits", () => {
    expect(
      calculateFloatingPlacement(
        { left: 40, right: 80, top: 30, bottom: 50 },
        { width: 100, height: 80 },
        viewport,
        { prefer: "above" },
      ).side,
    ).toBe("below");
    expect(
      calculateFloatingPlacement(
        { left: 40, right: 80, top: 190, bottom: 210 },
        { width: 100, height: 80 },
        viewport,
        { prefer: "below" },
      ).side,
    ).toBe("above");
  });

  it("reads the visual viewport when one is available", () => {
    vi.stubGlobal("visualViewport", {
      offsetLeft: 12,
      offsetTop: 18,
      width: 280,
      height: 190,
    });

    expect(floatingViewport()).toEqual({ left: 12, top: 18, width: 280, height: 190 });
    vi.unstubAllGlobals();
  });

  it("falls back from document dimensions to the window viewport", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(0);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(0);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(640);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(480);

    expect(floatingViewport()).toEqual({ left: 0, top: 0, width: 640, height: 480 });
  });

  it("positions measured surfaces and clamps an explicit width", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(240);
    const element = document.createElement("div");
    element.getBoundingClientRect = vi.fn(() => ({ width: 400, height: 80 }) as DOMRect);

    const placement = positionFloatingElement(
      element,
      { left: 30, right: 80, top: 40, bottom: 60 },
      { width: 400 },
    );

    expect(element.style.width).toBe("304px");
    expect(element.style.position).toBe("fixed");
    expect(element.style.maxWidth).toBe(`${placement.maxWidth}px`);
    expect(element.style.left).toBe(`${placement.left}px`);

    element.getBoundingClientRect = vi.fn(() => ({ width: 120, height: 40 }) as DOMRect);
    positionFloatingElement(element, { left: 30, right: 80, top: 40, bottom: 60 });
    expect(element.style.maxHeight).not.toBe("");

    positionFloatingElement(
      element,
      { left: 350, right: 390, top: 70, bottom: 90 },
      {
        relativeTo: { left: 100, top: 50 },
        viewport: { left: 100, top: 50, width: 320, height: 240 },
      },
    );
    expect(element.style.position).toBe("absolute");
    expect(element.style.left).toBe("192px");
    expect(element.style.top).toBe("44px");
  });
});
