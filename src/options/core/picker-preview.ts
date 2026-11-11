import { resolveMenuAccessKey } from "../../menus/access-key.ts";
import type { MenuTree } from "../../menus/directory-parser.ts";

// The Click-to-save tab's picture of the in-page folder picker. It is drawn
// from the folders the user is editing right now, so it shows their own menu
// and keys rather than a stock example. It is decoration: the figure is hidden
// from assistive technology and nothing in it can be operated.

// A real picker scrolls; the picture only needs enough rows to be recognized.
const MAX_PREVIEW_ROWS = 7;

const ICON_PATHS = {
  folder: ["M3 6h6l2 2h10v11H3z"],
  folderOpen: ["M3 19V6h6l2 2h8v3", "M3 19l3-8h16l-3 8z"],
} as const;

const icon = (name: keyof typeof ICON_PATHS): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  ICON_PATHS[name].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
};

export const renderPickerPreview = (
  container: HTMLElement,
  { items }: MenuTree,
  numbered: boolean,
): void => {
  const paths = items.filter((item) => item.kind === "path");
  const parents = new Set(paths.map((item) => item.parentId));
  const depths = new Map<string, number>();
  let firstDestination = true;
  const rows = paths.slice(0, MAX_PREVIEW_ROWS).map((item) => {
    const depth = (depths.get(item.parentId) ?? -1) + 1;
    depths.set(item.id, depth);
    const heading = parents.has(item.id);
    const row = document.createElement("div");
    row.className = heading ? "picker-demo-heading" : "picker-demo-option";
    row.style.setProperty("--picker-demo-depth", String(depth));
    // The picker opens with its first destination highlighted.
    if (!heading && firstDestination) {
      row.classList.add("active");
      firstDestination = false;
    }
    const title = document.createElement("span");
    title.className = "picker-demo-title";
    title.textContent = item.title;
    row.append(icon(heading ? "folderOpen" : "folder"), title);
    // Only the top level's keys are live when the picker opens.
    const key =
      depth === 0
        ? resolveMenuAccessKey(numbered ? item.number : "", item.accessKeyOverride)
        : null;
    if (key !== null) {
      const chip = document.createElement("kbd");
      chip.textContent = key.toLowerCase();
      row.append(chip);
    }
    return row;
  });
  container.replaceChildren(...rows);
};

// The picker's key legend. The keys are glyphs, not words, so there is nothing
// to translate.
export const renderPickerPreviewLegend = (container: HTMLElement): void => {
  container.replaceChildren(
    ...[["\u2191", "\u2193"], ["\u21B5"], ["esc"]].map((group) => {
      const keys = document.createElement("span");
      keys.append(
        ...group.map((label) => {
          const key = document.createElement("kbd");
          key.textContent = label;
          return key;
        }),
      );
      return keys;
    }),
  );
};
