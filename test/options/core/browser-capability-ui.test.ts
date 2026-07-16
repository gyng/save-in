// @vitest-environment jsdom
import { applyBrowserCapabilityUi } from "../../../src/options/core/browser-capability-ui.ts";
import { BROWSERS, setCurrentBrowser } from "../../../src/platform/chrome-detector.ts";

beforeEach(() => {
  document.body.innerHTML = `
    <select id="conflictAction">
      <option value="uniquify">Create a unique name</option>
      <option value="overwrite">Overwrite</option>
      <option class="conflict-prompt-only" value="prompt">Ask each time</option>
    </select>
    <select id="shortcutType">
      <option value="HTML_REDIRECT">HTML redirect</option>
      <option value="MAC_WEBLOC">macOS .webloc</option>
      <option class="shortcut-extension-only" value="WINDOWS">Windows .url</option>
      <option class="shortcut-extension-only" value="FREEDESKTOP">Freedesktop .desktop</option>
      <option class="shortcut-extension-only" value="MAC">macOS .url</option>
    </select>
    <div class="shortcut-extension-unavailable">Not available on Firefox</div>`;
});

afterEach(() => {
  setCurrentBrowser(BROWSERS.UNKNOWN);
});

const conflictAction = () => document.querySelector<HTMLSelectElement>("#conflictAction")!;
const promptOption = () => document.querySelector<HTMLOptionElement>(".conflict-prompt-only")!;

// Firefox supports uniquify/overwrite; only "prompt" is unimplemented there.
test("Firefox keeps the conflict action select usable without the prompt option", () => {
  setCurrentBrowser(BROWSERS.FIREFOX);

  applyBrowserCapabilityUi();

  expect(conflictAction().disabled).toBe(false);
  expect(promptOption().hidden).toBe(true);
  expect(promptOption().disabled).toBe(true);
});

test("Chrome offers the prompt conflict action", () => {
  setCurrentBrowser(BROWSERS.CHROME);

  applyBrowserCapabilityUi();

  expect(conflictAction().disabled).toBe(false);
  expect(promptOption().hidden).toBe(false);
  expect(promptOption().disabled).toBe(false);
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
