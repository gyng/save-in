try {
  chrome.runtime.sendMessage({ type: "OPTIONS" }, (response) => {
    if (!response || !response.body) return;

    const options = response.body;

    if (options.contentClickToSave) {
      let active = {};

      const sendDownload = (url, retries = 2) => {
        try {
          chrome.runtime
            .sendMessage({
              type: "DOWNLOAD",
              body: {
                url,
                info: { pageUrl: `${window.location}`, srcUrl: url },
              },
            })
            .catch(() => {
              if (retries > 0) {
                setTimeout(() => sendDownload(url, retries - 1), 300);
              }
            });
        } catch {
          if (retries > 0) {
            setTimeout(() => sendDownload(url, retries - 1), 300);
          }
        }
      };

      window.addEventListener(
        "keydown",
        (e) => {
          active[e.keyCode] = true;
          chrome.runtime.sendMessage({ type: "WAKE_WARM" }).catch(() => {});
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

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          active = {};
        }
      });

      window.addEventListener(
        "mousedown",
        (e) => {
          const combo = [].concat(options.contentClickToSaveCombo);
          const comboActive = combo.every((code) => active[code]);
          const btn = e.buttons;
          const btnType = options.contentClickToSaveButton;

          const buttonMatch =
            (btn === 1 && btnType === "LEFT_CLICK") ||
            // eslint-disable-next-line no-bitwise
            (btn >> 1 === 1 && btnType === "RIGHT_CLICK") ||
            // eslint-disable-next-line no-bitwise
            (btn >> 2 === 1 && btnType === "MIDDLE_CLICK");

          if (comboActive && buttonMatch) {
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
            if (source) {
              e.preventDefault();
              e.stopImmediatePropagation();
              sendDownload(source);
            }
          }
        },
        true
      );
    }
  });
} catch {
  // Extension context invalidated
}
