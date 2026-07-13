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

test("reference tables share one column grid across sections", () => {
  const reference = readStyle("reference.css");
  const table = reference.match(/\.reference-table\s*\{([^}]*)\}/)?.[1] || "";
  const syntax =
    reference.match(/\.reference-table thead th:nth-child\(1\)\s*\{([^}]*)\}/)?.[1] || "";
  const example =
    reference.match(/\.reference-table thead th:nth-child\(2\)\s*\{([^}]*)\}/)?.[1] || "";
  const meaning =
    reference.match(/\.reference-table thead th:nth-child\(3\)\s*\{([^}]*)\}/)?.[1] || "";

  expect(table).toContain("table-layout: fixed");
  expect(table).toContain("width: 100%");
  expect(syntax).toContain("width: 22%");
  expect(example).toContain("width: 28%");
  expect(meaning).toContain("width: 50%");
});

test("language label and selector share a text baseline", () => {
  const css = readStyle("style.css");
  const selector = css.match(/\.language-selector\s*\{([^}]*)\}/)?.[1] || "";

  expect(selector).toContain("align-items: baseline");
});

test("saved status keeps Undo and confirmation motion out of the baseline flow", () => {
  const css = readStyle("style.css");
  const undo = css.match(/\.saved-change-undo\s*\{([^}]*)\}/)?.[1] || "";
  const confirmedIcon = css.match(/#lastSavedAt\.saved-confirmed::before\s*\{([^}]*)\}/)?.[1] || "";

  expect(undo).toContain("position: absolute");
  expect(undo).not.toContain("transform: translate");
  expect(confirmedIcon).not.toContain("animation:");
});

test("click-to-save controls stay packed and wrap without overflowing their panel", () => {
  const css = readStyle("style.css");
  const controls = css.match(/\.click-to-save-controls\s*\{([^}]*)\}/)?.[1] || "";
  const hiddenLegend =
    css.match(/\.click-to-save-controls > legend\.visually-hidden\s*\{([^}]*)\}/)?.[1] || "";
  const selects = css.match(/\.click-to-save-controls select\s*\{([^}]*)\}/)?.[1] || "";
  const warning = css.match(/#click-to-save-warning\s*\{([^}]*)\}/)?.[1] || "";

  expect(controls).toContain("display: grid");
  expect(controls).toContain("justify-content: start");
  expect(controls).toContain("width: 100%");
  expect(controls).toContain("min-width: 0");
  expect(hiddenLegend).toContain("width: 1px");
  expect(selects).toContain("min-width: 0");
  expect(selects).toContain("max-width: 100%");
  expect(warning).toContain("box-sizing: border-box");
  expect(warning).toContain("overflow-wrap: anywhere");
});
