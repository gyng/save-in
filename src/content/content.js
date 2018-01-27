chrome.runtime.sendMessage(
  {
    type: "OPTIONS"
  },
  response => {
    if (!response || !response.body) {
      return;
    }

    const options = response.body;

    if (options.fetchViaContent) {
      chrome.runtime.onMessage.addListener(request => {
        switch (request.type) {
          case "FETCH_VIA_CONTENT": {
            const url = request.body.state.info.url;

            const contentRequest = new Request(url, {
              method: "GET",
              credentials: "include",
              mode: "no-cors"
            });

            // Chrome doesn't support returning a promise from onMessage.addListener
            return fetch(contentRequest)
              .then(res => res.blob())
              .then(blob => ({
                type: "OK",
                body: {
                  blob
                }
              }))
              .catch(error => {
                console.error(error); // eslint-disable-line
                return { type: "ERROR", body: { error } };
              });
          }
          default:
            break;
        }

        return null;
      });
    }

    if (options.contentClickToSave) {
      const setupKeyboardListeners = (shortcutOptions = { combo: [18] }) => {
        let active = {};

        const isComboActive = (combo, activeKeys) =>
          combo.map(code => activeKeys[code]).every(code => code === true);

        window.addEventListener("keydown", e => {
          active[e.keyCode] = true;
        });

        window.addEventListener("keyup", e => {
          active[e.keyCode] = false;
        });

        window.addEventListener("focus", () => {
          active = {};
        });

        window.addEventListener("click", e => {
          if (!e.target) {
            return;
          }

          if (isComboActive(shortcutOptions.combo, active)) {
            const source = e.target.currentSrc || e.target.src;

            if (source) {
              e.preventDefault();
              e.stopImmediatePropagation();

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
  }
);
