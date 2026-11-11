// The keys that pick a destination in the in-page picker without filtering,
// mirroring the context menu's access keys: an item's own `(key: x)`, the Last
// used key, and — with numbering on — 1 to 9 for the first nine folders that
// can be picked. That numbering is the keyboard commands' "folder N" order.
//
// The browser menu scopes a key to one submenu level; the picker is a single
// flat list, so a key belongs to the first destination that claims it, in menu
// order, and a later duplicate simply has none.

export type PickerKeyCandidate = {
  id: string;
  // An explicit per-item access key; an empty string asks for no key at all.
  override?: string | undefined;
};

// One visible character, compared without case. Anything else is not a key a
// user could press as a single stroke in the filter box.
const normalizePickerKey = (value: string): string | undefined => {
  const characters = Array.from(value.trim());
  return characters.length === 1 ? characters.join("").toLowerCase() : undefined;
};

const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const assignPickerKeys = (
  lastUsed: { id: string; key: string } | null,
  destinations: readonly PickerKeyCandidate[],
  numbered: boolean,
): Map<string, string> => {
  const keys = new Map<string, string>();
  const taken = new Set<string>();
  const claim = (id: string, key: string | undefined): void => {
    if (key === undefined || taken.has(key)) return;
    taken.add(key);
    keys.set(id, key);
  };
  if (lastUsed) claim(lastUsed.id, normalizePickerKey(lastUsed.key));
  // Explicit keys first: a hand-written key must not lose to a number that
  // merely happened to reach the same character earlier in the list.
  destinations.forEach(({ id, override }) => {
    if (override !== undefined) claim(id, normalizePickerKey(override));
  });
  if (numbered) {
    destinations.forEach(({ id, override }, index) => {
      if (override === undefined) claim(id, NUMBER_KEYS[index]);
    });
  }
  return keys;
};
