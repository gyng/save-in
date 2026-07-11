// Pure options-page helpers extracted from options.js (options-logic.js).
import {
  filterKeyComboOptions,
  normalizeKeyComboForDisplay,
} from "../src/options/options-logic.ts";

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

describe("filterKeyComboOptions", () => {
  const OPTS = [
    { value: "", label: "No key — mouse button only" },
    { value: "Alt", label: "Alt / Option" },
    { value: "Ctrl", label: "Control" },
    { value: "Shift", label: "Shift" },
    { value: "Meta", label: "Command / Windows key" },
  ];

  test("returns every option for an empty query", () => {
    expect(filterKeyComboOptions(OPTS, "")).toEqual(OPTS);
    expect(filterKeyComboOptions(OPTS, "  ")).toEqual(OPTS);
  });

  test("prefix-matches on the value", () => {
    expect(filterKeyComboOptions(OPTS, "al").map((option) => option.value)).toEqual(["Alt"]);
    expect(filterKeyComboOptions(OPTS, "sh").map((option) => option.value)).toEqual(["Shift"]);
  });

  test("substring-matches on the label", () => {
    // "control" only appears in the Ctrl label, not its value
    expect(filterKeyComboOptions(OPTS, "control").map((option) => option.value)).toEqual(["Ctrl"]);
    // "windows" only appears in the Meta label
    expect(filterKeyComboOptions(OPTS, "windows").map((option) => option.value)).toEqual(["Meta"]);
  });

  test("is case-insensitive", () => {
    expect(filterKeyComboOptions(OPTS, "ALT").map((option) => option.value)).toEqual(["Alt"]);
  });

  test("falls back to the full list when nothing matches (never empty)", () => {
    // e.g. a raw keyCode typed in — no named match, but the dropdown must not
    // render empty
    expect(filterKeyComboOptions(OPTS, "90")).toEqual(OPTS);
    expect(filterKeyComboOptions(OPTS, "zzz")).toEqual(OPTS);
  });
});
