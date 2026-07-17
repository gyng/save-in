// Live progress for still-downloading history rows. Each pending row with a
// download id renders a `.history-progress[data-download-id]` cell; while any
// exist, poll the browser and fill in the percentage / bytes. When one finishes
// we re-render so it picks up the stored final status and size.

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import type { DownloadProgress } from "../../shared/history-types.ts";
import { progressCell } from "./history-model.ts";
import { renderHistory } from "./history-refresh.ts";

const POLL_INTERVAL_MS = 1000;

let historyProgressTimer: ReturnType<typeof setInterval> | null = null;

export const stopHistoryProgress = (): void => {
  if (historyProgressTimer) {
    clearInterval(historyProgressTimer);
    historyProgressTimer = null;
  }
};

const pollHistoryProgress = (): void => {
  const cells = document.querySelectorAll(".history-progress[data-download-id]");
  if (cells.length === 0) {
    if (document.querySelector(".history-cancel")) void renderHistory();
    else stopHistoryProgress();
    return;
  }
  if (!webExtensionApi.downloads || !webExtensionApi.downloads.search) {
    stopHistoryProgress();
    return;
  }
  webExtensionApi.downloads
    .search({})
    .then((items) => {
      const byId: Record<number, DownloadProgress> = {};
      items.forEach((it: DownloadProgress) => {
        if (it.id != null) {
          byId[it.id] = it;
        }
      });
      let anyInProgress = false;
      let anyFinished = false;
      cells.forEach((cell) => {
        const item = byId[Number(cell.getAttribute("data-download-id"))];
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
      } else if (!anyInProgress) {
        stopHistoryProgress();
      }
    })
    .catch(() => {});
};

export const startHistoryProgress = (): void => {
  stopHistoryProgress();
  const hasNativeProgress = document.querySelector(".history-progress[data-download-id]");
  if (hasNativeProgress || document.querySelector(".history-cancel")) {
    historyProgressTimer = setInterval(pollHistoryProgress, POLL_INTERVAL_MS);
    if (hasNativeProgress) pollHistoryProgress();
  }
};
