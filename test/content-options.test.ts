import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_OPTION_KEYS,
  resolveContentOptions,
} from "../src/config/content-options.ts";
import { OPTION_KEYS } from "../src/config/option-schema.ts";

test("content option definitions stay aligned with the background schema", () => {
  const schema = new Map(OPTION_KEYS.map((definition) => [definition.name, definition.default]));

  CONTENT_OPTION_KEYS.forEach((name) => {
    expect(schema.get(name)).toBe(CONTENT_OPTION_DEFAULTS[name]);
  });
});

test("normalizes malformed values and preserves legacy numeric shortcut keycodes", () => {
  expect(
    resolveContentOptions({
      contentClickToSave: "yes",
      contentClickToSaveCombo: 18,
      contentClickToSaveButton: "DOUBLE_CLICK",
      links: null,
      sourcePanelEnabled: true,
    }),
  ).toEqual({
    ...CONTENT_OPTION_DEFAULTS,
    contentClickToSaveCombo: 18,
    sourcePanelEnabled: true,
  });
});

test("falls back safely when a stored shortcut string contains unknown keys", () => {
  expect(
    resolveContentOptions({
      contentClickToSaveCombo: "garbage",
    }).contentClickToSaveCombo,
  ).toBe(CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo);
  expect(
    resolveContentOptions({
      contentClickToSaveCombo: "Ctrl+garbage",
    }).contentClickToSaveCombo,
  ).toBe(CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo);

  expect(resolveContentOptions({ contentClickToSaveCombo: "None" }).contentClickToSaveCombo).toBe(
    "None",
  );
  expect(resolveContentOptions({ contentClickToSaveCombo: "90" }).contentClickToSaveCombo).toBe(
    "90",
  );

  const comboDefinition = OPTION_KEYS.find(({ name }) => name === "contentClickToSaveCombo")!;
  expect("validate" in comboDefinition && comboDefinition.validate("garbage")).toBe(false);
  expect("validate" in comboDefinition && comboDefinition.validate("Ctrl+Shift")).toBe(true);
});
