const saveOptions = e => {
  e.preventDefault();

  browser.storage.local.set({
    links: document.querySelector("#links").checked,
    paths: document.querySelector("#paths").value.trim() || ".",
    filenamePatterns: document.querySelector("#filenamePatterns").value.trim(),
    prompt: document.querySelector("#prompt").checked,
    promptIfNoExtension: document.querySelector("#promptIfNoExtension").checked,
    notifyOnSuccess: document.querySelector("#notifyOnSuccess").checked,
    notifyOnFailure: document.querySelector("#notifyOnFailure").checked,
    notifyDuration: document.querySelector("#notifyDuration").value
  });

  browser.contextMenus.removeAll();
  browser.runtime.reload();
};

const restoreOptions = () => {
  browser.storage.local
    .get([
      "links",
      "paths",
      "filenamePatterns",
      "prompt",
      "promptIfNoExtension",
      "notifyOnSuccess",
      "notifyOnFailure",
      "notifyDuration"
    ])
    .then(result => {
      document.querySelector("#links").checked =
        typeof result.links === "undefined" ? true : result.links;

      document.querySelector("#prompt").checked =
        typeof result.prompt === "undefined" ? false : result.prompt;

      document.querySelector("#promptIfNoExtension").checked =
        typeof result.promptIfNoExtension === "undefined"
          ? false
          : result.promptIfNoExtension;

      document.querySelector("#paths").value = result.paths || ".";

      document.querySelector("#filenamePatterns").value =
        result.filenamePatterns || "";

      document.querySelector("#notifyOnSuccess").checked =
        typeof result.notifyOnSuccess === "undefined"
          ? false
          : result.notifyOnSuccess;

      document.querySelector("#notifyOnFailure").checked =
        typeof result.notifyOnFailure === "undefined"
          ? false
          : result.notifyOnFailure;

      document.querySelector("#notifyDuration").value =
        typeof result.notifyDuration === "undefined"
          ? 7000
          : result.notifyDuration;
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
