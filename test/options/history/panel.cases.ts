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
  <div id="history-active-filters" hidden></div>
  <div id="history-feedback"></div><div id="history-list"></div>
  <textarea id="paths"></textarea>
  <div id="history-column-options"></div>
  <details class="history-export-menu" data-history-requires-entries>
    <summary>Export</summary>
    <button id="history-export-json"></button><button id="history-export-csv"></button>
    <button id="history-export-tsv"></button>
  </details>
  <button id="history-clear" data-history-requires-entries></button>`;

const confirmHistoryClear = () => {
  document.querySelector<HTMLButtonElement>(".history-clear-dialog .danger-button")!.click();
};

let historyPanel: typeof import("../../../src/options/history/history-panel.ts");

describe("history filter controls", () => {
  beforeAll(async () => {
    historyPanel = await import("../../../src/options/history/history-panel.ts");
  });

  beforeEach(() => {
    historyRuntime.sendMessage
      .mockReset()
      .mockImplementation(async (message: { type: string }) =>
        message.type === "HISTORY_GET"
          ? { type: "HISTORY_GET", body: { entries: historyRuntime.entries } }
          : message.type === "HISTORY_CANCEL"
            ? { type: "HISTORY_CANCEL", body: { canceled: true } }
            : message.type === "HISTORY_UNDO"
              ? { type: "HISTORY_UNDO", body: { undone: true, fileMissing: false } }
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

    expect(from.validationMessage).toContain("on or before the end date");
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
    expect(clear.hidden).toBe(false);
    clear.click();

    expect(search.value).toBe("");
    expect(type.value).toBe("");
    expect(clear.disabled).toBe(true);
    expect(clear.hidden).toBe(true);
    expect(document.querySelector("#history-active-filters")!.textContent).toBe("");
    expect(document.querySelector<HTMLElement>("#history-active-filters")!.hidden).toBe(true);
  });

  test("keeps table headers and an empty-state row when history has no entries", async () => {
    const { renderHistory } = historyPanel;
    await renderHistory();
    await vi.waitFor(() => expect(document.querySelector("#history-list table")).not.toBeNull());

    expect(document.querySelectorAll("#history-list th").length).toBeGreaterThan(0);
    expect(document.querySelector("#history-list .history-empty-row")).not.toBeNull();
    expect(document.querySelector("#history-list .history-pager")).toBeNull();
    expect(document.querySelector("#history-list .history-empty-title")?.textContent).toContain(
      "No downloads saved yet",
    );
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-history-requires-entries]")].every(
        (control) =>
          (control instanceof HTMLButtonElement ? control.disabled : control.inert) &&
          control.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
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
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-history-requires-entries]")].every(
        (control) =>
          (control instanceof HTMLButtonElement ? !control.disabled : !control.inert) &&
          !control.hasAttribute("aria-disabled"),
      ),
    ).toBe(true);
    const time = document.querySelector<HTMLTableCellElement>(".history-time-heading")!;
    expect(time.getAttribute("aria-sort")).toBe("descending");
    time.querySelector<HTMLButtonElement>("button")!.click();
    expect(time.isConnected).toBe(false);
    document
      .querySelector<HTMLTableCellElement>(".history-time-heading")!
      .querySelector<HTMLButtonElement>("button")!
      .click();
    const status = document.querySelector<HTMLTableCellElement>(".history-status-heading")!;
    status.querySelector<HTMLButtonElement>("button")!.click();
    document
      .querySelector<HTMLTableCellElement>(".history-status-heading")!
      .querySelector<HTMLButtonElement>("button")!
      .click();
    document
      .querySelector<HTMLTableCellElement>(".history-time-heading")!
      .querySelector<HTMLButtonElement>("button")!
      .click();

    const search = document.querySelector<HTMLInputElement>("#history-filter")!;
    search.value = "missing";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector("#history-count")?.textContent).toBe("0 of 1 results");
    expect(document.querySelector(".history-empty-row")?.textContent).toContain(
      "No history matches",
    );
  });

  test("clears history through the serialized background owner", async () => {
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "HISTORY_CLEAR") {
        historyRuntime.entries = [];
        return { type: "OK" };
      }
      return { type: "HISTORY_GET", body: { entries: historyRuntime.entries } };
    });
    await historyPanel.renderHistory();
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    expect(document.querySelector(".history-clear-dialog")).not.toBeNull();
    confirmHistoryClear();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({ type: "HISTORY_CLEAR" }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("#history-clear")!.disabled).toBe(true),
    );
    expect(document.querySelector(".history-export-menu")?.getAttribute("aria-disabled")).toBe(
      "true",
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
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    await historyPanel.renderHistory();
    historyRuntime.sendMessage.mockRejectedValueOnce(new Error("storage unavailable"));
    const clear = document.querySelector<HTMLButtonElement>("#history-clear")!;

    clear.click();
    confirmHistoryClear();

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
    await vi.waitFor(() => expect(clear.disabled).toBe(false));
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

  test("undo row action delegates to the background and reports the outcome", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();

    document.querySelector<HTMLButtonElement>(".history-undo")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({
        type: "HISTORY_UNDO",
        body: { historyId: "h-complete" },
      }),
    );
    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    await vi.waitFor(() => expect(feedback.hidden).toBe(false));
    expect(feedback.classList.contains("feedback-error")).toBe(false);
    expect(feedback.textContent).toContain("Save undone");
  });

  test("offers the same undo row action for an automatic save", async () => {
    historyRuntime.entries = [
      {
        id: "h-auto",
        status: "complete",
        downloadId: 43,
        finalFullPath: "automatic.png",
        info: { context: "auto" },
      },
    ];
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-undo")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({
        type: "HISTORY_UNDO",
        body: { historyId: "h-auto" },
      }),
    );
  });

  test("loads one History row into the Route debugger without another background read", async () => {
    historyRuntime.entries = [
      {
        id: "h-debug",
        status: "complete",
        finalFullPath: "saved/photo.jpg",
        info: {
          sourceUrl: "https://cdn.test/photo.jpg",
          pageUrl: "https://page.test/gallery",
          context: "LINK",
        },
        variables: { filename: "photo.jpg", pagetitle: "Gallery", linktext: "Photo" },
      },
    ];
    const replay = vi.fn();
    document.addEventListener("save-in:debug-history", replay, { once: true });
    await historyPanel.renderHistory();
    const readsBefore = historyRuntime.sendMessage.mock.calls.filter(
      ([message]) => message.type === "HISTORY_GET",
    ).length;

    const debug = document.querySelector<HTMLButtonElement>(".history-debug")!;
    expect(debug.title).toBe("Debug this save");
    expect(debug.getAttribute("aria-label")).toBe("Debug save of photo.jpg");
    debug.click();

    expect(replay).toHaveBeenCalledOnce();
    const replayEvent = replay.mock.calls[0]?.[0];
    if (!(replayEvent instanceof CustomEvent)) throw new Error("missing History replay event");
    expect(replayEvent.detail).toEqual({
      state: {
        info: {
          filename: "photo.jpg",
          sourceUrl: "https://cdn.test/photo.jpg",
          pageUrl: "https://page.test/gallery",
          context: "LINK",
          linkText: "Photo",
          currentTab: { title: "Gallery", url: "https://page.test/gallery" },
        },
      },
    });
    expect(
      historyRuntime.sendMessage.mock.calls.filter(([message]) => message.type === "HISTORY_GET"),
    ).toHaveLength(readsBefore);

    const { debugHistorySave } = await import("../../../src/options/history/history-actions.ts");
    debugHistorySave("missing-history-id");
    expect(replay).toHaveBeenCalledOnce();

    const { buildHistoryStatusCell } =
      await import("../../../src/options/history/history-row-actions.ts");
    const { historyRow } = await import("../../../src/options/history/history-model.ts");
    expect(buildHistoryStatusCell(historyRow({})).querySelector(".history-debug")).toBeNull();
  });

  test("reroutes a completed save to a configured destination", async () => {
    historyRuntime.entries = [
      {
        id: "h-move",
        status: "complete",
        downloadId: 44,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    document.querySelector<HTMLTextAreaElement>("#paths")!.value =
      "Pictures // (alias: Images)\n> Pictures/Archive\nPictures // duplicate destination";
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "HISTORY_REROUTE") {
        return {
          type: "HISTORY_REROUTE",
          body: { rerouted: true, oldRemoved: true, newHistoryId: "h-new" },
        };
      }
      return { type: "HISTORY_GET", body: { entries: historyRuntime.entries } };
    });
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-move")!.click();
    const picker = document.querySelector<HTMLElement>(".history-move-picker")!;
    const select = picker.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map(({ value, text }) => [value, text])).toEqual([
      [".", "Downloads"],
      ["Pictures", "Images"],
      ["Pictures/Archive", "Pictures/Archive"],
    ]);
    select.value = "Pictures/Archive";
    picker.querySelector<HTMLButtonElement>(".history-move-confirm")!.click();

    await vi.waitFor(() =>
      expect(historyRuntime.sendMessage).toHaveBeenCalledWith({
        type: "HISTORY_REROUTE",
        body: { historyId: "h-move", destination: "Pictures/Archive" },
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain("Save moved"),
    );
  });

  test("dismisses an open move destination picker", async () => {
    historyRuntime.entries = [
      {
        id: "h-picker",
        status: "complete",
        downloadId: 45,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    await historyPanel.renderHistory();
    const move = document.querySelector<HTMLButtonElement>(".history-move")!;

    move.click();
    expect(document.querySelector(".history-move-picker")).not.toBeNull();
    move.click();
    expect(document.querySelector(".history-move-picker")).toBeNull();
  });

  test("hides Move for an abbreviated automatic data URL", async () => {
    historyRuntime.entries = [
      {
        id: "h-auto-data",
        status: "complete",
        downloadId: 49,
        finalFullPath: "from/generated.png",
        url: "data:image/png;base64,AAAA…",
        info: { context: "AUTO" },
      },
    ];

    await historyPanel.renderHistory();

    expect(document.querySelector(".history-move")).toBeNull();
    expect(document.querySelector(".history-undo")).not.toBeNull();
  });

  test.each([
    { type: "OK", body: {} },
    { type: "HISTORY_REROUTE", body: {} },
    { type: "HISTORY_REROUTE", body: { rerouted: false, oldRemoved: false } },
  ])("reports a refused move response %#", async (refusal) => {
    historyRuntime.entries = [
      {
        id: "h-refused",
        status: "complete",
        downloadId: 46,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    document.querySelector("#paths")?.remove();
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === "HISTORY_GET"
        ? { type: "HISTORY_GET", body: { entries: historyRuntime.entries } }
        : refusal,
    );
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-move")!.click();
    const picker = document.querySelector<HTMLElement>(".history-move-picker")!;
    expect([...picker.querySelectorAll("option")].map((option) => option.value)).toEqual(["."]);
    picker.querySelector<HTMLButtonElement>(".history-move-confirm")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain("Could not move"),
    );
  });

  test("reports a rejected move request", async () => {
    historyRuntime.entries = [
      {
        id: "h-rejected",
        status: "complete",
        downloadId: 47,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "HISTORY_GET") {
        return { type: "HISTORY_GET", body: { entries: historyRuntime.entries } };
      }
      throw new Error("worker stopped");
    });
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-move")!.click();
    document.querySelector<HTMLButtonElement>(".history-move-confirm")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain("Could not move"),
    );
  });

  test("reports when rerouting succeeds but the original is kept", async () => {
    historyRuntime.entries = [
      {
        id: "h-kept",
        status: "complete",
        downloadId: 48,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "HISTORY_REROUTE") {
        return {
          type: "HISTORY_REROUTE",
          body: { rerouted: true, oldRemoved: false, newHistoryId: "h-copy" },
        };
      }
      return { type: "HISTORY_GET", body: { entries: historyRuntime.entries } };
    });
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-move")!.click();
    document.querySelector<HTMLButtonElement>(".history-move-confirm")!.click();

    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    await vi.waitFor(() =>
      expect(feedback.textContent).toContain("The original file could not be removed"),
    );
    expect(feedback.classList).toContain("feedback-error");
  });

  test("reports a move that is waiting for its replacement download", async () => {
    historyRuntime.entries = [
      {
        id: "h-pending",
        status: "complete",
        downloadId: 49,
        finalFullPath: "from/photo.png",
        url: "https://cdn.test/photo.png",
      },
    ];
    historyRuntime.sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === "HISTORY_REROUTE"
        ? {
            type: "HISTORY_REROUTE",
            body: { rerouted: true, oldRemoved: false, pending: true },
          }
        : { type: "HISTORY_GET", body: { entries: historyRuntime.entries } },
    );
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>(".history-move")!.click();
    document.querySelector<HTMLButtonElement>(".history-move-confirm")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain(
        "The original will be removed after it completes",
      ),
    );
  });

  test("undo failure is contained and re-enables the row action", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();
    historyRuntime.sendMessage.mockRejectedValueOnce(new Error("worker stopped"));
    const undo = document.querySelector<HTMLButtonElement>(".history-undo")!;

    undo.click();

    await vi.waitFor(() => expect(undo.disabled).toBe(false));
    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    expect(feedback.hidden).toBe(false);
    expect(feedback.classList.contains("feedback-error")).toBe(true);
  });

  test("an already-removed file reports the distinct undo outcome", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();
    historyRuntime.sendMessage.mockResolvedValueOnce({
      type: "HISTORY_UNDO",
      body: { undone: true, fileMissing: true },
    });

    document.querySelector<HTMLButtonElement>(".history-undo")!.click();

    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    await vi.waitFor(() => expect(feedback.hidden).toBe(false));
    expect(feedback.classList.contains("feedback-error")).toBe(false);
    expect(feedback.textContent).toContain("already been moved or removed");
  });

  test("a background refusal reports the undo failure", async () => {
    historyRuntime.entries = [
      { id: "h-complete", status: "complete", downloadId: 42, finalFullPath: "done.png" },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();
    historyRuntime.sendMessage.mockResolvedValueOnce({
      type: "HISTORY_UNDO",
      body: { undone: false, fileMissing: false },
    });

    document.querySelector<HTMLButtonElement>(".history-undo")!.click();

    const feedback = document.querySelector<HTMLElement>("#history-feedback")!;
    await vi.waitFor(() => expect(feedback.hidden).toBe(false));
    expect(feedback.classList.contains("feedback-error")).toBe(true);
    expect(feedback.textContent).toContain("Could not undo");
  });

  test("rows without a completed browser download offer no undo action", async () => {
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", finalFullPath: "later.iso" },
      { id: "h-undone", status: "undone", downloadId: 9, finalFullPath: "gone.png" },
      { id: "h-no-id", status: "complete", finalFullPath: "old.png" },
    ];
    const { renderHistory } = historyPanel;
    await renderHistory();

    expect(document.querySelector(".history-undo")).toBeNull();
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

  test("copies the saved path and source URL from row actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    historyRuntime.entries = [
      {
        id: "h-copy",
        status: "complete",
        finalFullPath: "images/cat.png",
        url: "https://cdn.test/cat.png",
      },
    ];
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>('[aria-label="Copy saved path"]')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("images/cat.png"));
    document.querySelector<HTMLButtonElement>('[aria-label="Copy source URL"]')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("https://cdn.test/cat.png"));
    expect(document.querySelector("#history-feedback")?.textContent).toContain("Source URL copied");
  });

  test("renders a private browser-owned entry without a saved path", async () => {
    historyRuntime.entries = [{ id: "h-browser", observedBrowserDownload: true, private: true }];
    historyPanel.setHistoryLocalizer((key) =>
      key === "privateBrowsingHeading" ? "Navigation privée" : "",
    );

    await historyPanel.renderHistory();

    expect(document.querySelector(".history-origin")?.textContent).toBe(
      "Browser (Navigation privée)",
    );
    expect(document.querySelector('[aria-label="Copy saved path"]')).toBeNull();
  });

  test("reports clipboard failures from row actions", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")) },
    });
    historyRuntime.entries = [
      { id: "h-copy", status: "complete", finalFullPath: "images/cat.png" },
    ];
    await historyPanel.renderHistory();

    document.querySelector<HTMLButtonElement>('[aria-label="Copy saved path"]')!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain("Could not copy"),
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
    const onlyVisible = document.querySelector<HTMLInputElement>(
      '#history-column-options input[value="index"]',
    )!;
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
      "time",
      "file",
      "folder",
      "status",
      "size",
      "source",
      "type",
      "routed",
      "index",
      "mechanism",
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
    expect(
      [...document.querySelectorAll<HTMLElement>(".history-table thead th")].map(
        (cell) => cell.dataset.column,
      ),
    ).toEqual(allColumns);
    expect(
      [...document.querySelectorAll(".history-table tbody tr:first-child td")].map(
        (cell) => (cell as HTMLElement).dataset.column,
      ),
    ).toEqual(allColumns);
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
    const menu = document.querySelector<HTMLDetailsElement>(".history-export-menu")!;
    const trigger = menu.querySelector<HTMLElement>("summary")!;
    menu.open = true;

    document.querySelector<HTMLButtonElement>(`#history-export-${format}`)!.click();

    const createObjectURL = vi.mocked(URL.createObjectURL);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe(contentType);
    expect(click).toHaveBeenCalledOnce();
    const clickedLink = click.mock.instances[0] as HTMLAnchorElement;
    expect(clickedLink?.download).toBe(`save-in-history.${format}`);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:history-export");
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test("exports safely when optional menu markup is absent", async () => {
    historyRuntime.entries = [{ id: "h-export", finalFullPath: "photo.png" }];
    document.body.innerHTML = '<button id="history-export-json"></button>';
    historyPanel.setupHistoryPanel();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    document.querySelector<HTMLButtonElement>("#history-export-json")!.click();

    expect(click).toHaveBeenCalledOnce();
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
    expect(historyRuntime.search).toHaveBeenNthCalledWith(1, { id: 7 });

    historyRuntime.search.mockResolvedValueOnce([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(progress.getAttribute("data-download-id")).toBeNull();
    const callsAfterRemoval = historyRuntime.search.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1000);
    expect(historyRuntime.search).toHaveBeenCalledTimes(callsAfterRemoval);
  });

  test("does not overlap a slow native progress poll", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    let resolveSearch: (items: Array<Record<string, unknown>>) => void = () => {};
    historyRuntime.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );

    await historyPanel.renderHistory();
    await vi.advanceTimersByTimeAsync(5000);
    expect(historyRuntime.search).toHaveBeenCalledOnce();

    historyRuntime.search.mockResolvedValueOnce([
      { id: 7, state: "in_progress", bytesReceived: 60, totalBytes: 100 },
    ]);
    resolveSearch([{ id: 7, state: "in_progress", bytesReceived: 50, totalBytes: 100 }]);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(999);
    expect(historyRuntime.search).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(historyRuntime.search).toHaveBeenCalledTimes(2);
  });

  test("drops a native progress result from an obsolete render", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    let resolveSearch: (items: Array<Record<string, unknown>>) => void = () => {};
    historyRuntime.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    await historyPanel.renderHistory();

    historyRuntime.entries = [];
    await historyPanel.renderHistory();
    resolveSearch([{ id: 7, state: "complete" }]);
    await vi.runAllTicks();

    expect(document.querySelector(".history-progress")).toBeNull();
  });

  test("does not schedule a retry for an obsolete failed poll", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    let rejectSearch: (error: Error) => void = () => {};
    historyRuntime.search.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSearch = reject;
        }),
    );
    await historyPanel.renderHistory();

    historyRuntime.entries = [];
    await historyPanel.renderHistory();
    rejectSearch(new Error("obsolete poll"));
    await vi.runAllTicks();
    const calls = historyRuntime.search.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);

    expect(historyRuntime.search).toHaveBeenCalledTimes(calls);
  });

  test("contains an already-queued poll callback after progress stops", async () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(window, "setTimeout");
    historyRuntime.entries = [{ id: "h-pending", status: "pending", finalFullPath: "large.iso" }];
    await historyPanel.renderHistory();
    const queuedPoll = timers.mock.calls.find(([, delay]) => delay === 1000)?.[0];
    if (!queuedPoll) throw new Error("history progress poll was not scheduled");

    historyRuntime.entries = [];
    await historyPanel.renderHistory();
    queuedPoll();
    await vi.runAllTicks();

    expect(historyRuntime.search).not.toHaveBeenCalled();
  });

  test("refreshes durable history when native progress finishes", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    let resolveSearch: (items: Array<Record<string, unknown>>) => void = () => {};
    historyRuntime.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const { renderHistory } = historyPanel;
    await renderHistory();

    historyRuntime.entries = [
      {
        id: "h-pending",
        status: "complete",
        downloadId: 7,
        fileSize: 100,
        finalFullPath: "large.iso",
      },
    ];
    resolveSearch([
      { id: null, state: "in_progress" },
      { id: 7, state: "complete", bytesReceived: 100, totalBytes: 100 },
    ]);
    await vi.runAllTimersAsync();

    expect(historyRuntime.sendMessage).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".status-badge")?.textContent).toBe("Saved");
    expect(document.querySelector(".history-progress")).toBeNull();
    expect(document.querySelector(".history-cancel")).toBeNull();
  });

  test("refreshes pending history before a native download id is available", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [{ id: "h-pending", status: "pending", finalFullPath: "instant.txt" }];
    const { renderHistory } = historyPanel;
    await renderHistory();
    expect(document.querySelector(".history-progress")).toBeNull();
    expect(document.querySelector(".history-cancel")).not.toBeNull();

    historyRuntime.entries = [
      {
        id: "h-pending",
        status: "complete",
        downloadId: 8,
        fileSize: 20,
        finalFullPath: "instant.txt",
      },
    ];
    await vi.advanceTimersByTimeAsync(1000);

    expect(historyRuntime.sendMessage).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".status-badge")?.textContent).toBe("Saved");
    expect(document.querySelector(".history-cancel")).toBeNull();
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

  test("stops progress polling after its pending controls are removed", async () => {
    vi.useFakeTimers();
    historyRuntime.entries = [
      { id: "h-pending", status: "pending", downloadId: 7, finalFullPath: "large.iso" },
    ];
    historyRuntime.search.mockResolvedValue([
      { id: 7, state: "in_progress", bytesReceived: 50, totalBytes: 100 },
    ]);
    const { renderHistory } = historyPanel;
    await renderHistory();
    await vi.runAllTicks();

    document.querySelector(".history-progress")?.remove();
    document.querySelector(".history-cancel")?.remove();
    const calls = historyRuntime.search.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);

    expect(historyRuntime.search).toHaveBeenCalledTimes(calls);
  });

  test("contains invalid history responses", async () => {
    historyRuntime.sendMessage.mockResolvedValueOnce({ type: "HISTORY_GET", body: {} });
    const { renderHistory } = historyPanel;

    await renderHistory();

    expect(document.querySelector("#history-feedback")?.getAttribute("role")).toBe("alert");
  });

  test("coalesces overlapping history refreshes to one follow-up read", async () => {
    const releases: Array<(response: unknown) => void> = [];
    historyRuntime.sendMessage.mockImplementation(
      () => new Promise((resolve) => releases.push(resolve)),
    );

    const first = historyPanel.renderHistory();
    const second = historyPanel.renderHistory();
    const third = historyPanel.renderHistory();
    expect(historyRuntime.sendMessage).toHaveBeenCalledOnce();

    releases.shift()?.({ type: "HISTORY_GET", body: { entries: [] } });
    await vi.waitFor(() => expect(historyRuntime.sendMessage).toHaveBeenCalledTimes(2));
    releases.shift()?.({ type: "HISTORY_GET", body: { entries: [] } });
    await Promise.all([first, second, third]);

    expect(historyRuntime.sendMessage).toHaveBeenCalledTimes(2);
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

  test("does not clear history when confirmation is declined", async () => {
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    await historyPanel.renderHistory();
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    document.querySelector<HTMLButtonElement>(".history-clear-dialog button")!.click();
    expect(historyRuntime.sendMessage).not.toHaveBeenCalledWith({ type: "HISTORY_CLEAR" });
  });

  test("restores focus when the clear dialog is canceled by the browser", async () => {
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    await historyPanel.renderHistory();
    const opener = document.querySelector<HTMLButtonElement>("#history-clear")!;
    opener.focus();
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    const pending = historyPanel.showClearHistoryDialog();
    const dialog = document.querySelector<HTMLDialogElement>(".history-clear-dialog")!;

    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));

    await expect(pending).resolves.toBe(false);
    expect(showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  });

  test("treats a non-OK clear response as a failure", async () => {
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    await historyPanel.renderHistory();
    historyRuntime.sendMessage.mockResolvedValueOnce({ type: "HISTORY_CLEAR", body: {} });
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    confirmHistoryClear();
    await vi.waitFor(() =>
      expect(document.querySelector("#history-feedback")?.textContent).toContain(
        "Could not delete history",
      ),
    );
  });

  test("retries clearing after the clear button is removed", async () => {
    historyRuntime.entries = [{ id: "h-delete", finalFullPath: "delete-me.txt" }];
    await historyPanel.renderHistory();
    historyRuntime.sendMessage.mockRejectedValue(new Error("storage unavailable"));
    document.querySelector<HTMLButtonElement>("#history-clear")!.click();
    confirmHistoryClear();
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
