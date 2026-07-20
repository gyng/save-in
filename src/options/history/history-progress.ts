// Live progress for still-downloading history rows. Each pending row with a
// download id renders a `.history-progress[data-download-id]` cell; while any
// exist, poll the browser and fill in the percentage / bytes. When one finishes
// we re-render so it picks up the stored final status and size.

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import type { DownloadProgress } from "../../shared/history-types.ts";
import { progressCell } from "./history-model.ts";
import { renderHistory } from "./history-refresh.ts";

const POLL_INTERVAL_MS = 1000;

let historyProgressTimer: ReturnType<typeof setTimeout> | null = null;
let historyProgressGeneration = 0;

export const stopHistoryProgress = (): void => {
  historyProgressGeneration += 1;
  if (historyProgressTimer) {
    clearTimeout(historyProgressTimer);
    historyProgressTimer = null;
  }
};

const scheduleHistoryProgress = (generation: number): void => {
  if (generation !== historyProgressGeneration) return;
  historyProgressTimer = setTimeout(() => {
    historyProgressTimer = null;
    void pollHistoryProgress(generation);
  }, POLL_INTERVAL_MS);
};

const pollHistoryProgress = async (generation: number): Promise<void> => {
  if (generation !== historyProgressGeneration) return;
  const cells = document.querySelectorAll(".history-progress[data-download-id]");
  if (cells.length === 0) {
    if (document.querySelector(".history-cancel")) void renderHistory();
    else stopHistoryProgress();
    return;
  }
  const downloads = webExtensionApi.downloads;
  if (!downloads?.search) {
    stopHistoryProgress();
    return;
  }
  const ids = [
    ...new Set(
      [...cells]
        .map((cell) => Number(cell.getAttribute("data-download-id")))
        .filter(Number.isSafeInteger),
    ),
  ];
  try {
    // downloads.search({}) returns the browser's complete download database.
    // Ask only for the rows on this 50-entry page, and do not schedule another
    // poll until these host calls settle, so a slow browser cannot build a
    // queue of overlapping full-history snapshots.
    const searches = await Promise.all(ids.map((id) => downloads.search({ id })));
    if (generation !== historyProgressGeneration) return;
    const byId = new Map<number, DownloadProgress>();
    searches.flat().forEach((item: DownloadProgress) => {
      if (item.id != null) byId.set(item.id, item);
    });
    let anyInProgress = false;
    let anyFinished = false;
    cells.forEach((cell) => {
      const item = byId.get(Number(cell.getAttribute("data-download-id")));
      if (item && item.state === "in_progress") {
        anyInProgress = true;
        const { label, title } = progressCell(item);
        cell.textContent = label;
        cell.setAttribute("title", title);
      } else if (item) {
        // completed/interrupted -> re-render to pick up the stored status+size
        anyFinished = true;
      } else {
        // the browser no longer knows this download: stop polling this cell
        cell.textContent = "—";
        cell.removeAttribute("data-download-id");
      }
    });
    if (anyFinished) {
      void renderHistory();
    } else if (anyInProgress) {
      scheduleHistoryProgress(generation);
    } else {
      stopHistoryProgress();
    }
  } catch {
    scheduleHistoryProgress(generation);
  }
};

export const startHistoryProgress = (): void => {
  stopHistoryProgress();
  const generation = historyProgressGeneration;
  const hasNativeProgress = document.querySelector(".history-progress[data-download-id]");
  if (hasNativeProgress || document.querySelector(".history-cancel")) {
    if (hasNativeProgress) void pollHistoryProgress(generation);
    else scheduleHistoryProgress(generation);
  }
};
