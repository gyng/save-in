// History panel controller for the options page. Owns the history table's
// view state (sort/filter/page) and its DOM rendering + live download-progress
// polling; the pure, data-in/data-out logic (row flattening, sort/filter/
// paginate, byte + progress formatting) lives in history-view.js (HistoryView).
// A classic script sharing the options page's global scope, like the other
// options/*.js files. Loaded after history-view.js.

import { HistoryView } from "./history-view.ts";

const HISTORY_KEY = "save-in-history";

// Newest-first cache of the stored entries, and the current sort/filter/
// page state; the table re-renders from these without touching storage
let historyEntries = [];
let historySort = { key: "time", dir: "desc" };
let historyFilter = "";
let historyPage = 0;
const HISTORY_PAGE_SIZE = 50;

// Opens the containing folder for a completed download (best-effort; the
// browser may have forgotten the download)
const showInFolder = (downloadId) => {
  if (downloadId == null || !browser.downloads || !browser.downloads.show) {
    return;
  }
  try {
    browser.downloads.show(downloadId);
  } catch (e) {
    // download no longer known to the browser
  }
};

// Live progress for still-downloading history rows. Each pending row with a
// download id renders a `.history-progress[data-download-id]` cell; while any
// exist, poll the browser and fill in the percentage / bytes. When one finishes
// we re-render so it picks up the stored final status and size.
let historyProgressTimer = null;

const stopHistoryProgress = () => {
  if (historyProgressTimer) {
    clearInterval(historyProgressTimer);
    historyProgressTimer = null;
  }
};

const pollHistoryProgress = () => {
  const cells = document.querySelectorAll(".history-progress[data-download-id]");
  if (cells.length === 0 || !browser.downloads || !browser.downloads.search) {
    stopHistoryProgress();
    return;
  }
  browser.downloads
    .search({})
    .then((items) => {
      const byId = {};
      items.forEach((it) => {
        byId[it.id] = it;
      });
      let anyInProgress = false;
      let anyFinished = false;
      cells.forEach((cell) => {
        const item = byId[Number(cell.getAttribute("data-download-id"))];
        if (item && item.state === "in_progress") {
          anyInProgress = true;
          const { label, title } = HistoryView.progressCell(item);
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
        renderHistoryTable();
      } else if (!anyInProgress) {
        stopHistoryProgress();
      }
    })
    .catch(() => {});
};

const startHistoryProgress = () => {
  stopHistoryProgress();
  if (document.querySelector(".history-progress[data-download-id]")) {
    historyProgressTimer = setInterval(pollHistoryProgress, 1000);
    pollHistoryProgress();
  }
};

const renderHistoryTable = () => {
  const container = document.querySelector("#history-list");
  const countEl = document.querySelector("#history-count");
  if (!container) {
    return;
  }

  const query = historyFilter.trim().toLowerCase();
  const { pageRows, matchCount, total, pageCount, page } = HistoryView.paginate(historyEntries, {
    filter: historyFilter,
    sort: historySort,
    page: historyPage,
    pageSize: HISTORY_PAGE_SIZE,
  });
  historyPage = page; // paginate clamped it into range

  if (countEl) {
    countEl.textContent = query ? `${matchCount} of ${total}` : total ? `${total} saved` : "";
  }

  container.textContent = "";

  if (total === 0) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No downloads saved yet.";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "history-table";

  const head = document.createElement("tr");
  HistoryView.COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.width) {
      th.style.width = col.width;
    }
    if (col.sortable) {
      th.classList.add("sortable");
      if (historySort.key === col.key) {
        th.classList.add("sorted");
        th.textContent = `${col.label} ${historySort.dir === "asc" ? "▲" : "▼"}`;
      }
      th.addEventListener("click", () => {
        if (historySort.key === col.key) {
          historySort.dir = historySort.dir === "asc" ? "desc" : "asc";
        } else {
          historySort = { key: col.key, dir: col.key === "time" ? "desc" : "asc" };
        }
        historyPage = 0;
        renderHistoryTable();
      });
    }
    head.appendChild(th);
  });
  table.appendChild(head);

  pageRows.forEach((r) => {
    const tr = document.createElement("tr");

    const time = document.createElement("td");
    time.className = "history-time";
    time.textContent = HistoryView.time(r.time);
    tr.appendChild(time);

    const status = document.createElement("td");
    status.className = "history-status";
    const badge = document.createElement("span");
    badge.className = `status-badge ${HistoryView.statusClass(r.status)}`;
    badge.textContent = HistoryView.statusLabel(r.status);
    badge.title = r.status;
    status.appendChild(badge);
    // Open the file's folder for completed downloads the browser still knows
    if (r.status === "complete" && r.downloadId != null) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-open";
      open.textContent = "📂";
      open.title = "Show in folder";
      open.addEventListener("click", () => showInFolder(r.downloadId));
      status.appendChild(open);
    }
    tr.appendChild(status);

    const size = document.createElement("td");
    size.className = "history-size";
    if (r.status === "pending" && r.downloadId != null) {
      // filled and updated live by the progress poller below
      size.classList.add("history-progress");
      size.setAttribute("data-download-id", String(r.downloadId));
      size.textContent = "…";
    } else if (r.size != null) {
      size.textContent = HistoryView.formatBytes(r.size);
    }
    tr.appendChild(size);

    const type = document.createElement("td");
    type.className = "history-type";
    type.textContent = r.type;
    tr.appendChild(type);

    const routed = document.createElement("td");
    routed.className = "history-routed";
    if (r.routed) {
      const chip = document.createElement("span");
      chip.className = "routed-chip";
      chip.textContent = "renamed";
      chip.title = "A routing/rename rule was applied";
      routed.appendChild(chip);
    }
    tr.appendChild(routed);

    const file = document.createElement("td");
    file.className = "history-file";
    file.textContent = r.file;
    file.title = r.fullPath;
    tr.appendChild(file);

    const folder = document.createElement("td");
    folder.className = "history-folder";
    folder.textContent = r.folder;
    folder.title = r.folder;
    tr.appendChild(folder);

    const src = document.createElement("td");
    src.className = "history-source";
    if (r.source) {
      const link = document.createElement("a");
      link.href = r.source;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = r.source;
      link.title = r.source;
      src.appendChild(link);
    }
    tr.appendChild(src);

    table.appendChild(tr);
  });

  container.appendChild(table);

  // Pagination (only when there is more than one page)
  if (pageCount > 1) {
    const pager = document.createElement("div");
    pager.className = "history-pager";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "‹ Newer";
    prev.disabled = historyPage === 0;
    prev.addEventListener("click", () => {
      historyPage -= 1;
      renderHistoryTable();
    });

    const label = document.createElement("span");
    label.className = "caption history-pager-label";
    label.textContent = `Page ${historyPage + 1} of ${pageCount}`;

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Older ›";
    next.disabled = historyPage >= pageCount - 1;
    next.addEventListener("click", () => {
      historyPage += 1;
      renderHistoryTable();
    });

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    container.appendChild(pager);
  }

  // Start/refresh live progress polling for any in-flight downloads on the page
  startHistoryProgress();
};

export const renderHistory = async () => {
  const stored = (await browser.storage.local.get(HISTORY_KEY)) ?? {};
  historyEntries = (stored[HISTORY_KEY] || []).slice().reverse(); // newest first

  // Raw JSON stays available (some users import/inspect it); kept in sync
  const raw = document.querySelector("#history") as HTMLTextAreaElement;
  if (raw) {
    raw.value = JSON.stringify(stored, null, 2);
  }

  renderHistoryTable();
};
document.addEventListener("DOMContentLoaded", renderHistory);

const historyFilterInput = document.querySelector("#history-filter") as HTMLInputElement;
historyFilterInput?.addEventListener("input", () => {
  historyFilter = historyFilterInput.value;
  historyPage = 0;
  renderHistoryTable();
});

const clearHistory = () => {
  // eslint-disable-next-line no-alert
  if (window.confirm("Clear all saved history? This cannot be undone.")) {
    browser.storage.local.remove(HISTORY_KEY).then(renderHistory);
  }
};
document.querySelector("#history-clear")?.addEventListener("click", clearHistory);
