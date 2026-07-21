// Inline SVG for the history table's row actions. The options page ships no
// icon font and these are the only history-owned glyphs, so they are built as
// nodes rather than loaded as assets.

const svgRoot = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  return svg;
};

const withPaths = (svg: SVGSVGElement, paths: string[]): SVGSVGElement => {
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
};

export const folderIcon = (): SVGSVGElement => withPaths(svgRoot(), ["M3 6h7l2 2h9v10H3z"]);

type HistoryActionKind = "copy" | "debug" | "link" | "undo" | "move";

const ACTION_PATHS: Record<HistoryActionKind, string[]> = {
  copy: ["M8 8h11v11H8z", "M5 16H3V3h13v2"],
  debug: ["M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z", "M15 15l5 5"],
  undo: ["M3 7v6h6", "M3 13a9 9 0 1 0 2.6-7L3 8.4"],
  move: ["M3 6h7l2 2h9v12H3z", "M12 11v6", "M9 14l3 3 3-3"],
  link: [
    "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1",
    "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  ],
};

export const historyActionIcon = (kind: HistoryActionKind): SVGSVGElement =>
  withPaths(svgRoot(), ACTION_PATHS[kind]);
