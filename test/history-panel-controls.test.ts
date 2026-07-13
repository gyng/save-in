// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const historyRuntime = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  sendMessage: vi.fn(),
  search: vi.fn(),
  show: vi.fn(),
}));

vi.mock("../src/platform/web-extension-api.ts", () => ({
  webExtensionApi: {
    runtime: historyRuntime,
    storage: { local: { get: vi.fn(), remove: vi.fn() } },
    downloads: { search: historyRuntime.search, show: historyRuntime.show },
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
    historyRuntime.sendMessage
      .mockReset()
      .mockImplementation(async (message: { type: string }) =>
        message.type === "HISTORY_GET"
          ? { type: "HISTORY_GET", body: { entries: historyRuntime.entries } }
          : message.type === "HISTORY_CANCEL"
            ? { type: "HISTORY_CANCEL", body: { canceled: true } }
            : { type: "OK" },
      );
    historyRuntime.search.mockReset().mockResolvedValue([]);
    historyRuntime.show.mockReset().mockResolvedValue(undefined);
    historyRuntime.entries = [];
    localStorage.clear();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:history-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    document.body.innerHTML = markup();
    await import("../src/options/history-panel.ts");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    expect(clear.disabled).toBe(false);
    clear.click();

    expect(search.value).toBe("");
    expect(type.value).toBe("");
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

  test("offers a retry when loading fails and clears the error after recovery", async () => {
    historyRuntime.entries = [{ id: "h-recovered", finalFullPath: "recovered.png" }];
    historyRuntime.sendMessage.mockRejectedValueOnce(new Error("worker unavailable"));
    const { renderHistory } = await import("../src/options/history-panel.ts");

    await renderHistory();

    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    expect(feedback.getAttribute("role")).toBe("alert");
    const retry = feedback.querySelector<HTMLButtonElement>("button")!;
    expect(retry).not.toBeNull();
    retry.click();

    await vi.waitFor(() =>
      expect(document.querySelector(".history-file")?.textContent).toBe("recovered.png"),
    );
    expect(feedback.hidden).toBe(true);
    expect(historyRuntime.sendMessage).toHaveBeenCalledTimes(2);
  });

  test("contains clear failures, restores the control, and retries on request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    historyRuntime.sendMessage.mockRejectedValueOnce(new Error("storage unavailable"));
    const clear = document.querySelector<HTMLButtonElement>("#history-clear")!;

    clear.click();

    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    await vi.waitFor(() => expect(feedback.getAttribute("role")).toBe("alert"));
    expect(clear.disabled).toBe(false);
    feedback.querySelector<HTMLButtonElement>("button")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({ type: "HISTORY_GET" }),
    );
    expect(
      historyRuntime.sendMessage.mock.calls.filter(([message]) => message.type === "HISTORY_CLEAR"),
    ).toHaveLength(2);
    expect(clear.disabled).toBe(false);
  });

  test("cancels a pending preparation before it has a browser download ID", async () => {
    historyRuntime.entries = [{ id: "h-large", status: "pending", finalFullPath: "large.iso" }];
    const { renderHistory } = await import("../src/options/history-panel.ts");
    await renderHistory();

    document.querySelector<HTMLButtonElement>(".history-cancel")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({
        type: "HISTORY_CANCEL",
        body: { historyId: "h-large" },
      }),
    );
  });

  test("restores cancellation when the background request fails", async () => {
    historyRuntime.entries = [{ id: "h-large", status: "pending", finalFullPath: "large.iso" }];
    const { renderHistory } = await import("../src/options/history-panel.ts");
    await renderHistory();
    historyRuntime.sendMessage.mockRejectedValueOnce(new Error("worker stopped"));
    const cancel = document.querySelector<HTMLButtonElement>(".history-cancel")!;

    cancel.click();

    await vi.waitFor(() => expect(cancel.disabled).toBe(false));
  });

  test("delegates show-in-folder and contains browser failures", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = await import("../src/options/history-panel.ts");
    await renderHistory();
    const open = document.querySelector<HTMLButtonElement>('[aria-label="Show in folder"]')!;

    open.click();
    await vi.waitFor(() => expect(historyRuntime.show).toHaveBeenCalledWith(42));
    expect(document.querySelector<HTMLElement>("#history-feedback")!.hidden).toBe(true);

    historyRuntime.show.mockRejectedValueOnce(new Error("download forgotten"));
    open.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.getAttribute("role")).toBe("alert"),
    );
  });

  test("persists column choices and never allows every column to be hidden", async () => {
    const checkboxes = [
      ...document.querySelectorAll<HTMLInputElement>("#history-column-options input"),
    ];
    const firstChecked = checkboxes.find((checkbox) => checkbox.checked)!;

    firstChecked.click();

    const stored = JSON.parse(localStorage.getItem("si-history-columns")!);
    expect(stored).not.toContain("index");

    localStorage.setItem("si-history-columns", JSON.stringify(["index"]));
    vi.resetModules();
    document.body.innerHTML = markup();
    await import("../src/options/history-panel.ts");
    const onlyVisible = document.querySelector<HTMLInputElement>("#history-column-options input")!;
    expect(onlyVisible.checked).toBe(true);

    onlyVisible.click();

    expect(onlyVisible.checked).toBe(true);
    expect(JSON.parse(localStorage.getItem("si-history-columns")!)).toEqual(["index"]);
  });

  test.each([
    ["json", "application/json"],
    ["csv", "text/csv"],
    ["tsv", "text/tab-separated-values"],
  ])("exports the current history as %s", async (format, contentType) => {
    historyRuntime.entries = [{ id: "h-export", finalFullPath: "folder/photo.png" }];
    const { renderHistory } = await import("../src/options/history-panel.ts");
    await renderHistory();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    document.querySelector<HTMLButtonElement>(`#history-export-${format}`)!.click();

    const createObjectURL = vi.mocked(URL.createObjectURL);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe(contentType);
    expect(click).toHaveBeenCalledOnce();
    const clickedLink = click.mock.instances[0] as HTMLAnchorElement;
    expect(clickedLink?.download).toBe(`save-in-history.${format}`);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:history-export");
  });

  test("polls native progress and stops tracking downloads the browser forgets", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    historyRuntime.search.mockResolvedValueOnce([
      { id: 7, state: "in_progress", bytesReceived: 50, totalBytes: 100 },
    ]);
    const { renderHistory } = await import("../src/options/history-panel.ts");

    await renderHistory();
    await vi.runAllTicks();
    const progress = document.querySelector<HTMLElement>(".history-progress")!;
    expect(progress.textContent).toBe("50%");
    expect(progress.getAttribute("data-download-id")).toBe("7");

    historyRuntime.search.mockResolvedValueOnce([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(progress.getAttribute("data-download-id")).toBeNull();
    const callsAfterRemoval = historyRuntime.search.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1000);
    expect(historyRuntime.search).toHaveBeenCalledTimes(callsAfterRemoval);
  });
});
