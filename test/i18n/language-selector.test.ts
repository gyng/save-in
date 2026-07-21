// @vitest-environment jsdom
import {
  afterNativePopupClose,
  setupLanguageSelector,
} from "../../src/options/core/language-selector.ts";

const render = () => {
  document.body.innerHTML = `
    <div class="language-selector">
      <select id="uiLocale"><option value="">Default language</option><option value="fr">Français (AI)</option></select>
    </div>
    <span id="language-error" hidden></span>`;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("waits for a rendering turn when the options page remains visible", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });

  await afterNativePopupClose();

  expect(vi.getTimerCount()).toBe(0);
});

test("continues immediately once the options page is hidden", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const requestFrame = vi.spyOn(globalThis, "requestAnimationFrame");

  await afterNativePopupClose();

  expect(requestFrame).not.toHaveBeenCalled();
});

test("uses a bounded fallback if a visible page suspends animation frames", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let frameCallback: FrameRequestCallback | undefined;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frameCallback = callback;
    return 1;
  });

  const closed = afterNativePopupClose();
  await vi.advanceTimersByTimeAsync(100);
  await closed;

  frameCallback?.(0);
  expect(vi.getTimerCount()).toBe(0);
});

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

test("restores a selector without its optional layout container", async () => {
  document.body.innerHTML =
    '<select id="uiLocale"><option value="fr">Français</option></select><span id="language-error" hidden></span>';
  setupLanguageSelector({
    apply: vi.fn(() => Promise.reject(new Error("failed"))),
    reload: vi.fn(),
    getMessage: vi.fn(),
  });

  const select = document.querySelector<HTMLSelectElement>("#uiLocale")!;
  select.dispatchEvent(new Event("input"));

  await vi.waitFor(() => expect(select.isConnected).toBe(true));
  expect(select.disabled).toBe(false);
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
