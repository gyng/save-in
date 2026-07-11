// Pure, DOM-free helpers split out of options.js so they can be unit-tested.
// options.js itself runs top-level against the real options.html DOM and is
// covered only by the e2e; anything here is plain data-in/data-out logic.

export const OptionsLogic = {
  // Upgraders stored a raw keyCode for the click-to-save key (the old default
  // was 18 = Alt). Show the friendly name in the field; the content script's
  // comboToKeyCodes still resolves either a name or a raw number, so a custom
  // keyCode and an already-named value pass through untouched.
  KEYCODE_NAME: { 16: "Shift", 17: "Ctrl", 18: "Alt", 91: "Meta" } as Record<string, string>,
  normalizeKeyComboForDisplay: (value: string | number): string | number => {
    const key = String(value);
    return key in OptionsLogic.KEYCODE_NAME ? OptionsLogic.KEYCODE_NAME[key] : value;
  },

  // Filter the click-to-save combobox options by a query: a prefix match on the
  // key value or a substring match on the human label. Falls back to the full
  // list when nothing matches so the dropdown never renders empty.
  filterKeyComboOptions: <T extends { value: string; label: string }>(
    allOptions: T[],
    query: string,
  ): T[] => {
    const q = (query || "").trim().toLowerCase();
    const matched = allOptions.filter(
      (o) => !q || o.value.toLowerCase().startsWith(q) || o.label.toLowerCase().includes(q),
    );
    return matched.length ? matched : allOptions;
  },
};
