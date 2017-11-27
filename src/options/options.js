const saveOptions = e => {
  e.preventDefault();

  browser.storage.local.set({
    debug: document.querySelector("#debug").checked,
    links: document.querySelector("#links").checked,
    selection: document.querySelector("#selection").checked,
    page: document.querySelector("#page").checked,
    shortcut: document.querySelector("#shortcut").checked,
    shortcutType: document.querySelector("#shortcutType").value,
    paths: document.querySelector("#paths").value.trim() || ".",
    filenamePatterns: document.querySelector("#filenamePatterns").value.trim(),
    prompt: document.querySelector("#prompt").checked,
    promptIfNoExtension: document.querySelector("#promptIfNoExtension").checked,
    notifyOnSuccess: document.querySelector("#notifyOnSuccess").checked,
    notifyOnFailure: document.querySelector("#notifyOnFailure").checked,
    notifyDuration: document.querySelector("#notifyDuration").value
  });

  browser.contextMenus.removeAll();
  document.querySelector("body").innerHTML = "";
  browser.runtime.reload();
};

const restoreOptions = () => {
  browser.storage.local
    .get([
      "debug",
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
      "shortcut",
      "shortcutType"
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
      setCheckboxElement("links", true);
      setCheckboxElement("selection", false);
      setCheckboxElement("page", false);
      setCheckboxElement("shortcut", false);
      setValueElement("shortcutType", "HTML_REDIRECT");
      setCheckboxElement("prompt", false);
      setCheckboxElement("promptIfNoExtension", false);
      setCheckboxElement("notifyOnSuccess", false);
      setCheckboxElement("notifyOnFailure", true);
      setValueElement("notifyDuration", 7000);
    });
};

const addHelp = el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    document.getElementById(el.dataset.helpFor).classList.toggle("show");
  });
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#options").addEventListener("submit", saveOptions);
document.querySelectorAll(".help").forEach(addHelp);

if (browser === chrome) {
  document.querySelectorAll(".chrome-only").forEach(el => {
    el.classList.toggle("show");
  });
}
