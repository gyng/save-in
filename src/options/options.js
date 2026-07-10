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
  const el = document.querySelector("#version-label");
  if (!el) {
    return;
  }

  const version = browser.runtime.getManifest().version;
  el.textContent = `v${version}`;

  fetch("version.json")
    .then((res) => res.json())
    .then(({ commit }) => {
      el.textContent = `v${version} (${commit})`;
    })
    .catch(() => {});
};
document.addEventListener("DOMContentLoaded", renderVersionLabel);

const updateHistory = async () => {
  // Copied from history.js
  const HISTORY_KEY = "save-in-history";
  const history = (await browser.storage.local.get(HISTORY_KEY)) ?? {};
  /** @type {HTMLTextAreaElement} */
  const el = document.querySelector("#history");
  el.value = JSON.stringify(history, null, 2);
};
document.addEventListener("DOMContentLoaded", updateHistory);

const deleteHistory = () => {
  const HISTORY_KEY = "save-in-history";
  // eslint-disable-next-line
  const answer = window.confirm("Delete all history?");
  if (answer) {
    browser.storage.local.remove(HISTORY_KEY).then(updateHistory);
  }
};
document.querySelector("#history-delete")?.addEventListener("click", deleteHistory);

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
      updateHistory();
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
  if (pendingChanges) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// Called before an in-page tab switch (main tabs don't unload the page, so
// beforeunload never fires): prompt to save or discard editor changes that
// haven't been persisted yet. OK = save now, Cancel = revert to stored.
window.confirmPendingChanges = () => {
  if (!pendingChanges) {
    return;
  }
  // eslint-disable-next-line no-alert
  const save = window.confirm(browser.i18n.getMessage("optionsUnsavedChanges"));
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

      const title = document.createElement("span");
      title.className = "menu-preview-title";
      title.textContent = item.title;
      li.appendChild(title);

      // Aliased items also show the directory they save into
      if (item.title !== item.parsedDir) {
        const dir = document.createElement("span");
        dir.className = "menu-preview-dir";
        dir.textContent = item.parsedDir;
        li.appendChild(dir);
      }

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
    const title = document.createElement("span");
    title.className = "menu-preview-title";
    title.textContent = browser.i18n.getMessage("contextMenuLastUsed");
    li.appendChild(title);
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

["textarea", "input", "select"].forEach((type) => {
  document.querySelectorAll(type).forEach(setupAutosave);
});

// Explicit apply: autosave already persists (debounced for textareas);
// these buttons save immediately and refresh the validation + preview panes
document.querySelectorAll("[data-apply]").forEach((button) => {
  button.addEventListener("click", () => {
    saveOptions();
    window.setTimeout(() => {
      updateErrors();
      updateMenuPreview();
    }, 200);
    const original = button.textContent;
    button.textContent = "✓";
    window.setTimeout(() => {
      button.textContent = original;
    }, 900);
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
