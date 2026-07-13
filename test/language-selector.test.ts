// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { setupLanguageSelector } from "../src/options/language-selector.ts";

const render = () => {
  document.body.innerHTML = `
    <select id="uiLocale"><option value="">Default</option><option value="fr">Français (AI)</option></select>
    <span id="language-error" hidden></span>`;
};

test("uses a concise label for the browser-controlled locale", () => {
  const catalog = JSON.parse(readFileSync("_locales/en/messages.json", "utf8")) as Record<
    string,
    { message?: string }
  >;
  expect(catalog.o_lBrowserDefault?.message).toBe("Default");
});

test("saves the selected locale and reloads after acknowledgement", async () => {
  render();
  const apply = vi.fn(async () => ({
    type: "APPLY_CONFIG_RESULT",
    body: { applied: { uiLocale: "fr" }, rejected: [] },
  }));
  const reload = vi.fn();
  setupLanguageSelector({ apply, reload, getMessage: vi.fn() });

  const select = document.querySelector<HTMLSelectElement>("#uiLocale")!;
  select.value = "fr";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

  expect(apply).toHaveBeenCalledWith("fr");
});

test("keeps the page usable and reports a rejected locale change", async () => {
  render();
  setupLanguageSelector({
    apply: vi.fn(async () => {
      throw new Error("save failed");
    }),
    reload: vi.fn(),
    getMessage: () => "Language change failed",
  });

  const select = document.querySelector<HTMLSelectElement>("#uiLocale")!;
  select.dispatchEvent(new Event("change"));
  const error = document.querySelector<HTMLElement>("#language-error")!;
  await vi.waitFor(() => expect(error.hidden).toBe(false));

  expect(select.disabled).toBe(false);
  expect(error.textContent).toBe("Language change failed");
});
