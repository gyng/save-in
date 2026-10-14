// @vitest-environment jsdom
import { applyBrowserCapabilityUi } from "../../../src/options/core/browser-capability-ui.ts";
import { BROWSERS, setCurrentBrowser } from "../../../src/platform/chrome-detector.ts";

beforeEach(() => {
  document.body.innerHTML = `
    <select id="conflictAction">
      <option value="uniquify">Create a unique name</option>
      <option value="overwrite">Overwrite</option>
      <option class="conflict-prompt-only" value="prompt">Ask each time</option>
      <option class="conflict-skip-only" value="skip">Skip</option>
    </select>
    <select id="shortcutType">
      <option value="HTML_REDIRECT">HTML redirect</option>
      <option value="MAC_WEBLOC">macOS .webloc</option>
      <option class="shortcut-extension-only" value="WINDOWS">Windows .url</option>
      <option class="shortcut-extension-only" value="FREEDESKTOP">Freedesktop .desktop</option>
      <option class="shortcut-extension-only" value="MAC">macOS .url</option>
    </select>
    <div class="shortcut-extension-unavailable">Not available on Firefox</div>
    <dl>
      <dt class="chrome-only" id="offscreen-dt">Offscreen</dt>
      <dd class="chrome-only" id="offscreen-dd">Chrome-only download conversion.</dd>
    </dl>`;
});

afterEach(() => {
  setCurrentBrowser(BROWSERS.UNKNOWN);
});

const conflictAction = () => document.querySelector<HTMLSelectElement>("#conflictAction")!;
const promptOption = () => document.querySelector<HTMLOptionElement>(".conflict-prompt-only")!;

const skipOption = () => document.querySelector<HTMLOptionElement>(".conflict-skip-only")!;

// Firefox has no native prompt, but Save In emulates it and Skip through the
// rename Firefox reports for an existing file.
test("Firefox offers the emulated prompt and Skip conflict actions", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);

  applyBrowserCapabilityUi();

  expect(conflictAction().disabled).toBe(false);
  expect(promptOption().hidden).toBe(false);
  expect(promptOption().disabled).toBe(false);
  expect(skipOption().hidden).toBe(false);
  expect(skipOption().disabled).toBe(false);
});

// Chrome reports its rename too late to cancel reliably, so it keeps only its
// native prompt.
test("Chrome offers the native prompt but not Skip", () => {
  setCurrentBrowser(BROWSERS.CHROME);

  applyBrowserCapabilityUi();

  expect(conflictAction().disabled).toBe(false);
  expect(promptOption().hidden).toBe(false);
  expect(promptOption().disabled).toBe(false);
  // Hidden alone leaves an <option> selectable.
  expect(skipOption().hidden).toBe(true);
  expect(skipOption().disabled).toBe(true);
});

const shortcutOptions = () => [
  ...document.querySelectorAll<HTMLOptionElement>(".shortcut-extension-only"),
];
const unavailableNote = () =>
  document.querySelector<HTMLElement>(".shortcut-extension-unavailable")!;

// Firefox rejects a download whose filename ends .url or .desktop outright
// (#207, reproduced on a current Firefox), so those formats cannot be offered
// there at all — unlike the conflict action above, where only one value is out.
test("Firefox drops the shortcut formats whose extension it refuses, and says why", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);

  applyBrowserCapabilityUi();

  for (const option of shortcutOptions()) {
    expect(option.hidden).toBe(true);
    // Hidden alone leaves an <option> selectable.
    expect(option.disabled).toBe(true);
  }
  // The formats Firefox does accept stay.
  expect(document.querySelector<HTMLOptionElement>('[value="HTML_REDIRECT"]')!.hidden).toBe(false);
  expect(document.querySelector<HTMLOptionElement>('[value="MAC_WEBLOC"]')!.hidden).toBe(false);
  // An explanation only helps where the formats are missing.
  expect(unavailableNote().hidden).toBe(false);
});

test("Chrome offers every shortcut format and no explanation", () => {
  setCurrentBrowser(BROWSERS.CHROME);

  applyBrowserCapabilityUi();

  for (const option of shortcutOptions()) {
    expect(option.hidden).toBe(false);
    expect(option.disabled).toBe(false);
  }
  expect(unavailableNote().hidden).toBe(true);
});

const offscreenRows = () => [
  document.querySelector<HTMLElement>("#offscreen-dt")!,
  document.querySelector<HTMLElement>("#offscreen-dd")!,
];

test("Firefox hides the Chrome-only offscreen permission rationale", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);

  applyBrowserCapabilityUi();

  for (const row of offscreenRows()) expect(row.hidden).toBe(true);
});

test("Chrome keeps the offscreen permission rationale visible", () => {
  setCurrentBrowser(BROWSERS.CHROME);

  applyBrowserCapabilityUi();

  for (const row of offscreenRows()) expect(row.hidden).toBe(false);
});
