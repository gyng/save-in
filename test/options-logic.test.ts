// Pure options-page helpers extracted from options.js (options-logic.js).
import { normalizeKeyComboForDisplay } from "../src/options/options-logic.ts";

describe("normalizeKeyComboForDisplay (upgraders)", () => {
  test("maps a stored raw keyCode to its friendly name", () => {
    expect(normalizeKeyComboForDisplay(18)).toBe("Alt");
    expect(normalizeKeyComboForDisplay("18")).toBe("Alt");
    expect(normalizeKeyComboForDisplay(17)).toBe("Ctrl");
    expect(normalizeKeyComboForDisplay(16)).toBe("Shift");
    expect(normalizeKeyComboForDisplay(91)).toBe("Meta");
  });

  test("leaves an already-named value and custom/blank keyCodes untouched", () => {
    expect(normalizeKeyComboForDisplay("Alt")).toBe("Alt");
    expect(normalizeKeyComboForDisplay(90)).toBe(90);
    expect(normalizeKeyComboForDisplay("")).toBe("");
  });
});
