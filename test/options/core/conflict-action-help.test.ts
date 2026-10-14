// @vitest-environment jsdom
import {
  setupConflictActionHelp,
  updateConflictActionHelp,
} from "../../../src/options/core/conflict-action-help.ts";

const FIREFOX = { conflictActionPrompt: false, conflictRenameDetection: true };
const CHROME = { conflictActionPrompt: true, conflictRenameDetection: false };

const render = (value: string) => {
  document.body.innerHTML = `
    <select id="conflictAction">
      <option value="uniquify">Create a unique name</option>
      <option value="overwrite">Overwrite</option>
      <option value="prompt">Ask each time</option>
      <option value="skip">Skip</option>
      <option value="bogus">Not a conflict action</option>
    </select>
    <p id="conflict-ask-help" data-conflict-resolution="ask" hidden>ask</p>
    <p id="conflict-skip-help" data-conflict-resolution="skip" hidden>skip</p>`;
  const select = document.querySelector<HTMLSelectElement>("#conflictAction")!;
  select.value = value;
  return select;
};

const visibleHelp = () =>
  [...document.querySelectorAll<HTMLElement>("[data-conflict-resolution]")]
    .filter((help) => !help.hidden)
    .map((help) => help.id);

describe("existing-file help", () => {
  test.each([
    ["prompt", FIREFOX, ["conflict-ask-help"]],
    ["skip", FIREFOX, ["conflict-skip-help"]],
    ["uniquify", FIREFOX, []],
    ["overwrite", FIREFOX, []],
    // Chrome's prompt is native: Save In does nothing it needs to explain.
    ["prompt", CHROME, []],
    ["bogus", FIREFOX, []],
  ])("%s with %o shows %o", (value, capabilities, expected) => {
    const select = render(value);
    updateConflictActionHelp(capabilities);

    expect(visibleHelp()).toEqual(expected);
    expect(select.getAttribute("aria-describedby")).toBe(expected[0] ?? null);
  });

  test("follows changes and restored values", () => {
    const select = render("uniquify");
    setupConflictActionHelp(FIREFOX);
    expect(visibleHelp()).toEqual([]);

    select.value = "skip";
    select.dispatchEvent(new Event("change"));
    expect(visibleHelp()).toEqual(["conflict-skip-help"]);

    // Restore and import set the value without a change event.
    select.value = "prompt";
    document.dispatchEvent(new Event("options-restored"));
    expect(visibleHelp()).toEqual(["conflict-ask-help"]);
  });

  test("tolerates a page without the control", () => {
    document.body.innerHTML = `<p data-conflict-resolution="skip">skip</p>`;
    setupConflictActionHelp(FIREFOX);
    expect(document.querySelector<HTMLElement>("p")!.hidden).toBe(true);
  });
});
