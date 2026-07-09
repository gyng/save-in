// Runs in every page. Uses callback-style chrome.* APIs: available in both
// Chrome and Firefox content scripts (no polyfill is loaded here). try/catch
// guards cover the extension being reloaded underneath the page
// ("Extension context invalidated").

const ClickToSave = {
  isKeyboardComboActive: (combo, activeKeys) =>
    combo.map((code) => activeKeys[code]).every((code) => code === true),

  // https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
  isMouseButtonActive: (target, buttons) => {
    if (buttons === 1 && target === "LEFT_CLICK") {
      return true;
    }

    // eslint-disable-next-line no-bitwise
    if (buttons >> 1 === 1 && target === "RIGHT_CLICK") {
      return true;
    }

    // eslint-disable-next-line no-bitwise
    if (buttons >> 2 === 1 && target === "MIDDLE_CLICK") {
      return true;
    }

    return false;
  },

  // Resolves what to download for a click: media under the cursor first
  // (e.target can be an overlay), then the enclosing link (#226)
  findSource: (e, allowLinks) => {
    let source;

    if (document.elementsFromPoint) {
      document.elementsFromPoint(e.clientX, e.clientY).some((el) => {
        source = el.currentSrc || el.src;
        return !!source;
      });
    }

    if (!source) {
      source = e.target.currentSrc || e.target.src;
    }

    if (!source && allowLinks && e.target.closest) {
      const anchor = e.target.closest("a[href]");
      const href = anchor && anchor.href;
      if (href && /^(https?|ftp|blob|data):/i.test(href)) {
        source = href;
      }
    }

    return source || undefined;
  },
};

const setupClickToSave = (options) => {
  const shortcutOptions = {
    combo: [].concat(options.contentClickToSaveCombo),
    button: options.contentClickToSaveButton,
  };

  let active = {};

  // Retries cover the MV3 service worker still starting up on first send
  const sendDownload = (source, retries = 2) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "DOWNLOAD",
          body: {
            url: source,
            info: { pageUrl: `${window.location}`, srcUrl: source },
          },
        },
        () => {
          if (chrome.runtime.lastError && retries > 0) {
            setTimeout(() => sendDownload(source, retries - 1), 300);
          }
        }
      );
    } catch (e) {
      // Extension context invalidated (extension reloaded)
    }
  };

  window.addEventListener(
    "keydown",
    (e) => {
      active[e.keyCode] = true;

      // Wake the MV3 service worker as soon as the combo key is held so
      // it is warm by the time the click arrives
      if (shortcutOptions.combo.includes(e.keyCode)) {
        try {
          // Reading lastError stops Chrome logging an unchecked error
          chrome.runtime.sendMessage(
            { type: "WAKE_WARM" },
            () => chrome.runtime.lastError
          );
        } catch (err) {
          // Extension context invalidated
        }
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      active[e.keyCode] = false;
    },
    true
  );

  window.addEventListener("focus", () => {
    active = {};
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      active = {};
    }
  });

  window.addEventListener(
    "mousedown",
    (e) => {
      if (
        ClickToSave.isMouseButtonActive(shortcutOptions.button, e.buttons) &&
        ClickToSave.isKeyboardComboActive(shortcutOptions.combo, active)
      ) {
        const source = ClickToSave.findSource(e, options.links);

        if (source) {
          e.preventDefault();
          e.stopImmediatePropagation();
          sendDownload(source);
        }
      }
    },
    true
  );
};

try {
  chrome.runtime.sendMessage({ type: "OPTIONS" }, (response) => {
    if (!response || !response.body) {
      return;
    }

    const options = response.body;

    if (options.fetchViaContent) {
      chrome.runtime.onMessage.addListener((request) => {
        switch (request.type) {
          case "FETCH_VIA_CONTENT": {
            const url = request.body.state.info.url;

            const contentRequest = new Request(url, {
              method: "GET",
              credentials: "include",
              mode: "no-cors",
            });

            // Chrome doesn't support returning a promise from onMessage.addListener
            return fetch(contentRequest)
              .then((res) => res.blob())
              .then((blob) => ({
                type: "OK",
                body: {
                  blob,
                },
              }))
              .catch((error) => {
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
      setupClickToSave(options);
    }
  });
} catch (e) {
  // Extension context invalidated (extension reloaded/updated underneath us)
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = ClickToSave;
}
