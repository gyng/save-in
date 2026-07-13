import { copyText } from "../src/options/clipboard.ts";
import { addClickToCopy } from "../src/options/clicktocopy.ts";

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
