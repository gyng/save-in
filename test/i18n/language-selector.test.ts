// @vitest-environment jsdom
import { setupLanguageSelector } from "../../src/options/language-selector.ts";

const render = () => {
  document.body.innerHTML = `
    <div class="language-selector">
      <select id="uiLocale"><option value="">Default language</option><option value="fr">Français (AI)</option></select>
    </div>
    <span id="language-error" hidden></span>`;
};

test("saves the selected locale and reloads after acknowledgement", async () => {
  render();
  const apply = vi.fn(async () => ({
    type: "APPLY_CONFIG_RESULT",
    body: { version: 1, applied: { uiLocale: "fr" }, rejected: [] },
  }));
  const reload = vi.fn();
  let finishClose!: () => void;
  const afterClose = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
  );
  setupLanguageSelector({ apply, reload, getMessage: vi.fn(), afterClose });

  const select = document.querySelector<HTMLSelectElement>("#uiLocale")!;
  vi.spyOn(select, "getBoundingClientRect").mockReturnValue({ width: 180, height: 30 } as DOMRect);
  select.value = "fr";
  select.dispatchEvent(new Event("input"));
  expect(select.disabled).toBe(true);
  expect(select.isConnected).toBe(false);
  expect(document.querySelector<HTMLElement>(".language-selector")!.style.width).toBe("180px");
  expect(document.querySelector<HTMLElement>(".language-selector")!.style.height).toBe("30px");
  expect(apply).not.toHaveBeenCalled();
  finishClose();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

  expect(apply).toHaveBeenCalledWith("fr");
  expect(select.isConnected).toBe(false);
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
  vi.spyOn(select, "getBoundingClientRect").mockReturnValue({ width: 180, height: 30 } as DOMRect);
  select.dispatchEvent(new Event("input"));
  const error = document.querySelector<HTMLElement>("#language-error")!;
  await vi.waitFor(() => expect(error.hidden).toBe(false));

  expect(select.disabled).toBe(false);
  expect(select.isConnected).toBe(true);
  expect(document.querySelector<HTMLElement>(".language-selector")!.style.width).toBe("");
  expect(document.querySelector<HTMLElement>(".language-selector")!.style.height).toBe("");
  expect(document.activeElement).toBe(select);
  expect(error.textContent).toBe("Language change failed");
});

test("does nothing without both selector controls", () => {
  document.body.innerHTML = '<select id="uiLocale"></select>';
  expect(() =>
    setupLanguageSelector({ apply: vi.fn(), reload: vi.fn(), getMessage: vi.fn() }),
  ).not.toThrow();
});

test("uses fallback error copy when localization is unavailable", async () => {
  render();
  setupLanguageSelector({
    apply: vi.fn(() => Promise.reject(new Error("failed"))),
    reload: vi.fn(),
    getMessage: () => "",
  });

  document.querySelector<HTMLSelectElement>("#uiLocale")!.dispatchEvent(new Event("input"));

  await vi.waitFor(() =>
    expect(document.querySelector("#language-error")?.textContent).toBe(
      "Could not change the language. Try again.",
    ),
  );
});

test("default ports save through the runtime and surface a rejected acknowledgement", async () => {
  render();
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    type: "APPLY_CONFIG_RESULT",
    body: {
      version: 1,
      applied: {},
      rejected: [{ name: "uiLocale", reason: "unsupported" }],
    },
  });
  setupLanguageSelector();
  const select = document.querySelector<HTMLSelectElement>("#uiLocale")!;
  select.value = "fr";

  select.dispatchEvent(new Event("input"));

  await vi.waitFor(() =>
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "APPLY_CONFIG",
      body: { config: { uiLocale: "fr" } },
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>("#language-error")!.hidden).toBe(false),
  );
});
