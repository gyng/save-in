// Cases imported by shell.test.ts to share one jsdom environment.
import {
  linkOptionPreview,
  setupOptionJumpLinks,
} from "../../../src/options/core/option-navigation.ts";

// #196: routing rules and the browser-download switches are sibling tabs, so a
// rule author never sees the option that widens their rules to ordinary
// downloads. The button has to reach it, not merely name it. Mirrors the
// existing "Open routing rules" button pointing the other way.
describe("option jump links (#196)", () => {
  test("a jump button navigates to the option it names", () => {
    const link = document.createElement("button");
    link.dataset.gotoOption = "jump-target";
    const target = document.createElement("input");
    target.id = "jump-target";
    document.body.append(link, target);
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate);

    setupOptionJumpLinks();
    link.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(target);
    document.removeEventListener("save-in:navigate-option", navigate);
    link.remove();
    target.remove();
  });

  // A renamed or deleted option must leave the anchor alone rather than
  // preventDefault() it into a click that visibly does nothing.
  test("a button naming a missing option stays inert", () => {
    const link = document.createElement("button");
    link.dataset.gotoOption = "not-here";
    document.body.append(link);
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate);

    setupOptionJumpLinks();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener("save-in:navigate-option", navigate);
    link.remove();
  });

  // An attribute written without a value names no option at all, so it gets the
  // same inert treatment rather than a lookup for the empty id.
  test("a button with an empty data-goto-option stays inert", () => {
    const link = document.createElement("button");
    link.setAttribute("data-goto-option", "");
    document.body.append(link);
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate);

    setupOptionJumpLinks();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener("save-in:navigate-option", navigate);
    link.remove();
  });
});

test("preview links navigate to their option by click or keyboard", () => {
  const preview = document.createElement("div");
  const target = document.createElement("input");
  const navigate = vi.fn();
  document.addEventListener("save-in:navigate-option", navigate);
  linkOptionPreview(preview, target, "Show setting");

  expect(preview.getAttribute("role")).toBe("button");
  expect(preview.tabIndex).toBe(0);
  expect(preview.title).toBe("Show setting");

  preview.click();
  preview.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  preview.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  preview.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  expect(navigate).toHaveBeenCalledTimes(3);
  expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(target);
  document.removeEventListener("save-in:navigate-option", navigate);
});
