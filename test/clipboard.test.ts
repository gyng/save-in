// @vitest-environment jsdom
import { copyText } from "../src/options/clipboard.ts";
import { addClickToCopy } from "../src/options/click-to-copy.ts";

test("writes text through the Clipboard API", async () => {
  const clipboard = { writeText: vi.fn(async () => undefined) };

  await copyText("copy me", clipboard);

  expect(clipboard.writeText).toHaveBeenCalledWith("copy me");
});

test("reports an unavailable Clipboard API", async () => {
  await expect(copyText("copy me", null)).rejects.toThrow("Clipboard API is unavailable");
});

test("click-to-copy delegates the element text", async () => {
  const element = document.createElement("code");
  element.textContent = ":filename:";
  const copy = vi.fn(async () => undefined);
  addClickToCopy(element, copy);

  element.click();

  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(":filename:"));
});

test("click-to-copy contains clipboard failures and normalizes missing text", async () => {
  const element = document.createElement("code");
  Object.defineProperty(element, "textContent", { configurable: true, value: null });
  const copy = vi.fn(() => Promise.reject(new Error("denied")));
  addClickToCopy(element, copy);

  element.click();

  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(""));
});

test("automatically wires marked copy targets", async () => {
  vi.resetModules();
  document.body.innerHTML = '<code class="click-to-copy">automatic</code>';
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  await import("../src/options/click-to-copy.ts");
  document.querySelector<HTMLElement>(".click-to-copy")!.click();

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("automatic"));
});
