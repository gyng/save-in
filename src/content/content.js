chrome.runtime.sendMessage(
  {
    type: "OPTIONS"
  },
  response => {
    const isActive = options => options.contentClickToSave;

    if (!response || !response.body || !isActive(response.body)) {
      return;
    }

    const setupKeyboardListeners = (shortcutOptions = { combo: [18] }) => {
      const active = {};

      const isComboActive = (combo, activeKeys) =>
        combo.map(code => activeKeys[code]).every(code => code === true);

      window.addEventListener("keydown", e => {
        active[e.keyCode] = true;
      });

      window.addEventListener("keyup", e => {
        active[e.keyCode] = false;
      });

      window.addEventListener("click", e => {
        if (!e.target) {
          return;
        }

        if (isComboActive(shortcutOptions.combo, active)) {
          e.preventDefault();
          const source = e.target.currentSrc || e.target.src;

          if (source) {
            chrome.runtime.sendMessage({
              type: "DOWNLOAD",
              body: {
                url: source,
                info: { pageUrl: `${window.location}`, srcUrl: source }
              }
            });
          }
        }
      });
    };

    setupKeyboardListeners({
      combo: [].concat(response.body.contentClickToSaveCombo)
    });
  }
);
