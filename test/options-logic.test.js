// Pure options-page helpers extracted from options.js (options-logic.js).
const OptionsLogic = (await import("../src/options/options-logic.js")).default;

describe("normalizeKeyComboForDisplay (upgraders)", () => {
  test("maps a stored raw keyCode to its friendly name", () => {
    expect(OptionsLogic.normalizeKeyComboForDisplay(18)).toBe("Alt");
    expect(OptionsLogic.normalizeKeyComboForDisplay("18")).toBe("Alt");
    expect(OptionsLogic.normalizeKeyComboForDisplay(17)).toBe("Ctrl");
    expect(OptionsLogic.normalizeKeyComboForDisplay(16)).toBe("Shift");
    expect(OptionsLogic.normalizeKeyComboForDisplay(91)).toBe("Meta");
  });

  test("leaves an already-named value and custom/blank keyCodes untouched", () => {
    expect(OptionsLogic.normalizeKeyComboForDisplay("Alt")).toBe("Alt");
    expect(OptionsLogic.normalizeKeyComboForDisplay(90)).toBe(90);
    expect(OptionsLogic.normalizeKeyComboForDisplay("")).toBe("");
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
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "")).toEqual(OPTS);
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "  ")).toEqual(OPTS);
  });

  test("prefix-matches on the value", () => {
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "al").map((o) => o.value)).toEqual(["Alt"]);
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "sh").map((o) => o.value)).toEqual(["Shift"]);
  });

  test("substring-matches on the label", () => {
    // "control" only appears in the Ctrl label, not its value
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "control").map((o) => o.value)).toEqual([
      "Ctrl",
    ]);
    // "windows" only appears in the Meta label
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "windows").map((o) => o.value)).toEqual([
      "Meta",
    ]);
  });

  test("is case-insensitive", () => {
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "ALT").map((o) => o.value)).toEqual(["Alt"]);
  });

  test("falls back to the full list when nothing matches (never empty)", () => {
    // e.g. a raw keyCode typed in — no named match, but the dropdown must not
    // render empty
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "90")).toEqual(OPTS);
    expect(OptionsLogic.filterKeyComboOptions(OPTS, "zzz")).toEqual(OPTS);
  });
});
