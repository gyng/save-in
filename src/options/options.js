let debugOptions;
const pathsErrors = document.querySelector("#error-paths");
const filenamePatternsErrors = document.querySelector(
  "#error-filenamePatterns"
);

const updateErrors = () => {
  window.setTimeout(() => {
    browser.runtime.getBackgroundPage().then(w => {
      filenamePatternsErrors.innerHTML = "";
      pathsErrors.innerHTML = "";
      const errors = w.optionErrors;

      const row = err => {
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
        errors.filenamePatterns.forEach(err => {
          filenamePatternsErrors.appendChild(row(err));
        });
      }

      if (errors.paths.length > 0) {
        errors.paths.forEach(err => {
          pathsErrors.appendChild(row(err));
        });
      }
    });
  }, 200);
};

const saveOptions = e => {
  e.preventDefault();

  browser.storage.local.set({
    conflictAction: document.querySelector("#conflictAction").value,
    debug: document.querySelector("#debug").checked,
    filenamePatterns: document.querySelector("#filenamePatterns").value.trim(),
    links: document.querySelector("#links").checked,
    notifyDuration: document.querySelector("#notifyDuration").value,
    notifyOnFailure: document.querySelector("#notifyOnFailure").checked,
    notifyOnRuleMatch: document.querySelector("#notifyOnRuleMatch").checked,
    notifyOnSuccess: document.querySelector("#notifyOnSuccess").checked,
    page: document.querySelector("#page").checked,
    paths: document.querySelector("#paths").value.trim() || ".\nimages\nvideos",
    prompt: document.querySelector("#prompt").checked,
    promptIfNoExtension: document.querySelector("#promptIfNoExtension").checked,
    replacementChar: document.querySelector("#replacementChar").value,
    routeExclusive: document.querySelector("#routeExclusive").checked,
    routeFailurePrompt: document.querySelector("#routeFailurePrompt").checked,
    selection: document.querySelector("#selection").checked,
    shortcutLink: document.querySelector("#shortcutLink").checked,
    shortcutMedia: document.querySelector("#shortcutMedia").checked,
    shortcutPage: document.querySelector("#shortcutPage").checked,
    shortcutType: document.querySelector("#shortcutType").value,
    truncateLength: document.querySelector("#truncateLength").value
  });

  browser.runtime.getBackgroundPage().then(w => {
    w.reset();
  });
};

const restoreOptionsHandler = result => {
  const setCheckboxElement = (id, defaultVal) => {
    document.querySelector(`#${id}`).checked =
      typeof result[id] === "undefined" ? defaultVal : result[id];
  };

  const setValueElement = (id, defaultVal) => {
    document.querySelector(`#${id}`).value =
      typeof result[id] === "undefined" ? defaultVal : result[id];
  };

  document.querySelector("#paths").value = result.paths || ".\nimages\nvideos";
  document.querySelector("#filenamePatterns").value =
    result.filenamePatterns || "";

  setCheckboxElement("routeFailurePrompt", false);
  setCheckboxElement("routeExclusive", false);
  setCheckboxElement("debug", false);
  setValueElement("conflictAction", "uniquify");
  setCheckboxElement("links", true);
  setCheckboxElement("selection", false);
  setCheckboxElement("page", false);
  setCheckboxElement("shortcutMedia", false);
  setCheckboxElement("shortcutLink", false);
  setCheckboxElement("shortcutPage", false);
  setValueElement("shortcutType", "HTML_REDIRECT");
  setCheckboxElement("prompt", false);
  setCheckboxElement("promptIfNoExtension", false);
  setCheckboxElement("notifyOnSuccess", false);
  setCheckboxElement("notifyOnRuleMatch", true);
  setCheckboxElement("notifyOnFailure", true);
  setValueElement("notifyDuration", 7000);
  setValueElement("truncateLength", 240);
  setValueElement("replacementChar", "_");

  debugOptions = result;
  updateErrors();
};

const restoreOptions = () => {
  browser.storage.local
    .get([
      "conflictAction",
      "debug",
      "filenamePatterns",
      "links",
      "notifyDuration",
      "notifyOnFailure",
      "notifyOnRuleMatch",
      "notifyOnSuccess",
      "page",
      "paths",
      "prompt",
      "promptIfNoExtension",
      "replacementChar",
      "routeExclusive",
      "routeFailurePrompt",
      "selection",
      "shortcutLink",
      "shortcutMedia",
      "shortcutPage",
      "shortcutType",
      "truncateLength"
    ])
    .then(restoreOptionsHandler);
};

const addHelp = el => {
  el.addEventListener("click", e => {
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

document.querySelector("#print-debug-info").addEventListener("click", () => {
  const navigatorInfo = {
    appVersion: navigator.appVersion,
    userAgent: navigator.userAgent,
    language: navigator.language
  };

  let str = "";
  const pp = obj => {
    str = str.concat("```json\n" + JSON.stringify(obj, null, 2) + "\n```\n"); // eslint-disable-line
  };
  const title = name => {
    str = str.concat(`\n#### ${name}\n\n`);
  };

  str = str.concat("<details><summary>Debug information</summary>\n");

  str = str.concat(`Generated ${new Date().toISOString()}\n`);

  title("Browser");
  pp(navigatorInfo);

  title("Options");
  pp(debugOptions);

  title("Extension");
  Promise.all([
    browser.management.getSelf().then(o => pp({ version: o.version })),
    browser.permissions.getAll().then(o => pp({ permissions: o.permissions })),
    browser.runtime.getBackgroundPage().then(p => {
      title("Globals");
      pp({
        optionErrors: p.optionErrors,
        lastUsedPath: p.lastUsedPath || "null"
      });
    })
  ]).then(() => {
    str = str.concat("</details>");
    const blob = new Blob([str], {
      encoding: "UTF-8",
      type: "text/plain;charset=UTF-8"
    });
    const fileObjectURL = URL.createObjectURL(blob);
    window.open(fileObjectURL);
  });
});

document.querySelector("#reset").addEventListener("click", e => {
  /* eslint-disable no-alert */
  e.preventDefault();

  if (browser === chrome) {
    browser.runtime.getBackgroundPage().then(w => {
      const reset = w.confirm("Reset settings to defaults?");

      if (reset) {
        browser.storage.local.clear().then(() => {
          restoreOptions();
          w.alert("Settings have been reset to defaults.");
          w.reset();
        });
      }
    });
  } else {
    const reset = confirm("Reset settings to defaults?");

    if (reset) {
      browser.storage.local.clear().then(() => {
        restoreOptions();
        alert("Settings have been reset to defaults.");
        browser.runtime.getBackgroundPage().then(w => {
          w.reset();
        });
      });
    }
  }
  /* eslint-enable no-alert */
});

if (browser === chrome) {
  document.querySelectorAll(".chrome-only").forEach(el => {
    el.classList.toggle("show");
  });

  document.querySelectorAll(".chrome-enabled").forEach(el => {
    el.removeAttribute("disabled");
  });

  document.querySelector("html").style = "min-width: 640px;";
}

const setupAutosave = el => {
  el.addEventListener("input", e => {
    saveOptions(e);
    updateErrors();

    if (el.type !== "textarea") {
      el.parentNode.classList.remove("saved");
      el.parentNode.classList.add("saved-base");
      el.parentNode.classList.add("saved");
    } else {
      el.classList.remove("saved");
      el.classList.add("saved-base");
      el.classList.add("saved");
    }
  });
};

["textarea", "input", "select"].forEach(type => {
  document.querySelectorAll(type).forEach(setupAutosave);
});

document.querySelectorAll(".popout").forEach(el => {
  el.addEventListener("click", () => {
    const target = el.dataset.popoutFor;
    window.open(target, null, "menubar=no,width=900,height=600,scrollbars=yes");
  });
});

const exportSettings = () => {
  const json = JSON.stringify(debugOptions, null, 2);
  const blob = new Blob([json], {
    encoding: "UTF-8",
    type: "application/json"
  });
  const fileObjectURL = URL.createObjectURL(blob);
  window.open(fileObjectURL);
};
document
  .querySelector("#settings-export")
  .addEventListener("click", exportSettings);

const importSettings = () => {
  const importField = document.querySelector("#settings-import-field");
  document.querySelector("#settings-import-error").innerHTML = "";
  document.querySelector("#settings-import-error").classList.add("hide");
  const json = importField.value; // eslint-disable-line
  let settings;

  try {
    if (!json) {
      document.querySelector("#settings-import-error").classList.remove("hide");
      throw new Error("Nothing to import");
    }
    settings = JSON.parse(json);
    restoreOptionsHandler(settings);
  } catch (e) {
    document.querySelector("#settings-import-error").classList.remove("hide");
    document.querySelector("#settings-import-error").textContent = e;
  }
};
document
  .querySelector("#settings-import")
  .addEventListener("click", importSettings);
