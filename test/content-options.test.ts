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
