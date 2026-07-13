import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesheet = readFileSync(resolve("src/options/style.css"), "utf8");
const referenceStylesheet = readFileSync(resolve("src/options/reference.css"), "utf8");
const selectorCount = (selector: string) => {
  const lines = stylesheet.split(/\r?\n/);
  return lines.filter(
    (line, index) => line.trim() === `${selector} {` && !lines[index - 1]?.trimEnd().endsWith(","),
  ).length;
};

test("every options palette token has a consumer", () => {
  const definitions = [...stylesheet.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]!);
  for (const token of definitions) {
    expect(stylesheet, token).toContain(`var(${token})`);
  }
});

test("options CSS keeps shared component selectors in one rule", () => {
  for (const selector of [
    ".nav-resources > summary",
    ".rule-template-rule",
    "textarea",
    "button",
    ".path-editor-help p",
  ]) {
    expect(selectorCount(selector), selector).toBe(1);
  }
});

test("notification visibility and accent foregrounds use shared semantic rules", () => {
  expect(stylesheet).not.toContain(".error-notification:has(");
  expect(stylesheet).toContain("--color-on-accent: #ffffff;");
  for (const selector of [
    ".autocomplete-dropdown li.selected",
    ".apply-button",
    ".path-editor-drop-indicator",
    ".source-panel-demo-facets .active",
    ".video-thumb",
    ".stream-thumb",
    ".danger-button",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(stylesheet).toMatch(
      new RegExp(`${escaped}\\s*\\{[^}]*color:\\s*var\\(--color-on-accent\\)`),
    );
  }
});

test("warning and status colors use the semantic palette", () => {
  expect(stylesheet).toContain("--warning-fg:");
  expect(stylesheet).toMatch(/\.warning-text:not\(:empty\),[\s\S]*?color:\s*var\(--warning-fg\)/);
  for (const literal of [
    "rgba(10, 108, 255, 0.1)",
    "rgba(48, 230, 11, 0.14)",
    "rgba(128, 128, 128, 0.14)",
    "rgba(255, 0, 57, 0.12)",
  ]) {
    expect(stylesheet).not.toContain(literal);
  }
});

test("text colors stay on theme-aware semantic roles", () => {
  expect(stylesheet).not.toMatch(/^\s*color:\s*var\(--grey(?:50|60|70)\)/gm);
  expect(stylesheet).not.toMatch(/^\s*color:\s*var\(--red50\)/gm);
  expect(stylesheet).toMatch(/\.discard-button\s*\{[^}]*color:\s*var\(--color-text\)/);
  expect(stylesheet).toMatch(
    /\.editor-actions > \.manual-save-help\s*\{[^}]*color:\s*var\(--color-text\)/,
  );
});

test("dark links and accent backgrounds use separate contrast-safe roles", () => {
  const darkTheme = stylesheet.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const darkRoot = darkTheme.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const darkSettings = darkTheme.match(/#settings-page\s*\{([^}]*)\}/)?.[1] ?? "";

  expect(darkRoot).toContain("--link-color: var(--blue40)");
  expect(darkRoot).toContain("--link-color-active: var(--blue40)");
  expect(darkRoot).toContain("--color-accent-active: var(--blue60)");
  expect(darkSettings).not.toContain("--link-color");
  expect(stylesheet).toMatch(
    /\.apply-button:hover\s*\{[^}]*background-color:\s*var\(--color-accent-active\)/,
  );
});

test("identical heading, integration-header, and reference-focus rules stay consolidated", () => {
  expect(stylesheet).toMatch(/h4,\s*h5\s*\{/);
  expect(stylesheet).toMatch(/\.external-integrations-header,\s*\.external-access-heading\s*\{/);
  expect(referenceStylesheet).toMatch(
    /\.reference-search-label \.reference-search:focus-visible,\s*\.click-to-copy\[role="button"\]:focus-visible\s*\{/,
  );
});

test("interactive states retain theme-aware contrast", () => {
  expect(stylesheet).toMatch(/button:hover\s*\{[^}]*background-color:\s*var\(--hover-bg\)/);
  expect(stylesheet).toMatch(
    /button:active\s*\{[^}]*background-color:\s*var\(--hover-bg-strong\)/,
  );
  expect(stylesheet).toMatch(
    /\.click-to-copy:active\s*\{[^}]*background-color:\s*var\(--hover-bg-strong\)/,
  );

  const handle = stylesheet.match(/\.path-editor-handle\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(handle).toContain("color: var(--color-text-muted)");
  expect(handle).not.toMatch(/opacity:\s*0?\.[0-9]+/);
  expect(stylesheet).toMatch(
    /\.path-editor-row:hover \.path-editor-handle,\s*\.path-editor-row:focus-within \.path-editor-handle\s*\{[^}]*color:\s*var\(--color-text\)/,
  );
});
