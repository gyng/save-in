// Cases imported by panel.test.ts to share one jsdom environment.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const historyRuntime = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  sendMessage: vi.fn(),
  search: vi.fn(),
  show: vi.fn(),
}));

vi.mock("../../../src/platform/web-extension-api.ts", () => ({
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
    <input id="history-date-from" type="date" aria-describedby="history-date-error">
    <input id="history-date-to" type="date" aria-describedby="history-date-error">
    <span id="history-date-error" hidden></span>
  </div>
  <div id="history-active-filters"></div>
  <div id="history-feedback"></div><div id="history-list"></div>
  <div id="history-column-options"></div>
  <button id="history-export-json"></button><button id="history-export-csv"></button>
  <button id="history-export-tsv"></button><button id="history-clear"></button>`;

let historyPanel: typeof import("../../../src/options/history-panel.ts");

describe("history filter controls", () => {
  beforeAll(async () => {
    historyPanel = await import("../../../src/options/history-panel.ts");
  });

  beforeEach(() => {
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
    historyPanel.setHistoryLocalizer(() => "");
    historyPanel.setupHistoryPanel();
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
    const error = document.querySelector<HTMLElement>("#history-date-error")!;
    expect(error.hidden).toBe(false);
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(to.getAttribute("aria-invalid")).toBe("true");
    expect(from.getAttribute("aria-describedby")).toContain("history-date-error");

    to.value = "2024-07-20";
    to.dispatchEvent(new Event("change"));
    expect(error.hidden).toBe(true);
    expect(from.hasAttribute("aria-invalid")).toBe(false);
    expect(to.hasAttribute("aria-invalid")).toBe(false);
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

  test("summarizes every facet and partial custom date range", () => {
    const source = document.querySelector<HTMLSelectElement>("#history-source-filter")!;
    const status = document.querySelector<HTMLSelectElement>("#history-status-filter")!;
    const preset = document.querySelector<HTMLSelectElement>("#history-date-preset")!;
    const from = document.querySelector<HTMLInputElement>("#history-date-from")!;
    const to = document.querySelector<HTMLInputElement>("#history-date-to")!;
    source.value = "browser";
    source.dispatchEvent(new Event("change"));
    status.value = "failed";
    status.dispatchEvent(new Event("change"));
    preset.value = "custom";
    preset.dispatchEvent(new Event("change"));
    expect(document.querySelector("#history-active-filters")?.textContent).toContain(
      "Custom date range",
    );

    from.value = "2024-07-01";
    from.dispatchEvent(new Event("change"));
    expect(document.querySelector("#history-active-filters")?.textContent).toContain(
      "Since 2024-07-01",
    );
    from.value = "";
    from.dispatchEvent(new Event("change"));
    to.value = "2024-07-12";
    to.dispatchEvent(new Event("change"));

    const summary = document.querySelector("#history-active-filters")?.textContent;
    expect(summary).toContain("Browser");
    expect(summary).toContain("Failed");
    expect(summary).toContain("Through 2024-07-12");
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
  });

  test("keeps table headers and an empty-state row when history has no entries", async () => {
    const { renderHistory } = historyPanel;
    await renderHistory();
    await vi.waitFor(() => expect(document.querySelector("#history-list table")).not.toBeNull());

    expect(document.querySelectorAll("#history-list th").length).toBeGreaterThan(0);
    expect(document.querySelector("#history-list .history-empty-row")).not.toBeNull();
    expect(historyRuntime.sendMessage).toHaveBeenCalledWith({ type: "HISTORY_GET" });
  });

  test("reports an empty filtered result and toggles sortable headings", async () => {
    historyRuntime.entries = [
      {
        id: "h-one",
        initiatedAt: "2024-07-01T00:00:00.000Z",
        finalFullPath: "photo.png",
      },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();
    const time = document.querySelector<HTMLTableCellElement>(".history-time-heading")!;
    time.click();
    expect(time.isConnected).toBe(false);
    document.querySelector<HTMLTableCellElement>(".history-time-heading")!.click();
    const status = document.querySelector<HTMLTableCellElement>(".history-status-heading")!;
    status.click();
    document.querySelector<HTMLTableCellElement>(".history-status-heading")!.click();
    document.querySelector<HTMLTableCellElement>(".history-time-heading")!.click();

    const search = document.querySelector<HTMLInputElement>("#history-filter")!;
    search.value = "missing";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("#history-count")?.textContent).toBe("0 of 1 results");
    expect(document.querySelector(".history-empty-row")?.textContent).toContain(
      "No history matches",
    );
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
    const { renderHistory } = historyPanel;

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
    const { renderHistory } = historyPanel;
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
    const { renderHistory } = historyPanel;
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
    const { renderHistory } = historyPanel;
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

  test("explains when show-in-folder is unavailable", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = historyPanel;
    const { webExtensionApi } = await import("../../../src/platform/web-extension-api.ts");
    const downloads = webExtensionApi.downloads!;
    const show = downloads.show;
    Reflect.deleteProperty(downloads, "show");
    await renderHistory();

    document.querySelector<HTMLButtonElement>('[aria-label="Show in folder"]')!.click();

    expect(document.querySelector("#history-feedback")?.textContent).toContain(
      "browser no longer knows",
    );
    downloads.show = show;
  });

  test("persists column choices and never allows every column to be hidden", async () => {
    const checkboxes = [
      ...document.querySelectorAll<HTMLInputElement>("#history-column-options input"),
    ];
    expect(checkboxes.every((checkbox) => checkbox.name === "history-column")).toBe(true);
    expect(checkboxes.every((checkbox) => checkbox.value.length > 0)).toBe(true);
    const firstChecked = checkboxes.find((checkbox) => checkbox.checked)!;

    firstChecked.click();

    const stored = JSON.parse(localStorage.getItem("si-history-columns")!);
    expect(stored).not.toContain("index");

    localStorage.setItem("si-history-columns", JSON.stringify(["index"]));
    document.body.innerHTML = markup();
    historyPanel.setupHistoryPanel();
    const onlyVisible = document.querySelector<HTMLInputElement>("#history-column-options input")!;
    expect(onlyVisible.checked).toBe(true);

    onlyVisible.click();

    expect(onlyVisible.checked).toBe(true);
    expect(JSON.parse(localStorage.getItem("si-history-columns")!)).toEqual(["index"]);

    const hidden = [
      ...document.querySelectorAll<HTMLInputElement>("#history-column-options input"),
    ].find((checkbox) => !checkbox.checked)!;
    hidden.click();
    expect(hidden.checked).toBe(true);
  });

  test("renders and localizes every optional history column", async () => {
    const allColumns = [
      "index",
      "time",
      "source",
      "mechanism",
      "status",
      "size",
      "type",
      "routed",
      "file",
      "folder",
      "url",
      "fullPath",
      "downloadId",
      "menuItem",
      "variables",
    ];
    localStorage.setItem("si-history-columns", JSON.stringify(allColumns));
    document.body.innerHTML = markup();
    historyPanel.setupHistoryPanel();
    historyRuntime.entries = [
      {
        id: "h-full",
        status: "complete",
        initiatedAt: "2024-07-01T00:00:00.000Z",
        finalFullPath: "folder/photo.png",
        fileSize: 1234,
        downloadId: 42,
        routed: true,
        mechanism: "fetch-downloads-api",
        info: { context: "media", sourceUrl: "https://example.test/photo.png" },
        menu: { title: "Images" },
        variables: { year: "2024", empty: "" },
      },
      { id: "h-null", finalFullPath: "plain.txt" },
    ];
    const { renderHistory, setHistoryLocalizer } = historyPanel;
    setHistoryLocalizer((key) => (key === "historyColumnSource" ? "Localized source" : ""));
    await renderHistory();

    expect(document.querySelector(".history-source-heading")?.textContent).toBe("Localized source");
    expect(document.querySelector(".history-size")?.textContent).toBe("1.2 KB");
    expect(document.querySelector(".routed-chip")).not.toBeNull();
    expect(document.querySelector<HTMLAnchorElement>(".history-url a")?.href).toBe(
      "https://example.test/photo.png",
    );
    expect(document.querySelector(".history-full-path")?.textContent).toBe("folder/photo.png");
    expect(document.querySelector(".history-download-id")?.textContent).toBe("42");
    expect(document.querySelectorAll(".history-download-id")[1]?.textContent).toBe("");
    expect(document.querySelector(".history-menu-item")?.textContent).toBe("Images");
    expect(document.querySelector(".history-variable-list")?.textContent).toContain(":year:2024");

    const sourceOption = [
      ...document.querySelectorAll<HTMLInputElement>("#history-column-options input"),
    ].find((checkbox) => !checkbox.checked);
    sourceOption?.click();
  });

  test("uses a stored single-column view and pages through large history", async () => {
    localStorage.setItem("si-history-columns", JSON.stringify(["index"]));
    document.body.innerHTML = markup();
    historyPanel.setupHistoryPanel();
    historyRuntime.entries = Array.from({ length: 51 }, (_, index) => ({
      id: `h-${index}`,
      finalFullPath: `${index}.txt`,
    }));
    const { renderHistory } = historyPanel;
    await renderHistory();
    expect(document.querySelectorAll("#history-list td[data-column]")).toHaveLength(50);

    const older = [...document.querySelectorAll<HTMLButtonElement>(".history-pager button")].find(
      (button) => button.textContent?.includes("Older"),
    )!;
    older.click();
    expect(document.querySelector(".history-pager-label")?.textContent).toBe("Page 2 of 2");
    const newer = [...document.querySelectorAll<HTMLButtonElement>(".history-pager button")].find(
      (button) => button.textContent?.includes("Newer"),
    )!;
    newer.click();
    expect(document.querySelector(".history-pager-label")?.textContent).toBe("Page 1 of 2");
  });

  test("renders without the index column or column option controls", async () => {
    localStorage.setItem("si-history-columns", JSON.stringify(["file"]));
    document.body.innerHTML = '<div id="history-list"></div><input id="history-date-from">';
    historyPanel.setupHistoryPanel();
    historyRuntime.entries = [{ id: "h-file", finalFullPath: "only.txt" }];
    const { renderHistory } = historyPanel;
    await renderHistory();

    expect(document.querySelector(".history-index")).toBeNull();
    expect(document.querySelector(".history-file")?.textContent).toBe("only.txt");
  });

  test.each([
    ["json", "application/json"],
    ["csv", "text/csv"],
    ["tsv", "text/tab-separated-values"],
  ])("exports the current history as %s", async (format, contentType) => {
    historyRuntime.entries = [{ id: "h-export", finalFullPath: "folder/photo.png" }];
    const { renderHistory } = historyPanel;
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
    const { renderHistory } = historyPanel;

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

  test("re-renders finished progress and contains polling failures", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    historyRuntime.search.mockResolvedValueOnce([
      { id: null, state: "in_progress" },
      { id: 7, state: "complete", bytesReceived: 100, totalBytes: 100 },
    ]);
    const { renderHistory } = historyPanel;
    await renderHistory();
    await vi.runAllTicks();
    expect(document.querySelector(".history-progress")).not.toBeNull();

    historyRuntime.search.mockRejectedValueOnce(new Error("downloads unavailable"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(historyRuntime.search).toHaveBeenCalledTimes(2);
  });

  test("contains an immediately rejected progress poll", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    historyRuntime.search.mockRejectedValueOnce(new Error("downloads unavailable"));
    const { renderHistory } = historyPanel;
    await renderHistory();
    await vi.runAllTicks();

    expect(historyRuntime.search).toHaveBeenCalledOnce();
  });

  test("stops progress polling when downloads search is unavailable", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    const { renderHistory } = historyPanel;
    const { webExtensionApi } = await import("../../../src/platform/web-extension-api.ts");
    const downloads = webExtensionApi.downloads!;
    const search = downloads.search;
    Reflect.deleteProperty(downloads, "search");
    await renderHistory();
    await vi.runAllTicks();

    expect(historyRuntime.search).not.toHaveBeenCalled();
    downloads.search = search;
  });

  test("contains invalid history responses", async () => {
    historyRuntime.sendMessage.mockResolvedValueOnce({ type: "HISTORY_GET", body: {} });
    const { renderHistory } = historyPanel;

    await renderHistory();

    expect(document.querySelector("#history-feedback")?.getAttribute("role")).toBe("alert");
  });

  test("discards malformed history elements without losing valid entries", async () => {
    historyRuntime.sendMessage.mockResolvedValueOnce({
      type: "HISTORY_GET",
      body: {
        entries: [
          null,
          { id: 7, finalFullPath: "wrong-id.txt" },
          {
            id: "valid",
            initiatedAt: "2026-07-15T00:00:00.000Z",
            finalFullPath: "safe.txt",
          },
        ],
      },
    });
    const { renderHistory } = historyPanel;

    await renderHistory();

    expect([...document.querySelectorAll(".history-file")].map((cell) => cell.textContent)).toEqual(
      ["safe.txt"],
    );
    expect(document.querySelector("#history-feedback")?.getAttribute("role")).not.toBe("alert");
  });

  test("imports safely without history markup or valid stored preferences", async () => {
    localStorage.setItem("si-history-columns", "not json");
    document.body.innerHTML = "";
    historyPanel.setupHistoryPanel();
    const { renderHistory } = historyPanel;
    await expect(renderHistory()).resolves.toBeUndefined();
  });

  test("ignores a stored column list with no recognized columns", async () => {
    localStorage.setItem("si-history-columns", JSON.stringify(["unknown"]));
    document.body.innerHTML = markup();
    historyPanel.setupHistoryPanel();

    expect(
      [...document.querySelectorAll<HTMLInputElement>("#history-column-options input")].filter(
        (checkbox) => checkbox.checked,
      ).length,
    ).toBeGreaterThan(1);
  });

  test("tolerates filter controls removed after their listeners were bound", async () => {
    const source = document.querySelector<HTMLSelectElement>("#history-source-filter")!;
    source.value = "browser";
    source.dispatchEvent(new Event("change"));
    source.remove();
    document.querySelector("#history-status-filter")?.remove();
    document.querySelector("#history-type-filter")?.remove();
    document.querySelector("#history-date-to")?.remove();
    document.querySelector("#history-clear-filters")?.remove();
    document.querySelector("#history-active-filters")?.remove();
    document.querySelector("#history-custom-date-range")?.remove();
    document.querySelector("#history-date-error")?.remove();
    document.querySelector("#history-count")?.remove();
    const { renderHistory } = historyPanel;

    await expect(renderHistory()).resolves.toBeUndefined();
  });

  test("tolerates dependent date and clear controls being removed", () => {
    const preset = document.querySelector<HTMLSelectElement>("#history-date-preset")!;
    const from = document.querySelector<HTMLInputElement>("#history-date-from")!;
    from.remove();
    document.querySelector("#history-date-to")?.remove();
    preset.value = "7-days";
    preset.dispatchEvent(new Event("change"));
    preset.remove();
    from.value = "2024-07-01";
    from.dispatchEvent(new Event("change"));

    document.querySelector("#history-type-filter")?.remove();
    document.querySelector<HTMLButtonElement>("#history-clear-filters")!.click();
    expect(document.querySelector("#history-active-filters")?.textContent).toBe("");
  });

  test("does not clear history when confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    expect(historyRuntime.sendMessage).not.toHaveBeenCalledWith({ type: "HISTORY_CLEAR" });
  });

  test("treats a non-OK clear response as a failure", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    historyRuntime.sendMessage.mockResolvedValueOnce({ type: "HISTORY_CLEAR", body: {} });
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain(
        "Could not clear history",
      ),
    );
  });

  test("retries clearing after the clear button is removed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    historyRuntime.sendMessage.mockRejectedValue(new Error("storage unavailable"));
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback button")).not.toBeNull(),
    );
    document.querySelector("#history-clear")?.remove();

    document.querySelector<HTMLButtonElement>("#history-feedback button")!.click();

    await vi.waitFor(() =>
      expect(
        historyRuntime.sendMessage.mock.calls.filter(
          ([message]) => message.type === "HISTORY_CLEAR",
        ),
      ).toHaveLength(2),
    );
  });
});
