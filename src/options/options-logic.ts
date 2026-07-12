// Pure, DOM-free helpers split out of options.js so they can be unit-tested.
// options.js itself runs top-level against the real options.html DOM and is
// covered only by the e2e; anything here is plain data-in/data-out logic.

const KEYCODE_NAMES: Record<string, string> = {
  16: "Shift",
  17: "Ctrl",
  18: "Alt",
  91: "Meta",
};

// Upgraders stored a raw keyCode for the click-to-save key (the old default
// was 18 = Alt). Custom keyCodes and already-named values pass through.
export const normalizeKeyComboForDisplay = (value: string | number): string | number => {
  const key = String(value);
  return key in KEYCODE_NAMES ? KEYCODE_NAMES[key] : value;
};
