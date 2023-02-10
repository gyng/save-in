const getOptionsSchema = browser.runtime
  .sendMessage({ type: "OPTIONS_SCHEMA" })
  .then((res) => res.body);

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
      document.querySelector("#last-dl-url").textContent =
        body.lastDownload.info.url;
    }

    document
      .querySelector("#rules-applied-row")
      .classList.toggle("hide", !hasLastDownload);

    // Routing result
    lastDlMatch.innerHTML = "no matches";
    if (body.routeInfo.path) {
      lastDlMatch.textContent = body.routeInfo.path;
    }

    // Variables
    if (hasLastDownload) {
      document
        .querySelector("#variables-table-row")
        .classList.toggle("hide", !hasLastDownload);
    }
    document
      .querySelector("#see-variables-btn")
      .addEventListener("click", () => {
        if (body.interpolatedVariables) {
          const tableBody = document.querySelector("#variables-body");
          tableBody.classList.toggle("hide");
          tableBody.innerHTML = "";

          Object.keys(body.interpolatedVariables).forEach((key) => {
            const val = body.interpolatedVariables[key];

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
        }
      });

    // Capture groups
    const hasCaptureMatches =
      body.routeInfo && Array.isArray(body.routeInfo.captures);

    document
      .querySelector("#capture-group-rows")
      .classList.toggle("hide", !hasCaptureMatches);

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

const updateHistory = async () => {
  // Copied from history.js
  const HISTORY_KEY = "save-in-history";
  const history = await browser.storage.local.get(HISTORY_KEY) ?? {};
  const el = document.querySelector("#history");
  el.value = JSON.stringify(history, null, 2);
};
document.addEventListener("DOMContentLoaded", updateHistory);

const deleteHistory = () => {
  const HISTORY_KEY = "save-in-history";
  const answer = window.confirm("Delete all history?");
  if (answer) {
    browser.storage.local.remove(HISTORY_KEY).then(updateHistory);
  }
}
document.querySelector("#history-delete")?.addEventListener("click", deleteHistory);

browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "DOWNLOADED":
      updateErrors();
      updateHistory();
      break;
    default:
      break;
  }
});

const saveOptions = (e) => {
  if (e) {
    e.preventDefault();
  }

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
      browser.runtime.getBackgroundPage().then((w) => {
        w.reset();
      });

      document.querySelector("#lastSavedAt").textContent =
        new Date().toLocaleTimeString();
    });
  });
};

// Set UI elements' value/checked
const restoreOptionsHandler = (result, schema) => {
  // Zip result -> schema
  const schemaWithValues = schema.keys.map((o) =>
    Object.assign({}, o, { value: result[o.name] })
  );

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
};

const restoreOptions = () =>
  getOptionsSchema.then((schema) => {
    const keys = schema.keys.map((o) => o.name);
    browser.storage.local
      .get(keys)
      .then((loaded) => restoreOptionsHandler(loaded, schema));
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
        document.querySelector("#lastSavedAt").textContent =
          new Date().toLocaleTimeString();

        restoreOptions();
        updateErrors();
        w.alert("Settings have been reset to defaults.");
      });
    }
  };
  /* eslint-enable no-alert */

  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    browser.runtime.getBackgroundPage().then(resetFn);
  } else {
    resetFn(window);
  }
});

if (CURRENT_BROWSER === BROWSERS.CHROME) {
  document.querySelectorAll(".chrome-only").forEach((el) => {
    el.classList.toggle("show");
  });

  document.querySelectorAll(".chrome-enabled").forEach((el) => {
    el.removeAttribute("disabled");
  });

  document.querySelector("html").style = "min-width: 600px;";
  // document.querySelector("body").style = "overflow-y: hidden;";

  document.querySelectorAll(".chrome-disabled").forEach((el) => {
    el.disabled = true;
  });
}

const setupAutosave = (el) => {
  const autosaveCb = (e) => {
    saveOptions(e);
    window.setTimeout(updateErrors, 200);

    if (el.type !== "textarea") {
      el.parentNode.classList.remove("saved");
      window.setTimeout(() => {
        el.parentNode.classList.add("saved-base");
        el.parentNode.classList.add("saved");
      }, 100);
    } else {
      el.classList.remove("saved");
      window.setTimeout(() => {
        el.classList.add("saved-base");
        el.classList.add("saved");
      }, 100);
    }
  };

  if (["textarea", "text", "number"].includes(el.type)) {
    el.addEventListener("input", autosaveCb);
  } else {
    el.addEventListener("change", autosaveCb);
  }
};

["textarea", "input", "select"].forEach((type) => {
  document.querySelectorAll(type).forEach(setupAutosave);
});

document.querySelectorAll(".popout").forEach((el) => {
  el.addEventListener("click", () => {
    const target = el.dataset.popoutFor;
    window.open(target, null, "menubar=no,width=940,height=600,scrollbars=yes");
  });
});

const showJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
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
          w.alert("Settings loaded.");
        }
      } catch (e) {
        w.alert(`Failed to load settings ${e}`);
      }
    });
  };

  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    browser.runtime.getBackgroundPage().then(load);
  } else {
    load(window);
  }
};
document
  .querySelector("#settings-import")
  .addEventListener("click", importSettings);
