const getOptionsSchema = browser.runtime
  .sendMessage({ type: "OPTIONS_SCHEMA" })
  .then((res) => {
    console.log("options", res, CURRENT_BROWSER);
    return res.body;
  })
  .catch(console.error);

// Latest interpolated variables from the most recent CHECK_ROUTES; read by
// the once-bound #see-variables-btn handler (see updateErrors)
let latestInterpolatedVariables = null;

const renderVariablesTable = () => {
  if (!latestInterpolatedVariables) {
    return;
  }
  const tableBody = document.querySelector("#variables-body");
  tableBody.classList.toggle("hide");
  tableBody.innerHTML = "";

  Object.keys(latestInterpolatedVariables).forEach((key) => {
    const val = latestInterpolatedVariables[key];

    const variableRow = document.createElement("tr");

    const nameEl = document.createElement("td");
    nameEl.textContent = key;
    nameEl.classList.add("click-to-copy");
    nameEl.classList.add("code");
    addClickToCopy(nameEl);

    const interpolatedEl = document.createElement("td");
    interpolatedEl.style.fontFamily = "monospace";
    interpolatedEl.textContent = val;

    variableRow.appendChild(nameEl);
    variableRow.appendChild(interpolatedEl);
    tableBody.appendChild(variableRow);
  });
};

document.querySelector("#see-variables-btn")?.addEventListener("click", renderVariablesTable);

// Reveal + select the offending text in its editor. Best-effort: the error
// string is usually the offending line/clause, so we find and select it.
const jumpToError = (textareaId, needle) => {
  // Paths in Visual mode: jump to the matching visual row instead of switching
  // back to the textarea. Match the row whose directory field is contained in
  // the (raw) line; fall back to Text mode if nothing matches (e.g. a line the
  // visual editor couldn't represent).
  if (textareaId === "#paths" && needle) {
    const visual = document.querySelector("#paths-visual");
    if (visual instanceof HTMLElement && !visual.hidden) {
      const rows = [...document.querySelectorAll("#path-editor-rows .path-editor-row")];
      const target = rows.find((r) => {
        const dir = r.querySelector(".path-editor-dir");
        return (
          dir instanceof HTMLInputElement && dir.value.trim() && needle.includes(dir.value.trim())
        );
      });
      if (target) {
        target.scrollIntoView({ block: "center" });
        const dir = target.querySelector(".path-editor-dir");
        if (dir instanceof HTMLInputElement) {
          dir.focus();
          dir.select();
        }
        target.classList.add("path-editor-row-flash");
        window.setTimeout(() => target.classList.remove("path-editor-row-flash"), 1200);
        return;
      }
      const textBtn = document.querySelector("#paths-mode-text");
      if (textBtn instanceof HTMLElement) {
        textBtn.click();
      }
    }
  }

  const ta = document.querySelector(textareaId);
  if (!(ta instanceof HTMLTextAreaElement)) {
    return;
  }
  ta.scrollIntoView({ block: "center" });
  ta.focus();
  const idx = needle ? ta.value.indexOf(needle) : -1;
  if (idx >= 0) {
    ta.setSelectionRange(idx, idx + needle.length);
    // Nudge the caret into view (setSelectionRange alone may not scroll)
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const line = ta.value.slice(0, idx).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 2);
  }
};

const renderErrorRow = (err, textareaId) => {
  const r = document.createElement("div");
  r.className = "error-row";
  r.setAttribute("role", "button");
  r.setAttribute("tabindex", "0");
  r.title = "Jump to this error";

  const message = document.createElement("span");
  message.className = "error-message";
  message.textContent = err.message;
  r.appendChild(message);

  const error = document.createElement("span");
  error.className = "error-error";
  error.textContent = err.error;
  r.appendChild(error);

  const jump = () => jumpToError(textareaId, err.error);
  r.addEventListener("click", jump);
  r.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jump();
    }
  });

  return r;
};

// Validate the (possibly unsaved) editor contents live and render both error
// panels — VALIDATE dry-runs both grammars, so the panels track the menu
// preview (which also validates live) instead of the last-saved state.
const renderValidationErrors = () => {
  const pathsTa = document.querySelector("#paths");
  const rulesTa = document.querySelector("#filenamePatterns");
  const pathsErrors = document.querySelector("#error-paths");
  const rulesErrors = document.querySelector("#error-filenamePatterns");
  if (!pathsErrors && !rulesErrors) {
    return;
  }

  browser.runtime
    .sendMessage({
      type: "VALIDATE",
      body: {
        paths: pathsTa instanceof HTMLTextAreaElement ? pathsTa.value : "",
        filenamePatterns: rulesTa instanceof HTMLTextAreaElement ? rulesTa.value : "",
      },
    })
    .then((res) => {
      const body = (res && res.body) || {};
      if (pathsErrors) {
        pathsErrors.innerHTML = "";
        (body.pathErrors || []).forEach((err) =>
          pathsErrors.appendChild(renderErrorRow(err, "#paths")),
        );
      }
      if (rulesErrors) {
        rulesErrors.innerHTML = "";
        (body.ruleErrors || []).forEach((err) =>
          rulesErrors.appendChild(renderErrorRow(err, "#filenamePatterns")),
        );
      }
    })
    .catch(() => {}); // background not awake yet; the next edit retries
};

const updateErrors = () => {
  const lastDlMatch = document.querySelector("#last-dl-match");
  const lastDlCapture = document.querySelector("#last-dl-capture");

  // Errors are validated live (VALIDATE); CHECK_ROUTES fills the routing /
  // last-download / variables panes below.
  renderValidationErrors();

  browser.runtime.sendMessage({ type: "CHECK_ROUTES" }).then(({ body }) => {
    // Last download
    const hasLastDownload =
      body.lastDownload && body.lastDownload.info && body.lastDownload.info.url;
    if (hasLastDownload) {
      document.querySelector("#last-dl-url").textContent = body.lastDownload.info.url;
    }

    document.querySelector("#rules-applied-row").classList.toggle("hide", !hasLastDownload);

    // Routing result
    lastDlMatch.innerHTML = "no matches";
    if (body.routeInfo.path) {
      lastDlMatch.textContent = body.routeInfo.path;
    }

    // Variables
    if (hasLastDownload) {
      document.querySelector("#variables-table-row").classList.toggle("hide", !hasLastDownload);
    }
    // The #see-variables-btn click handler is bound once below; updateErrors
    // only refreshes the data it reads. Binding here would leak a listener on
    // every autosave and make the toggle unpredictable.
    latestInterpolatedVariables = body.interpolatedVariables;

    // Capture groups
    const hasCaptureMatches = body.routeInfo && Array.isArray(body.routeInfo.captures);

    document.querySelector("#capture-group-rows").classList.toggle("hide", !hasCaptureMatches);

    if (hasCaptureMatches) {
      lastDlCapture.textContent = "";

      // Skip first match as it's just the entire input
      body.routeInfo.captures
        .slice(1)
        .map((c, i) => {
          const div = document.createElement("div");
          div.className = "match-row";

          const code = document.createElement("code");
          code.innerText = `:$${i + 1}:`;
          code.classList.add("click-to-copy");
          addClickToCopy(code);
          div.appendChild(code);

          const value = document.createElement("div");
          value.className = "match-row-result";
          value.textContent = body.routeInfo.captures[i + 1];
          div.appendChild(value);

          return div;
        })
        .forEach((rowDiv) => lastDlCapture.appendChild(rowDiv));
    }
  });
};

// Version from the live manifest; commit + stamp date from version.json
// (written by scripts/write-version.js at build/stage time — absent in a
// bare checkout, where just the version shows)
const renderVersionLabel = () => {
  /** @type {HTMLAnchorElement} */
  const el = document.querySelector("#version-label");
  if (!el) {
    return;
  }

  const version = browser.runtime.getManifest().version;
  el.textContent = `v${version}`;
  el.title = `save-in v${version} — view releases`;

  fetch("version.json")
    .then((res) => res.json())
    .then(({ commit }) => {
      el.textContent = `v${version} (${commit})`;
    })
    .catch(() => {});
};
document.addEventListener("DOMContentLoaded", renderVersionLabel);

// More Options → External API: show the live extension id and a ready-to-paste
// integration snippet, and PING the running background so the displayed version
// and capabilities are the real ones this build serves. See docs/INTEGRATIONS.md.
const renderExternalApi = () => {
  const idEl = document.querySelector("#ext-id");
  if (!idEl) {
    return;
  }
  const id = browser.runtime.id;
  idEl.textContent = id;

  const snippet = document.querySelector("#api-snippet");
  if (snippet) {
    snippet.textContent = [
      `const ID = "${id}";`,
      `const pong = await browser.runtime.sendMessage(ID, { type: "PING" });`,
      `// pong.body -> { version, capabilities }`,
      ``,
      `const res = await browser.runtime.sendMessage(ID, {`,
      `  type: "DOWNLOAD",`,
      `  body: {`,
      `    url: "https://example.com/pic.jpg",`,
      `    info: { pageUrl: location.href, srcUrl: "https://example.com/pic.jpg" },`,
      `  },`,
      `});`,
      `// res.body -> { status: "OK", version, url } | { status: "ERROR", error, message }`,
    ].join("\n");
  }

  const versionEl = document.querySelector("#api-version");
  const capsEl = document.querySelector("#api-capabilities");
  browser.runtime
    .sendMessage({ type: "PING" })
    .then((pong) => {
      const body = (pong && pong.body) || {};
      if (versionEl) {
        versionEl.textContent = body.version != null ? `v${body.version}` : "unknown";
      }
      if (capsEl) {
        capsEl.textContent = (body.capabilities || []).join(", ") || "—";
      }
    })
    .catch(() => {
      if (versionEl) {
        versionEl.textContent = "unavailable";
      }
      if (capsEl) {
        capsEl.textContent = "—";
      }
    });
};
document.addEventListener("DOMContentLoaded", renderExternalApi);

// More Options → Counter: show and reset the :counter: variable's value. The
// options page shares storage.local with the background, so it reads/writes the
// counter directly (Counter.KEY) — no background round-trip needed.
const renderCounter = () => {
  const key = "save-in-counter";
  const valueEl = document.querySelector("#counter-value");
  const resetBtn = document.querySelector("#counter-reset");
  if (!valueEl || !resetBtn) {
    return;
  }
  const show = () =>
    browser.storage.local.get(key).then((res) => {
      valueEl.textContent = String((res && res[key]) || 0);
    });
  show();
  resetBtn.addEventListener("click", () => {
    browser.storage.local.set({ [key]: 0 }).then(show);
  });
};
document.addEventListener("DOMContentLoaded", renderCounter);

// Live variable values, shown in the preview columns of the Downloads and
// Dynamic tabs: each variable and its current interpolated value from the
// last download (CHECK_ROUTES). Clicking a variable inserts it into the
// panel's target editor; empty until there is a download to interpolate.
const renderVariablesPreview = () => {
  const panels = document.querySelectorAll(".variables-preview");
  if (panels.length === 0) {
    return;
  }

  Promise.all([
    browser.runtime.sendMessage({ type: "GET_KEYWORDS" }),
    browser.runtime.sendMessage({ type: "CHECK_ROUTES" }).catch(() => null),
  ])
    .then(([keywords, routes]) => {
      const variables = (keywords && keywords.body && keywords.body.variables) || [];
      const values = (routes && routes.body && routes.body.interpolatedVariables) || {};
      const hasValues = Object.keys(values).length > 0;

      panels.forEach((/** @type {HTMLElement} */ panel) => {
        const container = panel.querySelector(".variables-preview-list");
        if (!container) {
          return;
        }
        container.textContent = "";

        if (!hasValues) {
          const empty = document.createElement("p");
          empty.className = "caption variables-preview-empty";
          empty.textContent = "Values appear here after your next save.";
          container.appendChild(empty);
          return;
        }

        const targetId = panel.dataset.insertTarget;
        const target = targetId ? document.querySelector(`#${targetId}`) : null;

        const table = document.createElement("table");
        table.className = "variables-preview-table";

        variables.forEach((variable) => {
          const tr = document.createElement("tr");
          tr.className = "variables-preview-row";
          if (target && typeof PathEditor !== "undefined") {
            tr.classList.add("insertable");
            tr.title = `Insert ${variable}`;
            tr.addEventListener("click", () => PathEditor.insertAtCursor(target, variable));
          }

          const nameCell = document.createElement("td");
          const name = document.createElement("code");
          name.textContent = variable;
          nameCell.appendChild(name);
          tr.appendChild(nameCell);

          const valueCell = document.createElement("td");
          valueCell.className = "variables-preview-value";
          valueCell.textContent = values[variable] || "";
          valueCell.title = values[variable] || "";
          tr.appendChild(valueCell);

          table.appendChild(tr);
        });

        container.appendChild(table);
      });
    })
    .catch(() => {});
};
document.addEventListener("DOMContentLoaded", renderVariablesPreview);

const HISTORY_KEY = "save-in-history";

// Newest-first cache of the stored entries, and the current sort/filter/
// page state; the table re-renders from these without touching storage
let historyEntries = [];
let historySort = { key: "time", dir: "desc" };
let historyFilter = "";
let historyPage = 0;
const HISTORY_PAGE_SIZE = 50;

const historyFilename = (fullPath) => {
  if (!fullPath) {
    return "(unnamed)";
  }
  const parts = String(fullPath).split("/");
  return parts[parts.length - 1] || fullPath;
};

const historyFolder = (fullPath) => {
  if (!fullPath) {
    return "";
  }
  const idx = String(fullPath).lastIndexOf("/");
  return idx === -1 ? "." : fullPath.slice(0, idx);
};

const historyTime = (iso) => {
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso || "";
  }
};

// info.context holds a DOWNLOAD_TYPES value (MEDIA/LINK/PAGE/…); older
// entries kept the whole state, so fall back to state.info
const historyInfo = (entry) => entry.info || (entry.state && entry.state.info) || {};

const historyType = (entry) => {
  const context = historyInfo(entry).context;
  if (!context) {
    return "";
  }
  const c = String(context).toLowerCase();
  return c === "media" ? "image" : c;
};

// Older entries predate status tracking; treat them as complete
const historyStatus = (entry) => entry.status || "complete";

// "complete"/"pending" get friendly labels; a browser error name (e.g.
// SERVER_FORBIDDEN, NETWORK_FAILED) is shown lowercased
const historyStatusLabel = (status) => {
  if (status === "complete") {
    return "Saved";
  }
  if (status === "pending") {
    return "Saving…";
  }
  if (status === "failed") {
    return "Failed";
  }
  return status.toLowerCase().replace(/_/g, " ");
};

const historyStatusClass = (status) => {
  if (status === "complete") {
    return "status-ok";
  }
  if (status === "pending") {
    return "status-pending";
  }
  return "status-fail";
};

// Flatten an entry into the fields the table shows and sorts/filters on
const historyRow = (entry) => {
  const info = historyInfo(entry);
  return {
    time: entry.timestamp || "",
    status: historyStatus(entry),
    routed: entry.routed ? "routed" : "",
    type: historyType(entry),
    file: historyFilename(entry.finalFullPath),
    folder: historyFolder(entry.finalFullPath),
    fullPath: entry.finalFullPath || "",
    source: info.sourceUrl || entry.url || info.pageUrl || "",
    downloadId: typeof entry.downloadId === "number" ? entry.downloadId : null,
    size: typeof entry.fileSize === "number" ? entry.fileSize : null,
  };
};

// width is a percentage weight (the table is table-layout: fixed, so the
// header cells set the column widths)
const COLUMNS = [
  { key: "time", label: "Saved", sortable: true, width: "14%" },
  { key: "status", label: "Status", sortable: true, width: "10%" },
  { key: "size", label: "Size", sortable: true, width: "9%" },
  { key: "type", label: "Type", sortable: true, width: "6%" },
  { key: "routed", label: "Rule", sortable: true, width: "7%" },
  { key: "file", label: "File", sortable: true, width: "18%" },
  { key: "folder", label: "Folder", sortable: true, width: "16%" },
  { key: "source", label: "Source", sortable: false, width: "20%" },
];

// Human-readable byte count (SI units, matching the download notification)
const formatBytes = (n) => {
  if (n == null || n < 0) {
    return "";
  }
  if (n < 1000) {
    return `${n} B`;
  }
  if (n < 1000 * 1000) {
    return `${(n / 1000).toFixed(1)} KB`;
  }
  if (n < 1000 * 1000 * 1000) {
    return `${(n / 1000 / 1000).toFixed(1)} MB`;
  }
  return `${(n / 1000 / 1000 / 1000).toFixed(2)} GB`;
};

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
          const received = item.bytesReceived || 0;
          const total = item.totalBytes || 0;
          cell.textContent =
            total > 0 ? `${Math.floor((received / total) * 100)}%` : formatBytes(received);
          cell.setAttribute(
            "title",
            total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : "",
          );
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
  let rows = historyEntries.map(historyRow);
  const total = rows.length;

  if (query) {
    rows = rows.filter((r) =>
      [r.status, r.type, r.file, r.folder, r.source].some((v) => v.toLowerCase().includes(query)),
    );
  }

  rows.sort((a, b) => {
    const av = a[historySort.key];
    const bv = b[historySort.key];
    const cmp =
      historySort.key === "time"
        ? av.localeCompare(bv)
        : av.localeCompare(bv, undefined, { numeric: true });
    return historySort.dir === "asc" ? cmp : -cmp;
  });

  const matchCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(matchCount / HISTORY_PAGE_SIZE));
  if (historyPage >= pageCount) {
    historyPage = pageCount - 1;
  }
  const pageRows = rows.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE,
  );

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
  COLUMNS.forEach((col) => {
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
    time.textContent = historyTime(r.time);
    tr.appendChild(time);

    const status = document.createElement("td");
    status.className = "history-status";
    const badge = document.createElement("span");
    badge.className = `status-badge ${historyStatusClass(r.status)}`;
    badge.textContent = historyStatusLabel(r.status);
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
      size.textContent = formatBytes(r.size);
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

const renderHistory = async () => {
  const stored = (await browser.storage.local.get(HISTORY_KEY)) ?? {};
  historyEntries = (stored[HISTORY_KEY] || []).slice().reverse(); // newest first

  // Raw JSON stays available (some users import/inspect it); kept in sync
  /** @type {HTMLTextAreaElement} */
  const raw = document.querySelector("#history");
  if (raw) {
    raw.value = JSON.stringify(stored, null, 2);
  }

  renderHistoryTable();
};
document.addEventListener("DOMContentLoaded", renderHistory);

/** @type {HTMLInputElement} */
const historyFilterInput = document.querySelector("#history-filter");
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

const LOG_STORAGE_KEY = "si-log";

const updateDebugLog = async () => {
  /** @type {HTMLTextAreaElement} */
  const el = document.querySelector("#debug-log");
  if (!el) {
    return;
  }

  try {
    const res = await browser.storage.session.get(LOG_STORAGE_KEY);
    const entries = (res && res[LOG_STORAGE_KEY]) || [];
    el.value = entries.map((e) => [e.at, e.message, e.data].filter(Boolean).join("  ")).join("\n");
  } catch (e) {
    // storage.session unavailable (older browsers)
    el.value = "(debug log unavailable in this browser)";
  }
};
document.addEventListener("DOMContentLoaded", updateDebugLog);
document.querySelector("#debug-log-refresh")?.addEventListener("click", updateDebugLog);
document.querySelector("#debug-log-clear")?.addEventListener("click", () => {
  browser.storage.session
    .remove(LOG_STORAGE_KEY)
    .then(updateDebugLog)
    .catch(() => {});
});

browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "DOWNLOADED":
      updateErrors();
      renderHistory();
      renderVariablesPreview();
      updateDebugLog();
      break;
    default:
      break;
  }
});

const saveOptions = (e) => {
  if (e) {
    e.preventDefault();
  }
  pendingChanges = false;

  // Zip result -> schema
  getOptionsSchema.then((schema) => {
    const toSave = schema.keys.reduce((acc, val) => {
      const el = document.getElementById(val.name);
      if (!el) {
        return acc;
      }

      const propMap = {
        [schema.types.BOOL]: "checked",
        [schema.types.VALUE]: "value",
      };
      const fn = val.onSave || ((x) => x);
      const optionValue = fn(el[propMap[val.type]]);

      return Object.assign(acc, { [val.name]: optionValue });
    }, {});

    browser.storage.local.set(toSave).then(() => {
      // MV3 has no getBackgroundPage: ask the background to reload instead
      browser.runtime.sendMessage({ type: "OPTIONS_LOADED" });

      document.querySelector("#lastSavedAt").textContent = new Date().toLocaleTimeString();
    });
  });
};

// Set UI elements' value/checked
const restoreOptionsHandler = (result, schema) => {
  // Zip result -> schema
  const schemaWithValues = schema.keys.map((o) => Object.assign({}, o, { value: result[o.name] }));

  schemaWithValues.forEach((o) => {
    const el = document.getElementById(o.name);
    if (!el) {
      return;
    }

    const fn = o.onOptionsLoad || ((x) => x);
    const val = typeof o.value === "undefined" ? o.default : fn(o.value);

    const propMap = {
      [schema.types.BOOL]: "checked",
      [schema.types.VALUE]: "value",
    };
    el[propMap[o.type]] = val;
  });

  updateErrors();
  updateMenuPreview();
  // Stored values are now in the editors: they are clean, Apply dims
  refreshManualEditorBaselines();
};

const restoreOptions = () =>
  getOptionsSchema.then((schema) => {
    const keys = schema.keys.map((o) => o.name);
    browser.storage.local.get(keys).then((loaded) => restoreOptionsHandler(loaded, schema));
  });

const addHelp = (el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const targetEl = document.getElementById(el.dataset.helpFor);
    if (!targetEl) {
      return;
    }

    if (targetEl && !targetEl.classList.contains("show")) {
      el.scrollIntoView();
    }
    targetEl.classList.toggle("show");
  });
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelectorAll(".help").forEach(addHelp);

document.querySelector("#reset").addEventListener("click", (e) => {
  /* eslint-disable no-alert */
  e.preventDefault();

  const resetFn = (w) => {
    const reset = w.confirm("Reset settings to defaults?");

    if (reset) {
      browser.storage.local.clear().then(() => {
        browser.runtime.sendMessage({ type: "OPTIONS_LOADED" });

        document.querySelector("#lastSavedAt").textContent = new Date().toLocaleTimeString();

        restoreOptions();
        updateErrors();
        w.alert("Settings have been reset to defaults.");
      });
    }
  };
  /* eslint-enable no-alert */

  // On Chrome the options page opens in a tab (options_ui.open_in_tab),
  // so dialogs work on the local window in both browsers
  resetFn(window);
});

const setupChromeDisables = () => {
  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    document.querySelectorAll(".chrome-only").forEach((el) => {
      el.classList.toggle("show");
    });

    document.querySelectorAll(".chrome-enabled").forEach((el) => {
      el.removeAttribute("disabled");
    });

    document.querySelector("html").style = "min-width: 600px;";
    // document.querySelector("body").style = "overflow-y: hidden;";

    document.querySelectorAll(".chrome-disabled").forEach((/** @type {HTMLInputElement} */ el) => {
      el.disabled = true;
    });
  }
};

// Debouncing only textareas: every keystroke there previously triggered a
// full save -> OPTIONS_LOADED -> contextMenus.removeAll()+rebuild round
// trip, racing any context menu the user had open while typing a long
// path/pattern. Single-value fields (checkboxes/selects/number/text
// inputs) are cheap to save on every event and stay immediate.
const AUTOSAVE_DEBOUNCE_MS = 400;

// True between a textarea edit and the debounced save that persists it;
// closing the page or switching tabs in that window would drop the edit
let pendingChanges = false;
// Scheduled autosave timers, so a Discard can cancel them before they fire
const pendingSaveTimers = new Set();

window.addEventListener("beforeunload", (e) => {
  if (pendingChanges || anyManualEditorDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// The two large editors (#paths, #filenamePatterns) persist only via their
// Apply button, not autosave: their Apply lights up while the editor value
// differs from what is stored, and dims once applied. Every other control
// still autosaves.
const manualEditors = [];

const setupManualEditor = (id) => {
  /** @type {HTMLTextAreaElement} */
  const textarea = document.querySelector(`#${id}`);
  const buttons = [...document.querySelectorAll(`[data-apply="${id}"], [data-discard="${id}"]`)];
  if (!textarea || buttons.length === 0) {
    return;
  }

  const editor = { textarea, saved: textarea.value };
  manualEditors.push(editor);

  // Apply and Discard are both only actionable while the editor is dirty
  editor.sync = () => {
    const dirty = textarea.value !== editor.saved;
    buttons.forEach((b) => {
      b.toggleAttribute("disabled", !dirty);
    });
  };

  textarea.addEventListener("input", editor.sync);
  editor.sync();
};

// Re-baseline after a save or a storage restore: the editors now match
// what is stored, so they are clean
const refreshManualEditorBaselines = () => {
  manualEditors.forEach((editor) => {
    editor.saved = editor.textarea.value;
    editor.sync();
  });
};

const anyManualEditorDirty = () =>
  manualEditors.some((editor) => editor.textarea.value !== editor.saved);

// Called before an in-page tab switch (main tabs don't unload the page, so
// beforeunload never fires): prompt to save or discard editor changes that
// haven't been persisted yet. OK = save now, Cancel = revert to stored.
window.confirmPendingChanges = () => {
  if (!pendingChanges && !anyManualEditorDirty()) {
    return;
  }
  // Literal fallback: getMessage returns "" if the extension context was
  // invalidated (e.g. a reloaded dev build in a still-open tab), which
  // would otherwise show a text-less confirm dialog
  const message =
    browser.i18n.getMessage("optionsUnsavedChanges") ||
    "You have unsaved changes. OK to save them, or Cancel to discard.";
  // eslint-disable-next-line no-alert
  const save = window.confirm(message);
  if (save) {
    saveOptions();
  } else {
    pendingSaveTimers.forEach((t) => window.clearTimeout(t));
    pendingSaveTimers.clear();
    pendingChanges = false;
    restoreOptions();
  }
};

const setupAutosave = (el) => {
  // The two big editors save manually via Apply, not autosave
  if (el.dataset && el.dataset.manual === "true") {
    return;
  }

  let debounceTimer = null;

  // Tied to the actual save firing (not every keystroke), so it still
  // reflects when a save really happened once debounced.
  const showSavedIndicator = () => {
    // Anchor the check to the row's .opt-title (content-width, wrapped below) so
    // it sits right after the label text; fall back to the label / the field.
    const label = el.closest("label");
    const title = label && label.querySelector(":scope > .opt-title");
    const target = el.type === "textarea" ? el : title || el.parentNode;
    target.classList.remove("saved");
    window.setTimeout(() => {
      target.classList.add("saved-base");
      target.classList.add("saved");
    }, 100);
  };

  const doSave = (e) => {
    saveOptions(e);
    window.setTimeout(updateErrors, 200);
    showSavedIndicator();
  };

  if (el.type === "textarea") {
    el.addEventListener("input", () => {
      pendingChanges = true;
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        pendingSaveTimers.delete(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        pendingSaveTimers.delete(debounceTimer);
        debounceTimer = null;
        doSave();
      }, AUTOSAVE_DEBOUNCE_MS);
      pendingSaveTimers.add(debounceTimer);
    });

    // Flush on blur so a quick click-away right after typing isn't lost
    el.addEventListener("blur", () => {
      if (debounceTimer === null) {
        return;
      }
      window.clearTimeout(debounceTimer);
      pendingSaveTimers.delete(debounceTimer);
      debounceTimer = null;
      doSave();
    });
  } else if (["text", "number"].includes(el.type)) {
    el.addEventListener("input", doSave);
  } else {
    el.addEventListener("change", doSave);
  }
};

// Live context-menu tree preview: mirrors what the paths textarea will
// produce, updating as the user types (before autosave persists it)
const MENU_PREVIEW_DEBOUNCE_MS = 250;

const renderMenuPreview = (container, tree) => {
  container.textContent = "";

  const rootUl = document.createElement("ul");
  const listsByParent = new Map();

  tree.items.forEach((item) => {
    const parentUl = listsByParent.get(item.parentId) || rootUl;
    const li = document.createElement("li");

    if (item.kind === "separator") {
      li.className = "menu-preview-separator";
      li.appendChild(document.createElement("hr"));
    } else {
      li.className = "menu-preview-item";

      // The row (title + dir) is a flex box so the submenu ul drops below
      // it as a block; hover highlights just the row
      const row = document.createElement("div");
      row.className = "menu-preview-row";

      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = item.title;
      row.appendChild(title);

      // Aliased items also show the directory they save into
      if (item.title !== item.parsedDir) {
        const dir = document.createElement("span");
        dir.className = "menu-preview-dir";
        dir.textContent = item.parsedDir;
        row.appendChild(dir);
      }

      // Any row jumps to its line in the editor (the row only, so clicking a
      // nested child jumps to the child, not its parent)
      if (item.raw) {
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.title = "Jump to this line";
        const jump = () => jumpToError("#paths", item.raw);
        row.addEventListener("click", jump);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jump();
          }
        });
      }

      li.appendChild(row);

      const childUl = document.createElement("ul");
      li.appendChild(childUl);
      listsByParent.set(item.id, childUl);
    }

    parentUl.appendChild(li);
  });

  // Mirror the real menu: the Last Used slot and its separator sit above
  // the configured paths when the option is enabled
  /** @type {HTMLInputElement} */
  const lastUsed = document.querySelector("#enableLastLocation");
  if (lastUsed && lastUsed.checked) {
    const sep = document.createElement("li");
    sep.className = "menu-preview-separator";
    sep.appendChild(document.createElement("hr"));
    rootUl.insertBefore(sep, rootUl.firstChild);

    const li = document.createElement("li");
    li.className = "menu-preview-item menu-preview-lastused";
    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = browser.i18n.getMessage("contextMenuLastUsed");
    row.appendChild(title);
    li.appendChild(row);
    rootUl.insertBefore(li, rootUl.firstChild);
  }

  // Invalid paths can't be a menu item, so show them as a red row in place (in
  // the submenu they'd belong to). The row shows the offending line; the message
  // is a tooltip. Click jumps to (and selects) the line in the editor.
  tree.errors.forEach((error) => {
    const parentUl = (error.parentId && listsByParent.get(error.parentId)) || rootUl;
    const li = document.createElement("li");
    li.className = "menu-preview-item menu-preview-error";
    li.title = error.message;
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");

    const row = document.createElement("div");
    row.className = "menu-preview-row";
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = error.error;
    row.appendChild(title);
    li.appendChild(row);

    const jump = () => jumpToError("#paths", error.error);
    li.addEventListener("click", jump);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });

    parentUl.appendChild(li);
  });

  container.appendChild(rootUl);
};

const updateMenuPreview = () => {
  /** @type {HTMLTextAreaElement} */
  const textarea = document.querySelector("#paths");
  const container = document.querySelector("#menu-preview-tree");
  if (!textarea || !container) {
    return;
  }

  browser.runtime
    .sendMessage({ type: "PREVIEW_MENUS", body: { paths: textarea.value } })
    .then((response) => {
      if (response && response.body) {
        renderMenuPreview(container, response.body);
      }
    })
    .catch(() => {}); // background not awake yet; the next input retries
};

(() => {
  const textarea = document.querySelector("#paths");
  if (!textarea) {
    return;
  }

  // The Last Used slot in the preview follows its checkbox
  document
    .querySelector("#enableLastLocation")
    ?.addEventListener("change", () => updateMenuPreview());

  let previewTimer = null;
  textarea.addEventListener("input", () => {
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      updateMenuPreview();
      renderValidationErrors();
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
})();

// The rules editor has no menu preview, but its error panel should still update
// live as you type — same as the paths editor above.
(() => {
  const rulesTa = document.querySelector("#filenamePatterns");
  if (!rulesTa) {
    return;
  }
  let timer = null;
  rulesTa.addEventListener("input", () => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      renderValidationErrors();
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
})();

setupManualEditor("paths");
setupManualEditor("filenamePatterns");

// Click-to-open combobox for the click-to-save key: a dropdown of named keys
// that still accepts a free-form keyCode (backward compat — the content script
// resolves a name OR a number). A native <datalist> doesn't reliably open on
// click, so this is a small custom one.
(() => {
  const input = document.querySelector("#contentClickToSaveCombo");
  const wrap = input instanceof HTMLElement ? input.closest(".combo-wrap") : null;
  if (!(input instanceof HTMLInputElement) || !wrap) {
    return;
  }

  const OPTIONS = [
    { value: "", label: "No key — mouse button only" },
    { value: "Alt", label: "Alt / Option" },
    { value: "Ctrl", label: "Control" },
    { value: "Shift", label: "Shift" },
    { value: "Meta", label: "Command / Windows key" },
  ];

  const dropdown = document.createElement("ul");
  dropdown.className = "combo-dropdown autocomplete-dropdown";
  dropdown.hidden = true;
  wrap.appendChild(dropdown);

  let activeIndex = -1;
  const rows = () => [...dropdown.querySelectorAll("li")];

  const highlight = (i) => {
    activeIndex = i;
    rows().forEach((li, idx) => li.classList.toggle("selected", idx === i));
  };

  const close = () => {
    dropdown.hidden = true;
    activeIndex = -1;
  };

  const choose = (value) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  // filter=false (focus/click) shows every option; filter=true (typing) narrows
  const open = (filter) => {
    const q = filter ? input.value.trim().toLowerCase() : "";
    const matched = OPTIONS.filter(
      (o) => !q || o.value.toLowerCase().startsWith(q) || o.label.toLowerCase().includes(q),
    );
    const list = matched.length ? matched : OPTIONS;
    dropdown.innerHTML = "";
    list.forEach((o) => {
      const li = document.createElement("li");
      const v = document.createElement("span");
      v.className = "combo-value";
      v.textContent = o.value || "None";
      const l = document.createElement("span");
      l.className = "combo-label";
      l.textContent = o.label;
      li.append(v, l);
      li.dataset.value = o.value;
      // preventDefault keeps focus on the input (the click doesn't blur it), so
      // the dropdown stays closed after choosing rather than reopening on focus
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(o.value);
      });
      dropdown.appendChild(li);
    });
    activeIndex = -1;
    dropdown.hidden = false;
  };

  input.addEventListener("focus", () => open(false));
  input.addEventListener("click", () => open(false));
  input.addEventListener("input", () => open(true));
  input.addEventListener("blur", () => window.setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (dropdown.hidden) {
      if (e.key === "ArrowDown") {
        open(false);
      }
      return;
    }
    const items = rows();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      choose(items[activeIndex].dataset.value);
    }
  });
})();

// Wrap each checkbox row's title (label text + any inline badges, up to the
// first help / sub-option block) in a .opt-title span. It becomes the row's
// first body-column cell, so the autosave check anchors right after the text
// regardless of the help length below. Text nodes are moved, not recreated, so
// the l10n walker still substitutes their __MSG_ placeholders in place.
document.querySelectorAll('label:has(> input[type="checkbox"])').forEach((label) => {
  const checkbox = label.querySelector(":scope > input[type=checkbox]");
  if (!checkbox || label.querySelector(":scope > .opt-title")) {
    return;
  }
  const title = document.createElement("span");
  title.className = "opt-title";
  let node = checkbox.nextSibling;
  while (node) {
    const next = node.nextSibling;
    if (node instanceof Element && node.matches(".caption, .caption-line")) {
      break;
    }
    title.appendChild(node);
    node = next;
  }
  checkbox.after(title);
});

["textarea", "input", "select"].forEach((type) => {
  document.querySelectorAll(type).forEach((el) => {
    // The quick-add rule builder owns its own fields (rule-builder.js); they are
    // not options, so autosave here would flash a stray "saved" check over them.
    if (el.closest(".rule-builder")) {
      return;
    }
    setupAutosave(el);
  });
});

// Clicking the help text or sub-option area inside a checkbox row must not
// toggle that row's checkbox — only the checkbox or its main label text should.
// The help lives inside the <label> (so it aligns via the row grid), so cancel
// the label's implicit toggle when a click lands on plain help text. Real
// controls, links, and nested sub-option labels still work (clicking a labelable
// element inside a label never toggles the ancestor checkbox anyway).
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) {
    return;
  }
  // The blank stretch of a full-width checkbox row: the click lands on the
  // <label> element itself (its title text lives in .opt-title, the checkbox is
  // the input), so clicking empty space used to toggle the box. Only the
  // checkbox and its title should toggle it.
  if (e.target.tagName === "LABEL" && e.target.querySelector(":scope > input[type=checkbox]")) {
    e.preventDefault();
    return;
  }
  const help = e.target.closest(".caption, .caption-line");
  if (!help) {
    return;
  }
  // A control/link/sub-option label/disclosure *inside* the help region handles
  // its own click (and never toggles the ancestor checkbox); only cancel the
  // toggle for plain help text. `summary` matters here: a <details> can live in
  // a checkbox label's help (e.g. the Prefer-links filter), and cancelling its
  // click would stop it opening. The outer label is an ancestor of `help`, not
  // inside it, so it is correctly ignored here.
  const interactive = e.target.closest("a, button, input, select, textarea, label, summary");
  if (interactive && help.contains(interactive)) {
    return;
  }
  const label = help.closest("label");
  if (label && label.querySelector(":scope > input[type=checkbox]")) {
    e.preventDefault();
  }
});

// Apply: persist the manual editors, re-baseline (dims Apply/Discard),
// and refresh the validation + preview panes
document.querySelectorAll("[data-apply]").forEach((button) => {
  button.addEventListener("click", () => {
    saveOptions();
    refreshManualEditorBaselines();
    window.setTimeout(() => {
      updateErrors();
      updateMenuPreview();
      renderVariablesPreview();
    }, 200);
    const original = button.textContent;
    button.textContent = "✓";
    window.setTimeout(() => {
      button.textContent = original;
    }, 900);
  });
});

// Discard: revert the editor to its stored value without saving
document.querySelectorAll("[data-discard]").forEach((/** @type {HTMLElement} */ button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.discard;
    const editor = manualEditors.find((ed) => ed.textarea.id === id);
    if (!editor) {
      return;
    }
    editor.textarea.value = editor.saved;
    editor.textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    updateMenuPreview();
  });
});

const showJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  /** @type {HTMLTextAreaElement} */
  const outputEl = document.querySelector("#export-target");
  outputEl.style = "display: unset;";
  outputEl.value = json;
};

document.querySelector("#settings-export").addEventListener("click", () => {
  getOptionsSchema.then((schema) => {
    const keys = schema.keys.map((o) => o.name);
    browser.storage.local.get(keys).then((loaded) => showJson(loaded));
  });
});

const importSettings = () => {
  const load = (w) => {
    getOptionsSchema.then((schema) => {
      const json = w.prompt("Paste settings to import");
      try {
        if (json) {
          const settings = JSON.parse(json);
          restoreOptionsHandler(settings, schema);
          // Programmatic value assignment doesn't fire input/change, so
          // persist explicitly — otherwise the import shows in the form but
          // is never saved or applied to the background
          saveOptions();
          w.alert("Settings loaded.");
        }
      } catch (e) {
        w.alert(`Failed to load settings ${e}`);
      }
    });
  };

  load(window);
};
document.querySelector("#settings-import").addEventListener("click", importSettings);

// Detection can complete synchronously (Chrome), so this must be defined
// after setupChromeDisables
const waitForBrowserDetection = () => {
  if (CURRENT_BROWSER === "UNKNOWN") {
    setTimeout(waitForBrowserDetection, 10);
  } else {
    setupChromeDisables();
  }
};
waitForBrowserDetection();
