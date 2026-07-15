// @vitest-environment jsdom

import { preferredScrollBehavior } from "../../src/shared/motion-preference.ts";

test("disables smooth scrolling when reduced motion is requested", () => {
  const matchMedia = vi.fn(() => ({ matches: true }));

  expect(preferredScrollBehavior(matchMedia)).toBe("auto");
  expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
});

test("keeps smooth scrolling for the default motion preference", () => {
  expect(preferredScrollBehavior(() => ({ matches: false }))).toBe("smooth");
  expect(preferredScrollBehavior(undefined)).toBe("smooth");
});

test("invokes the host media-query function with its required receiver", () => {
  const original = Reflect.get(globalThis, "matchMedia");
  const matchMedia = vi.fn(function (this: typeof globalThis) {
    expect(this).toBe(globalThis);
    return { matches: true };
  });
  Reflect.set(globalThis, "matchMedia", matchMedia);
  try {
    expect(preferredScrollBehavior()).toBe("auto");
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalThis, "matchMedia");
    else Reflect.set(globalThis, "matchMedia", original);
  }
});
