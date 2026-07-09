const { BROWSERS, setFeatures } = (await import("../src/chrome-detector.js")).default;

describe("setFeatures", () => {
  test("multitab tab-strip menus are Firefox-only", () => {
    expect(setFeatures(BROWSERS.FIREFOX).multitab).toBe(true);
    expect(setFeatures(BROWSERS.CHROME).multitab).toBe(false);
  });

  test("access keys are supported everywhere (min versions >= 121)", () => {
    expect(setFeatures(BROWSERS.FIREFOX).accessKeys).toBe(true);
    expect(setFeatures(BROWSERS.CHROME).accessKeys).toBe(true);
  });
});
