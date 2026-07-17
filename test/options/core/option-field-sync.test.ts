// @vitest-environment jsdom
import { setOptionFieldValue } from "../../../src/options/core/option-field-sync.ts";
import type { OptionSchema } from "../../../src/options/core/options-persistence.ts";
import { BROWSERS, setCurrentBrowser } from "../../../src/platform/chrome-detector.ts";
import {
  LEGACY_REFERER_HEADER_FILTER,
  OPTION_DEFAULTS,
} from "../../../src/config/option-defaults.ts";

const schema: OptionSchema = { keys: [], types: { BOOL: "BOOL", VALUE: "VALUE" } };
const UPGRADED_REFERER_FILTER = OPTION_DEFAULTS.setRefererHeaderFilter;

afterEach(() => setCurrentBrowser(BROWSERS.UNKNOWN));

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

// The background coerces these two through the option schema's onLoad, but the
// schema crosses to this page by structured clone, which drops functions. The
// page reads raw storage.local, so without the same coercion here it displays a
// value the browser cannot honour while the background already uses another —
// and an <option> that applyBrowserCapabilityUi hid stays selected regardless.
test("shows the conflict action Firefox actually uses for an imported prompt profile", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);
  document.body.innerHTML = `<select id="conflictAction">
    <option value="uniquify"></option><option value="overwrite"></option>
    <option class="conflict-prompt-only" value="prompt"></option></select>`;
  setOptionFieldValue(
    { name: "conflictAction", type: "VALUE", default: "uniquify" },
    "prompt",
    schema,
  );
  expect(document.querySelector<HTMLSelectElement>("#conflictAction")!.value).toBe("uniquify");
});

test("keeps the prompt conflict action on Chrome, which implements it", () => {
  setCurrentBrowser(BROWSERS.CHROME);
  document.body.innerHTML = `<select id="conflictAction">
    <option value="uniquify"></option><option value="prompt"></option></select>`;
  setOptionFieldValue(
    { name: "conflictAction", type: "VALUE", default: "uniquify" },
    "prompt",
    schema,
  );
  expect(document.querySelector<HTMLSelectElement>("#conflictAction")!.value).toBe("prompt");
});

test("shows the shortcut format Firefox actually uses for a rejected stored type", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);
  document.body.innerHTML = `<select id="shortcutType">
    <option value="HTML_REDIRECT"></option>
    <option class="shortcut-extension-only" value="WINDOWS"></option></select>`;
  setOptionFieldValue(
    { name: "shortcutType", type: "VALUE", default: "HTML_REDIRECT" },
    "WINDOWS",
    schema,
  );
  expect(document.querySelector<HTMLSelectElement>("#shortcutType")!.value).toBe("HTML_REDIRECT");
});

test("keeps a Windows shortcut format on Chrome, which accepts the extension", () => {
  setCurrentBrowser(BROWSERS.CHROME);
  document.body.innerHTML = `<select id="shortcutType">
    <option value="HTML_REDIRECT"></option><option value="WINDOWS"></option></select>`;
  setOptionFieldValue(
    { name: "shortcutType", type: "VALUE", default: "HTML_REDIRECT" },
    "WINDOWS",
    schema,
  );
  expect(document.querySelector<HTMLSelectElement>("#shortcutType")!.value).toBe("WINDOWS");
});

// replacementChar has no validate, so APPLY_CONFIG stores whatever is typed and
// only onLoad coerces it. The field showed the typed value forever while every
// path used "_".
test("shows the replacement char the background actually uses for a forbidden one", () => {
  document.body.innerHTML = `<input id="replacementChar">`;
  setOptionFieldValue({ name: "replacementChar", type: "VALUE", default: "_" }, "/", schema);
  expect(document.querySelector<HTMLInputElement>("#replacementChar")!.value).toBe("_");
});

test("keeps an empty replacement char, which means deletion rather than invalid", () => {
  document.body.innerHTML = `<input id="replacementChar">`;
  setOptionFieldValue({ name: "replacementChar", type: "VALUE", default: "_" }, "", schema);
  expect(document.querySelector<HTMLInputElement>("#replacementChar")!.value).toBe("");
});

test("keeps a valid replacement char", () => {
  document.body.innerHTML = `<input id="replacementChar">`;
  setOptionFieldValue({ name: "replacementChar", type: "VALUE", default: "_" }, "-", schema);
  expect(document.querySelector<HTMLInputElement>("#replacementChar")!.value).toBe("-");
});

// onLoad extends the untouched pre-v4 preset with the MangaDex host (#218). It
// matches on exact equality, so a page that shows the legacy string invites an
// edit that no longer matches — silently dropping the host the upgrade granted.
test("shows the upgraded Referer filter for an untouched pre-v4 preset", () => {
  document.body.innerHTML = `<textarea id="setRefererHeaderFilter"></textarea>`;
  setOptionFieldValue(
    { name: "setRefererHeaderFilter", type: "VALUE", default: UPGRADED_REFERER_FILTER },
    LEGACY_REFERER_HEADER_FILTER,
    schema,
  );
  expect(document.querySelector<HTMLTextAreaElement>("#setRefererHeaderFilter")!.value).toBe(
    UPGRADED_REFERER_FILTER,
  );
});

test("preserves a customized Referer filter rather than upgrading it", () => {
  const customized = `${LEGACY_REFERER_HEADER_FILTER}\n*://example.test/*`;
  document.body.innerHTML = `<textarea id="setRefererHeaderFilter"></textarea>`;
  setOptionFieldValue(
    { name: "setRefererHeaderFilter", type: "VALUE", default: UPGRADED_REFERER_FILTER },
    customized,
    schema,
  );
  expect(document.querySelector<HTMLTextAreaElement>("#setRefererHeaderFilter")!.value).toBe(
    customized,
  );
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
