import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readStyle = (name: string) => readFileSync(resolve("src/options", name), "utf8");

test("every static options CSS variable has a definition", () => {
  const css = `${readStyle("style.css")}\n${readStyle("reference.css")}`;
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const uses = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));

  // Path rows receive this depth from the visual editor at runtime.
  uses.delete("--row-depth");
  expect([...uses].filter((token) => !definitions.has(token))).toEqual([]);
});

test("reference tabs use the shared options tab primitive", () => {
  const shared = readStyle("style.css");
  const reference = readStyle("reference.css");

  expect(shared).toContain('.reference-tabs [role="tab"]');
  expect(reference).not.toContain("appearance: none");
});

test("shared controls use semantic geometry and interaction tokens", () => {
  const css = readStyle("style.css");

  expect(css).toContain("--control-height: 34px");
  expect(css).toContain("--compact-row-height: 32px");
  expect(css).not.toContain("rgba(128, 128, 128, 0.08)");
  expect(css).not.toContain("rgba(128, 128, 128, 0.22)");
  expect(css.match(/^\.editor-actions \{/gm)).toHaveLength(1);
  expect(css.match(/^\.path-editor-toolbar \{/gm)).toHaveLength(1);
  expect(css.match(/^\.variables-preview-table td \{/gm)).toHaveLength(1);
});

test("reference data rows do not use divider lines", () => {
  const reference = readStyle("reference.css");
  expect(reference).toContain(".reference-table tbody td");
  expect(reference).toContain("border-bottom: 0");
});

test("saved status keeps Undo in flow and animates around the icon center", () => {
  const css = readStyle("style.css");
  const undo = css.match(/\.saved-change-undo\s*\{([^}]*)\}/)?.[1] || "";
  const confirmedIcon = css.match(/#lastSavedAt\.saved-confirmed::before\s*\{([^}]*)\}/)?.[1] || "";

  expect(undo).not.toContain("position: absolute");
  expect(undo).not.toContain("transform: translate");
  expect(confirmedIcon).toContain("transform-origin: 50% 50%");
});
