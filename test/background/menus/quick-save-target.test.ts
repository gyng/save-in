import { resolveDefaultDestination } from "../../../src/menus/quick-save-target.ts";
import { parseTabAction } from "../../../src/menus/menu-tree.ts";

describe("resolveDefaultDestination", () => {
  test("keeps the Downloads root when the directory toggle is off", () => {
    expect(
      resolveDefaultDestination({ quickSaveDirectory: "Photos", quickSaveUseDirectory: false }),
    ).toBe(".");
  });

  test("uses the configured directory when the toggle is on", () => {
    expect(
      resolveDefaultDestination({ quickSaveDirectory: "Photos/cats", quickSaveUseDirectory: true }),
    ).toBe("Photos/cats");
  });

  test("trims surrounding whitespace from the configured directory", () => {
    expect(
      resolveDefaultDestination({ quickSaveDirectory: "  Photos  ", quickSaveUseDirectory: true }),
    ).toBe("Photos");
  });

  test("keeps a stored 4.1.0 relative directory as the folder 4.1.0 saved to", () => {
    expect(
      resolveDefaultDestination({ quickSaveDirectory: "./Saved.", quickSaveUseDirectory: true }),
    ).toBe("./Saved");
  });

  test("falls back to Downloads when the toggle is on but no directory is set", () => {
    expect(
      resolveDefaultDestination({ quickSaveDirectory: "   ", quickSaveUseDirectory: true }),
    ).toBe(".");
  });

  test.each(["../escape", "./Photos/:domian:"])(
    "falls back to Downloads when the configured directory is invalid: %s",
    (quickSaveDirectory) => {
      expect(resolveDefaultDestination({ quickSaveDirectory, quickSaveUseDirectory: true })).toBe(
        ".",
      );
    },
  );
});

describe("parseTabAction", () => {
  test("recognizes close", () => {
    expect(parseTabAction("close")).toBe("close");
    expect(parseTabAction("  CLOSE ")).toBe("close");
  });

  test("maps return synonyms to return", () => {
    expect(parseTabAction("return")).toBe("return");
    expect(parseTabAction("focus")).toBe("return");
    expect(parseTabAction("Activate")).toBe("return");
  });

  test("ignores unset or unrecognized values", () => {
    expect(parseTabAction(undefined)).toBeUndefined();
    expect(parseTabAction("")).toBeUndefined();
    expect(parseTabAction("minimize")).toBeUndefined();
  });
});
