import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesheet = readFileSync(resolve("src/options/style.css"), "utf8");
const referenceStylesheet = readFileSync(resolve("src/options/reference.css"), "utf8");
const optionsScript = readFileSync(resolve("src/options/options.ts"), "utf8");
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

test("retired options UI does not leave selectors, tokens, hooks, or assets behind", () => {
  for (const selector of [
    "about-mascot-status",
    "combo-dropdown",
    "combo-wrap",
    "deprecated-text",
    "float-right",
    "history-raw-text",
    "insert-menu",
    "section-actions",
    ".help.learn-more",
    ".guide-demo-box",
    ".menu-items-demo",
    ".demo-box",
    ".variables-preview-empty",
    ".variables-preview-structures",
    ".rule-template-example",
    ".history-downloadId-heading",
    ".chrome-only",
    ".link {",
    ".link:hover",
    ".link:active",
    ".link.external",
    "#submit {",
    ".firefox.badge",
    ".demo {",
    ".demo.g1",
    ".demo.g2",
    ".demo.g3",
    ".demo.g4",
  ]) {
    expect(stylesheet, selector).not.toContain(selector);
  }
  for (const token of [
    "blue80",
    "grey80",
    "green50",
    "magenta50",
    "link-color-hover",
    "orange50",
    "teal50",
  ]) {
    expect(stylesheet).not.toMatch(new RegExp(`--${token}\\s*:`));
  }
  expect(optionsScript).not.toContain(".chrome-only");
  expect(referenceStylesheet).not.toContain("body.reference-page");
  expect(existsSync(resolve("src/options/i/help-16.svg"))).toBe(false);
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
