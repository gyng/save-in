const saveOptions = e => {
  e.preventDefault();

  browser.storage.local.set({
    links: document.querySelector("#links").checked,
    paths: document.querySelector("#paths").value.trim()
  });

  browser.contextMenus.removeAll();
  browser.runtime.reload();
};

const restoreOptions = () => {
  browser.storage.local.get(["links", "paths"]).then(result => {
    document.querySelector("#links").checked = result.links || true;
    document.querySelector("#paths").value = result.paths || ".";
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
