const saveOptions = e => {
  e.preventDefault();

  browser.storage.local.set({
    debug: document.querySelector("#debug").checked,
    conflictAction: document.querySelector("#conflictAction").value,
    links: document.querySelector("#links").checked,
    selection: document.querySelector("#selection").checked,
    page: document.querySelector("#page").checked,
    shortcutMedia: document.querySelector("#shortcutMedia").checked,
    shortcutLink: document.querySelector("#shortcutLink").checked,
    shortcutPage: document.querySelector("#shortcutPage").checked,
    shortcutType: document.querySelector("#shortcutType").value,
    paths: document.querySelector("#paths").value.trim() || ".",
    filenamePatterns: document.querySelector("#filenamePatterns").value.trim(),
    prompt: document.querySelector("#prompt").checked,
    promptIfNoExtension: document.querySelector("#promptIfNoExtension").checked,
    notifyOnSuccess: document.querySelector("#notifyOnSuccess").checked,
    notifyOnFailure: document.querySelector("#notifyOnFailure").checked,
    notifyDuration: document.querySelector("#notifyDuration").value,
    truncateLength: document.querySelector("#truncateLength").value
  });

  browser.contextMenus.removeAll();
  document.querySelector("body").innerHTML = "";
  browser.runtime.reload();
};

const restoreOptions = () => {
  browser.storage.local
    .get([
      "debug",
      "conflictAction",
      "links",
      "selection",
      "paths",
      "filenamePatterns",
      "prompt",
      "promptIfNoExtension",
      "notifyOnSuccess",
      "notifyOnFailure",
      "notifyDuration",
      "page",
      "shortcutMedia",
      "shortcutLink",
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

      document.querySelector("#paths").value = result.paths || ".";
      document.querySelector("#filenamePatterns").value =
        result.filenamePatterns || "";

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
      setCheckboxElement("notifyOnFailure", true);
      setValueElement("notifyDuration", 7000);
      setValueElement("truncateLength", 240);
    });
};

const addHelp = el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    const targetEl = document.getElementById(el.dataset.helpFor);
    if (!targetEl.classList.contains("show")) {
      el.scrollIntoView();
    }
    targetEl.classList.toggle("show");
  });
};

const addClickToCopy = el => {
  let clicked;

  el.title = `Click to copy ${el.textContent} to clipboard`; // eslint-disable-line

  el.addEventListener("click", () => {
    clicked = el;
    document.execCommand("copy");
  });

  document.addEventListener("copy", e => {
    if (clicked !== el) {
      return;
    }

    e.preventDefault();
    if (e.clipboardData) {
      e.clipboardData.setData("text/plain", el.textContent);
      clicked = null;
    }
  });
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#submit").addEventListener("click", () => {
  document.querySelector("#options").dispatchEvent(new Event("submit"));
});
document.querySelector("#options").addEventListener("submit", saveOptions);
document.querySelectorAll(".help").forEach(addHelp);
document.querySelectorAll(".click-to-copy").forEach(addClickToCopy);

document.querySelector("#reset").addEventListener("click", e => {
  /* eslint-disable no-alert */
  e.preventDefault();
  const reset =
    browser === chrome ? true : confirm("Reset settings to defaults?");

  if (reset) {
    browser.storage.local.clear().then(() => {
      restoreOptions();
      alert("Settings have been reset to defaults.");
      browser.runtime.reload();
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
}
