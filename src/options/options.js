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

const updateErrors = () => {
  const pathsErrors = document.querySelector("#error-paths");
  const lastDlMatch = document.querySelector("#last-dl-match");
  const lastDlCapture = document.querySelector("#last-dl-capture");
  const rulesErrors = document.querySelector("#error-filenamePatterns");

  browser.runtime.sendMessage({ type: "CHECK_ROUTES" }).then(({ body }) => {
    rulesErrors.innerHTML = "";
    pathsErrors.innerHTML = "";

    const errors = body.optionErrors;

    const row = (err) => {
      const r = document.createElement("div");
      r.className = "error-row";

      const message = document.createElement("span");
      message.className = "error-message";
      message.textContent = err.message;
      r.appendChild(message);

      const error = document.createElement("span");
      error.className = "error-error";
      error.textContent = err.error;
      r.appendChild(error);

      return r;
    };

    if (errors.filenamePatterns.length > 0) {
      errors.filenamePatterns.forEach((err) => {
        rulesErrors.appendChild(row(err));
      });
    }

    if (errors.paths.length > 0) {
      errors.paths.forEach((err) => {
        pathsErrors.appendChild(row(err));
      });
    }

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
  };
};

const COLUMNS = [
  { key: "time", label: "Saved", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "routed", label: "Rule", sortable: true },
  { key: "file", label: "File", sortable: true },
  { key: "folder", label: "Folder", sortable: true },
  { key: "source", label: "Source", sortable: false },
];

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
    const target = el.type === "textarea" ? el : el.parentNode;
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

  tree.errors.forEach((error) => {
    const li = document.createElement("li");
    li.className = "menu-preview-error";
    li.textContent = `${error.error} — ${error.message}`;
    rootUl.appendChild(li);
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
    }, MENU_PREVIEW_DEBOUNCE_MS);
  });
})();

setupManualEditor("paths");
setupManualEditor("filenamePatterns");

["textarea", "input", "select"].forEach((type) => {
  document.querySelectorAll(type).forEach(setupAutosave);
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
