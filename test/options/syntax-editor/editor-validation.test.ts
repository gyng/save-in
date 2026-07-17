// @vitest-environment jsdom
import {
  clearValidationFields,
  markValidationField,
} from "../../../src/options/syntax-editor/editor-validation.ts";

const field = () => document.querySelector<HTMLElement>("#f");
const root = () => document.querySelector<HTMLElement>("#root")!;

test("restores the original description after a single mark", () => {
  document.body.innerHTML = `<div id="root"><input id="f" aria-describedby="field-help"></div>`;
  markValidationField(field(), "error-paths");
  expect(field()!.getAttribute("aria-describedby")).toBe("field-help error-paths");

  clearValidationFields(root());
  expect(field()!.getAttribute("aria-describedby")).toBe("field-help");
  expect(field()!.hasAttribute("aria-invalid")).toBe(false);
});

// One row can carry several fatal errors — rule-visual-editor appends every
// message to a single target — so the same field is marked once per error.
test("restores the original description after the same field is marked twice", () => {
  document.body.innerHTML = `<div id="root"><input id="f" aria-describedby="field-help"></div>`;
  markValidationField(field(), "error-paths");
  markValidationField(field(), "error-paths");
  expect(field()!.getAttribute("aria-describedby")).toBe("field-help error-paths");

  clearValidationFields(root());
  expect(field()!.getAttribute("aria-describedby")).toBe("field-help");
});

test("drops the description entirely when a twice-marked field had none", () => {
  document.body.innerHTML = `<div id="root"><input id="f"></div>`;
  markValidationField(field(), "error-paths");
  markValidationField(field(), "error-paths");

  clearValidationFields(root());
  expect(field()!.hasAttribute("aria-describedby")).toBe(false);
});
