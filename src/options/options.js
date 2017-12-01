let debugOptions;
const filenamePatternsErrors = document.querySelector(
  "#error-filenamePatterns"
);

const updateErrors = () => {
  window.setTimeout(() => {
    browser.runtime.getBackgroundPage().then(w => {
      filenamePatternsErrors.innerHTML = "";
      const errors = w.optionErrors;

      if (errors.filenamePatterns.length > 0) {
        errors.filenamePatterns.forEach(err => {
          const row = document.createElement("div");
          row.className = "error-row";
          row.textContent = `${err.message}: ${err.error}`;
          filenamePatternsErrors.appendChild(row);
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
    .then(result => {
      const setCheckboxElement = (id, defaultVal) => {
        document.querySelector(`#${id}`).checked =
          typeof result[id] === "undefined" ? defaultVal : result[id];
      };

      const setValueElement = (id, defaultVal) => {
        document.querySelector(`#${id}`).value =
          typeof result[id] === "undefined" ? defaultVal : result[id];
      };

      document.querySelector("#paths").value =
        result.paths || ".\nimages\nvideos";
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
    });
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

  const doc = window.open().document;
  const pp = obj => {
    doc.write("```json\n" + JSON.stringify(obj, null, 2) + "\n```\n\n"); // eslint-disable-line
  };
  const title = name => {
    doc.write(`\n\n#### ${name}\n\n`);
  };

  doc.write("<pre>&lt;details>&lt;summary>Debug information&lt;/summary>\n");

  doc.write(`Generated ${new Date().toISOString()}\n`);

  title("Browser");
  pp(navigatorInfo);

  title("Options");
  pp(debugOptions);

  title("Last runtime error");
  pp(browser.runtime.lastError);

  title("Extension");

  Promise.all([
    browser.management.getSelf().then(o => pp({ version: o.version })),
    browser.permissions.getAll().then(o => pp({ permissions: o.permissions }))
  ]).then(() => {
    doc.write("&lt;/details></pre>");
  });
});

document.querySelector("#reset").addEventListener("click", e => {
  /* eslint-disable no-alert */
  e.preventDefault();
  const reset =
    browser === chrome ? true : confirm("Reset settings to defaults?");

  if (reset) {
    browser.storage.local.clear().then(() => {
      restoreOptions();
      alert("Settings have been reset to defaults.");
      browser.runtime.getBackgroundPage().then(w => {
        w.reset();
      });
    });
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
