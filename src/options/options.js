function saveOptions(e) {
  e.preventDefault();

  browser.storage.local.set({
    links: document.querySelector('#links').checked,
    paths: document.querySelector('#paths').value.trim(),
  });

  browser.contextMenus.removeAll();
  browser.runtime.reload();
}

function restoreOptions() {
  browser.storage.local.get(['links', 'paths'])
    .then((result) => {
      document.querySelector('#links').checked = result.links || false;
      document.querySelector('#paths').value = result.paths || '';
    });
}

function addHelp(e) {
  e.addEventListener('click', () => {
    document.getElementById(e.dataset.helpFor).classList.toggle('show');
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector('#options').addEventListener('submit', saveOptions);
document.querySelectorAll('.help').forEach(addHelp);
