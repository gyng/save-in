// @vitest-environment jsdom
import { copyText } from "../../../src/options/ui/clipboard.ts";
import { addClickToCopy } from "../../../src/options/ui/click-to-copy.ts";

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
  expect(element.getAttribute("role")).toBe("button");
  expect(element.tabIndex).toBe(0);
});

test("click-to-copy can expose concise text while copying a complete value", async () => {
  vi.mocked(browser.i18n.getMessage).mockImplementationOnce(
    (_key, substitutions) =>
      `Copy ${Array.isArray(substitutions) ? substitutions[0] : substitutions}`,
  );
  const element = document.createElement("code");
  element.textContent = "exclude:";
  element.dataset.copyValue = "exclude: true";
  const copy = vi.fn(async () => undefined);
  addClickToCopy(element, copy);

  element.click();

  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("exclude: true"));
  expect(element.getAttribute("aria-label")).toContain("exclude: true");
});

test("click-to-copy preserves a caller-provided accessible label", () => {
  const element = document.createElement("code");
  element.textContent = ":filename:";
  element.setAttribute("aria-label", "Copy the filename variable");

  addClickToCopy(
    element,
    vi.fn(async () => undefined),
  );

  expect(element.getAttribute("aria-label")).toBe("Copy the filename variable");
  expect(element.title).toBe("Copy the filename variable");
});

test("click-to-copy gives an empty caller label a useful title", () => {
  vi.mocked(browser.i18n.getMessage).mockReturnValueOnce("");
  const element = document.createElement("code");
  element.textContent = ":filename:";
  element.setAttribute("aria-label", "");

  addClickToCopy(
    element,
    vi.fn(async () => undefined),
  );

  expect(element.getAttribute("aria-label")).toBe("");
  expect(element.title).toContain(":filename:");
});

test("click-to-copy supports keyboard activation and announces success", async () => {
  const element = document.createElement("code");
  element.textContent = "extension-id";
  document.body.append(element);
  const copy = vi.fn(async () => undefined);
  addClickToCopy(element, copy);

  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  element.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("extension-id"));
  await vi.waitFor(() =>
    expect(document.querySelector("#copy-to-clipboard-status")?.textContent).toBe(
      "Translated<sourcePanelCopied>",
    ),
  );
});

test("click-to-copy ignores unrelated keys, uses fallback status copy, and clears feedback", async () => {
  vi.useFakeTimers();
  vi.mocked(browser.i18n.getMessage).mockReturnValue("");
  const element = document.createElement("code");
  element.textContent = "extension-id";
  document.body.append(element);
  const copy = vi.fn(async () => undefined);
  addClickToCopy(element, copy);

  element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(copy).not.toHaveBeenCalled();

  element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await Promise.resolve();
  expect(element.classList).toContain("copied");
  expect(document.querySelector("#copy-to-clipboard-status")?.textContent).toBe("Copied");

  await vi.advanceTimersByTimeAsync(1_000);
  expect(element.classList).not.toContain("copied");
  vi.useRealTimers();
});

test("click-to-copy setup is idempotent", async () => {
  const element = document.createElement("code");
  element.textContent = "once";
  const copy = vi.fn(async () => undefined);
  addClickToCopy(element, copy);
  addClickToCopy(element, copy);

  element.click();

  await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
});

test("click-to-copy refreshes generated labels after dynamic content loads", () => {
  vi.mocked(browser.i18n.getMessage).mockImplementation(
    ((key: string, substitutions?: string | string[]) =>
      `${key}:${Array.isArray(substitutions) ? substitutions.join(",") : (substitutions ?? "")}`) as never,
  );
  const element = document.createElement("code");
  element.textContent = "loading";
  addClickToCopy(
    element,
    vi.fn(async () => undefined),
  );
  element.textContent = "extension-id";

  addClickToCopy(element);

  expect(element.getAttribute("aria-label")).toContain("extension-id");
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

  await import("../../../src/options/ui/click-to-copy.ts");
  document.querySelector<HTMLElement>(".click-to-copy")!.click();

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("automatic"));
});
