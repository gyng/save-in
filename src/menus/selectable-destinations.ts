import type { MenuTree, MenuTreeItem } from "./directory-parser.ts";

export type MenuPathItem = Extract<MenuTreeItem, { kind: "path" }>;

// The destinations a user can actually pick, in menu order. An item with
// children renders as a submenu in both browsers and can never be clicked, so
// it is a heading here too, not a destination.
export const selectableDestinations = ({ items }: MenuTree): MenuPathItem[] => {
  const parents = new Set(items.map((item) => item.parentId));
  return items.filter(
    (item): item is MenuPathItem => item.kind === "path" && !parents.has(item.id),
  );
};
