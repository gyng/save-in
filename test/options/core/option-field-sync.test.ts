// @vitest-environment jsdom
import { setOptionFieldValue } from "../../../src/options/core/option-field-sync.ts";
import type { OptionSchema } from "../../../src/options/core/options-persistence.ts";

const schema: OptionSchema = { keys: [], types: { BOOL: "BOOL", VALUE: "VALUE" } };

test("sets a checkbox field from a stored boolean value", () => {
  document.body.innerHTML = `<input type="checkbox" id="tabEnabled">`;
  const ok = setOptionFieldValue(
    { name: "tabEnabled", type: "BOOL", default: false },
    true,
    schema,
  );
  expect(ok).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#tabEnabled")!.checked).toBe(true);
});

test("falls back to the schema default when no stored value exists", () => {
  document.body.innerHTML = `<input type="checkbox" id="tabEnabled">`;
  setOptionFieldValue({ name: "tabEnabled", type: "BOOL", default: true }, undefined, schema);
  expect(document.querySelector<HTMLInputElement>("#tabEnabled")!.checked).toBe(true);
});

test("sets a text/select/textarea field from a stored value", () => {
  document.body.innerHTML = `<input id="uiLocale">`;
  const ok = setOptionFieldValue({ name: "uiLocale", type: "VALUE", default: "" }, "fr", schema);
  expect(ok).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#uiLocale")!.value).toBe("fr");
});

test("normalizes a legacy numeric click-to-save keyCode for display", () => {
  document.body.innerHTML = `<input id="contentClickToSaveCombo">`;
  setOptionFieldValue({ name: "contentClickToSaveCombo", type: "VALUE", default: "" }, 18, schema);
  expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe("Alt");
});

test("passes a non-string/number click-to-save value through unchanged", () => {
  document.body.innerHTML = `<input id="contentClickToSaveCombo">`;
  setOptionFieldValue(
    { name: "contentClickToSaveCombo", type: "VALUE", default: "" },
    true,
    schema,
  );
  expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe("true");
});

test("returns false when the target element is missing", () => {
  document.body.innerHTML = "";
  const ok = setOptionFieldValue({ name: "missing", type: "VALUE", default: "" }, "x", schema);
  expect(ok).toBe(false);
});

test("returns false when the element type does not match the option type", () => {
  document.body.innerHTML = `<span id="notAField"></span>`;
  const ok = setOptionFieldValue({ name: "notAField", type: "VALUE", default: "" }, "x", schema);
  expect(ok).toBe(false);
});
