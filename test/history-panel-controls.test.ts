import { beforeEach, describe, expect, test, vi } from "vitest";

const historyRuntime = vi.hoisted(() => ({
  sendMessage: vi.fn(async (message: { type: string }) =>
    message.type === "HISTORY_GET" ? { body: { entries: [] } } : { type: "OK" },
  ),
}));

vi.mock("../src/platform/web-extension-api.ts", () => ({
  webExtensionApi: {
    runtime: historyRuntime,
    storage: { local: { get: vi.fn(), remove: vi.fn() } },
    downloads: {},
  },
}));

const markup = () => `
  <input id="history-filter">
  <span id="history-count"></span>
  <select id="history-source-filter"><option value="">All sources</option><option value="browser">Browser</option></select>
  <select id="history-status-filter"><option value="">All statuses</option><option value="failed">Failed</option></select>
  <select id="history-type-filter"><option value="">All types</option><option value="image">Image</option></select>
  <select id="history-date-preset">
    <option value="any">Any time</option><option value="today">Today</option>
    <option value="7-days">Last 7 days</option><option value="30-days">Last 30 days</option>
    <option value="custom">Custom date range</option>
  </select>
  <button id="history-clear-filters" class="history-clear-filters-inactive" disabled>Clear filters</button>
  <div id="history-custom-date-range" hidden>
    <input id="history-date-from" type="date"><input id="history-date-to" type="date">
    <span id="history-date-error" hidden></span>
  </div>
  <div id="history-active-filters"></div>
  <div id="history-feedback"></div><div id="history-list"></div>
  <div id="history-column-options"></div>
  <button id="history-export-json"></button><button id="history-export-csv"></button>
  <button id="history-export-tsv"></button><button id="history-clear"></button>`;

describe("history filter controls", () => {
  beforeEach(async () => {
    vi.resetModules();
    historyRuntime.sendMessage.mockClear();
    localStorage.clear();
    document.body.innerHTML = markup();
    await import("../src/options/history-panel.ts");
  });

  test("reveals custom dates and reports an invalid reversed range", () => {
    const preset = document.querySelector<HTMLSelectElement>("#history-date-preset")!;
    preset.value = "custom";
    preset.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLElement>("#history-custom-date-range")!.hidden).toBe(false);

    const from = document.querySelector<HTMLInputElement>("#history-date-from")!;
    const to = document.querySelector<HTMLInputElement>("#history-date-to")!;
    from.value = "2024-07-12";
    from.dispatchEvent(new Event("change"));
    to.value = "2024-07-01";
    to.dispatchEvent(new Event("change"));

    expect(from.validationMessage).toContain("before end date");
    expect(document.querySelector<HTMLElement>("#history-date-error")!.hidden).toBe(false);
  });

  test("shows preset boundaries and switches to Custom when either date is edited", () => {
    const preset = document.querySelector<HTMLSelectElement>("#history-date-preset")!;
    preset.value = "7-days";
    preset.dispatchEvent(new Event("change"));

    expect(document.querySelector<HTMLElement>("#history-custom-date-range")!.hidden).toBe(false);
    const from = document.querySelector<HTMLInputElement>("#history-date-from")!;
    const to = document.querySelector<HTMLInputElement>("#history-date-to")!;
    expect(from.value).not.toBe("");
    expect(to.value).not.toBe("");

    from.value = "2024-07-01";
    from.dispatchEvent(new Event("change"));
    expect(preset.value).toBe("custom");
  });

  test("switches the preset to custom when a date is edited", () => {
    const preset = document.querySelector<HTMLSelectElement>("#history-date-preset")!;
    preset.value = "7-days";
    preset.dispatchEvent(new Event("change"));

    const from = document.querySelector<HTMLInputElement>("#history-date-from")!;
    from.value = "2024-07-01";
    from.dispatchEvent(new Event("change"));

    expect(preset.value).toBe("custom");
    expect(document.querySelector<HTMLElement>("#history-custom-date-range")!.hidden).toBe(false);
  });

  test("summarizes active filters and clears every control", () => {
    const search = document.querySelector<HTMLInputElement>("#history-filter")!;
    search.value = "photo";
    search.dispatchEvent(new Event("input"));
    const type = document.querySelector<HTMLSelectElement>("#history-type-filter")!;
    type.value = "image";
    type.dispatchEvent(new Event("change"));

    expect(document.querySelector("#history-active-filters")!.textContent).toContain("photo");
    expect(document.querySelector("#history-active-filters")!.textContent).toContain("Image");
    const clear = document.querySelector<HTMLButtonElement>("#history-clear-filters")!;
    expect(clear.classList).not.toContain("history-clear-filters-inactive");
    expect(clear.disabled).toBe(false);
    clear.click();

    expect(search.value).toBe("");
    expect(type.value).toBe("");
    expect(clear.classList).toContain("history-clear-filters-inactive");
    expect(clear.disabled).toBe(true);
    expect(document.querySelector("#history-active-filters")!.textContent).toBe("");
    expect(document.querySelector("#history-count")!.textContent).toBe("0 results");
  });

  test("keeps table headers and an empty-state row when history has no entries", async () => {
    const { renderHistory } = await import("../src/options/history-panel.ts");
    await renderHistory();
    await vi.waitFor(() => expect(document.querySelector("#history-list table")).not.toBeNull());

    expect(document.querySelectorAll("#history-list th").length).toBeGreaterThan(0);
    expect(document.querySelector("#history-list .history-empty-row")?.textContent).toContain(
      "No downloads saved yet",
    );
    expect(historyRuntime.sendMessage).toHaveBeenCalledWith({ type: "HISTORY_GET" });
  });

  test("clears history through the serialized background owner", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({ type: "HISTORY_CLEAR" }),
    );
  });
});
