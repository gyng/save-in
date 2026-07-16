import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_OPTION_KEYS,
  contentClickComboToKeyCodes,
  resolveContentOptions,
} from "../../src/config/content-options.ts";
import { OPTION_KEYS } from "../../src/config/option-schema.ts";
import { MAX_RECENT_DESTINATIONS } from "../../src/shared/constants.ts";
import { CONTENT_FEATURE_OPTION_DEFINITIONS } from "../../src/config/content-option-schema.ts";

test("content option definitions stay aligned with the background schema", () => {
  const schema = new Map(OPTION_KEYS.map((definition) => [definition.name, definition.default]));

  CONTENT_OPTION_KEYS.forEach((name) => {
    expect(schema.get(name)).toBe(CONTENT_OPTION_DEFAULTS[name]);
  });
});

test("content schema normalizes legacy automatic rules and shortcut keycodes", () => {
  const automatic = CONTENT_FEATURE_OPTION_DEFINITIONS.find(
    ({ name }) => name === "autoDownloadRules",
  )! as Extract<(typeof CONTENT_FEATURE_OPTION_DEFINITIONS)[number], { name: "autoDownloadRules" }>;
  const combo = CONTENT_FEATURE_OPTION_DEFINITIONS.find(
    ({ name }) => name === "contentClickToSaveCombo",
  )! as Extract<
    (typeof CONTENT_FEATURE_OPTION_DEFINITIONS)[number],
    { name: "contentClickToSaveCombo" }
  >;
  const theme = CONTENT_FEATURE_OPTION_DEFINITIONS.find(
    ({ name }) => name === "uiTheme",
  )! as Extract<(typeof CONTENT_FEATURE_OPTION_DEFINITIONS)[number], { name: "uiTheme" }>;

  expect("onSave" in automatic && automatic.onSave("  pageurl: example  ")).toBe(
    "pageurl: example",
  );
  expect(
    "onLoad" in automatic &&
      automatic.onLoad("pageurl: example\nsourcekind: image\ninto: automatic/").length,
  ).toBe(1);
  expect("onLoad" in combo && combo.onLoad(18)).toBe(18);
  expect("onLoad" in theme && theme.onLoad("forest")).toBe("pastel-pink");
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
  expect(resolveContentOptions("invalid")).toEqual(CONTENT_OPTION_DEFAULTS);

  const arraySnapshot = Object.assign([], { contentClickToSave: true });
  expect(resolveContentOptions(arraySnapshot)).toEqual(CONTENT_OPTION_DEFAULTS);
});

test.each([
  "autoDownloadDocuments",
  "autoDownloadBackgrounds",
  "autoDownloadManifests",
  "autoDownloadDataUrls",
] as const)("normalizes the %s scan-coverage channel like autoDownloadLinks", (name) => {
  expect(CONTENT_OPTION_DEFAULTS[name]).toBe(false);
  expect(resolveContentOptions({ [name]: true })[name]).toBe(true);
  for (const value of [null, 1, "true", undefined]) {
    expect(resolveContentOptions({ [name]: value })[name]).toBe(false);
  }
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
  expect(
    resolveContentOptions({ contentClickToSaveCombo: Number.POSITIVE_INFINITY })
      .contentClickToSaveCombo,
  ).toBe(CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo);

  const comboDefinition = OPTION_KEYS.find(({ name }) => name === "contentClickToSaveCombo")!;
  expect("validate" in comboDefinition && comboDefinition.validate("garbage")).toBe(false);
  expect("validate" in comboDefinition && comboDefinition.validate("Ctrl+Shift")).toBe(true);
});

test("validates the bounded recent-destination count", () => {
  const definition = OPTION_KEYS.find(({ name }) => name === "recentDestinationCount")!;
  const validate = "validate" in definition ? definition.validate : () => false;

  expect([0, MAX_RECENT_DESTINATIONS, " 3 "].every((value) => validate(value))).toBe(true);
  expect(
    [null, "", "   ", 1.5, -1, MAX_RECENT_DESTINATIONS + 1, Number.MAX_SAFE_INTEGER + 1].some(
      (value) => validate(value),
    ),
  ).toBe(false);
});

test.each([-1, 0, 1.5, "-1", "0", "1.5", "toString"])(
  "rejects malformed legacy shortcut key code %j",
  (value) => {
    expect(resolveContentOptions({ contentClickToSaveCombo: value }).contentClickToSaveCombo).toBe(
      CONTENT_OPTION_DEFAULTS.contentClickToSaveCombo,
    );
    expect(contentClickComboToKeyCodes(value)).toEqual([18]);
  },
);

test("normalizes interface locale and theme overrides", () => {
  expect(resolveContentOptions({}).uiLocale).toBe("");
  expect(resolveContentOptions({ uiLocale: "fr" }).uiLocale).toBe("fr");
  expect(resolveContentOptions({ uiLocale: "it" }).uiLocale).toBe("it");
  expect(resolveContentOptions({ uiLocale: "unknown" }).uiLocale).toBe("");
  expect(resolveContentOptions({ uiLocale: true }).uiLocale).toBe("");

  expect(resolveContentOptions({}).uiTheme).toBe("system");
  expect(resolveContentOptions({ uiTheme: "dark" }).uiTheme).toBe("dark");
  expect(resolveContentOptions({ uiTheme: "light" }).uiTheme).toBe("light");
  expect(resolveContentOptions({ uiTheme: "solarized-dark" }).uiTheme).toBe("solarized-dark");
  expect(resolveContentOptions({ uiTheme: "primary-grid" }).uiTheme).toBe("primary-grid");
  expect(resolveContentOptions({ uiTheme: "blue-house" }).uiTheme).toBe("blue-house");
  expect(resolveContentOptions({ uiTheme: "gilded-mosaic" }).uiTheme).toBe("gilded-mosaic");
  expect(resolveContentOptions({ uiTheme: "forest" }).uiTheme).toBe("pastel-pink");
  expect(resolveContentOptions({ uiTheme: "auto" }).uiTheme).toBe("system");
  expect(resolveContentOptions({ uiTheme: true }).uiTheme).toBe("system");

  const themeDefinition = OPTION_KEYS.find(({ name }) => name === "uiTheme")!;
  expect("validate" in themeDefinition && themeDefinition.validate("system")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("dark")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("berry")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("primary-grid")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("blue-house")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("gilded-mosaic")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("forest")).toBe(true);
  expect("validate" in themeDefinition && themeDefinition.validate("auto")).toBe(false);
});

test("normalizes the per-site disable list and defaults older profiles to empty", () => {
  // Older stored profiles predate the key: it must resolve to the safe default
  // (empty list, nothing disabled) rather than a broad match.
  expect(resolveContentOptions({}).perSiteDisableList).toBe("");
  expect(
    resolveContentOptions({ perSiteDisableList: "*://example.com/*" }).perSiteDisableList,
  ).toBe("*://example.com/*");
  for (const value of [null, 42, true, ["*://x/*"], { pattern: "*://x/*" }]) {
    expect(resolveContentOptions({ perSiteDisableList: value }).perSiteDisableList).toBe("");
  }

  const definition = CONTENT_FEATURE_OPTION_DEFINITIONS.find(
    ({ name }) => name === "perSiteDisableList",
  )! as Extract<
    (typeof CONTENT_FEATURE_OPTION_DEFINITIONS)[number],
    { name: "perSiteDisableList" }
  >;
  // The background keeps the raw string (no onLoad/onSave) so the backstop can
  // re-test the sender-tab URL against the same list the content bundle parses.
  expect(definition.type).toBe("VALUE");
  expect("onLoad" in definition).toBe(false);
  expect("onSave" in definition).toBe(false);
});

test("normalizes the automatic-save visit limit without reinterpreting malformed settings", () => {
  expect(resolveContentOptions({ autoDownloadMaxPerPage: 1 }).autoDownloadMaxPerPage).toBe(1);
  expect(resolveContentOptions({ autoDownloadMaxPerPage: "40" }).autoDownloadMaxPerPage).toBe(40);
  expect(resolveContentOptions({ autoDownloadMaxPerPage: 500 }).autoDownloadMaxPerPage).toBe(500);

  for (const value of [0, 501, 2.5, "", "many", true, null]) {
    expect(resolveContentOptions({ autoDownloadMaxPerPage: value }).autoDownloadMaxPerPage).toBe(
      CONTENT_OPTION_DEFAULTS.autoDownloadMaxPerPage,
    );
  }
});
