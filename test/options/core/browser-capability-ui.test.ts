// @vitest-environment jsdom
import { applyBrowserCapabilityUi } from "../../../src/options/core/browser-capability-ui.ts";
import { BROWSERS, setCurrentBrowser } from "../../../src/platform/chrome-detector.ts";

beforeEach(() => {
  document.body.innerHTML = `
    <select id="conflictAction">
      <option value="uniquify">Create a unique name</option>
      <option value="overwrite">Overwrite</option>
      <option class="conflict-prompt-only" value="prompt">Ask each time</option>
    </select>`;
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
