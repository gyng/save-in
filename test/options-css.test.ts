import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesheet = readFileSync(resolve("src/options/style.css"), "utf8");
const optionsScript = readFileSync(resolve("src/options/options.ts"), "utf8");
const selectorCount = (selector: string) => {
  const lines = stylesheet.split(/\r?\n/);
  return lines.filter(
    (line, index) => line.trim() === `${selector} {` && !lines[index - 1]?.trimEnd().endsWith(","),
  ).length;
};

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

test("removed options UI does not leave legacy selectors or browser hooks", () => {
  for (const selector of [
    ".help.learn-more",
    ".guide-demo-box",
    ".menu-items-demo",
    ".demo-box",
    ".variables-preview-empty",
    ".variables-preview-structures",
    ".rule-template-example",
    ".history-downloadId-heading",
    ".chrome-only",
  ]) {
    expect(stylesheet, selector).not.toContain(selector);
  }
  expect(optionsScript).not.toContain(".chrome-only");
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
