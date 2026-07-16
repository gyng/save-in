import type { PageSourceKind } from "./source-panel-model.ts";

export const ICON_PATHS = {
  copy: ["M8 8h10v10H8z", "M5 15H3V3h12v2"],
  dock: ["M3 4h18v16H3z", "M15 4v16"],
  popout: ["M13 4h7v7", "M20 4 10 14", "M17 13v7H4V7h7"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  check: ["m5 12 4 4L19 6"],
  error: ["M12 8v5", "M12 17h.01", "M4 20h16L12 4z"],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
} as const;

export const SOURCE_KIND_ICON_PATHS: Record<PageSourceKind, readonly string[]> = {
  image: ["M3 5h18v14H3z", "m3 11 4-4 4 4 3-3 5 5", "M8 9h.01"],
  video: ["M4 6h12v12H4z", "M16 9l4-3v12l-4-3z"],
  audio: [
    "M9 18V6l10-2v12",
    "M9 10l10-2",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M16 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
  stream: [
    "M12 12h.01",
    "M8.5 8.5a5 5 0 0 0 0 7",
    "M15.5 8.5a5 5 0 0 1 0 7",
    "M5 5a10 10 0 0 0 0 14",
    "M19 5a10 10 0 0 1 0 14",
  ],
  document: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M9 12h6", "M9 16h6"],
  link: [
    "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1",
    "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  ],
};

export const setButtonIcon = (button: HTMLElement, icon: keyof typeof ICON_PATHS) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  ICON_PATHS[icon].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  button.replaceChildren(svg);
};

export const createSourceKindIcon = (kind: PageSourceKind): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("kind-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  SOURCE_KIND_ICON_PATHS[kind].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
};
