import { linkOptionPreview } from "../src/options/option-navigation.ts";

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

  expect(navigate).toHaveBeenCalledTimes(2);
  expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(target);
  document.removeEventListener("save-in:navigate-option", navigate);
});
