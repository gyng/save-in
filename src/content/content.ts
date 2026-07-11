import { toggleSourcePanel } from "./source-panel.ts";

// Runs in every page. Uses callback-style chrome.* APIs: available in both
// Chrome and Firefox content scripts (no polyfill is loaded here). try/catch
// guards cover the extension being reloaded underneath the page
// ("Extension context invalidated").

type ContentOptions = {
  contentClickToSave?: boolean;
  contentClickToSaveCombo?: string | number | null;
  contentClickToSaveButton?: string;
  links?: boolean;
};

const ClickToSave = {
  isKeyboardComboActive: (combo: number[], activeKeys: Record<number, boolean>) =>
    combo.map((code) => activeKeys[code]).every((code) => code === true),

  // https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
  // buttons is a bitmask of the buttons currently held; check the target's bit
  isMouseButtonActive: (target: string, buttons: number) => {
    const bit = {
      LEFT_CLICK: 1, // bit 0
      RIGHT_CLICK: 2, // bit 1
      MIDDLE_CLICK: 4, // bit 2
      BACK_CLICK: 8, // bit 3 (mouse button 4)
      FORWARD_CLICK: 16, // bit 4 (mouse button 5)
    }[target];
    // eslint-disable-next-line no-bitwise
    return Boolean(bit) && (buttons & bit!) === bit;
  },

  // Resolve the stored combo option to keyCodes. Accepts a raw keyCode number
  // (old stored values — backward compat), a key name (Alt/Ctrl/Shift/Meta),
  // or "none"/blank. Unknown / non-positive values drop out so the combo can be
  // empty — an empty combo is always active (the mouse button alone saves).
  comboToKeyCodes: (value: string | number | null | undefined): number[] => {
    const names: Record<string, number> = {
      alt: 18,
      option: 18,
      ctrl: 17,
      control: 17,
      shift: 16,
      meta: 91,
      cmd: 91,
      command: 91,
      win: 91,
      windows: 91,
      super: 91,
    };
    return ([] as (string | number | null | undefined)[])
      .concat(value)
      .map((v) => {
        const key = String(v == null ? "" : v)
          .trim()
          .toLowerCase();
        if (key in names) {
          return names[key];
        }
        const num = Number(v);
        return Number.isFinite(num) ? num : 0;
      })
      .filter((k) => k > 0);
  },

  // Resolves what to download for a click: media under the cursor first
  // (e.target can be an overlay), then the enclosing link (#226)
  findSource: (e: any, allowLinks: boolean): string | undefined => {
    let source;

    if (document.elementsFromPoint) {
      document.elementsFromPoint(e.clientX, e.clientY).some((el: any) => {
        source = el["currentSrc"] || el["src"]; // undefined for non-media elements
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

  // Attached below; declared here so TypeScript allows the assignment
  setupClickToSave: undefined as unknown as (options: ContentOptions) => void,
};

const setupClickToSave = (options: ContentOptions) => {
  const shortcutOptions = {
    combo: ClickToSave.comboToKeyCodes(options.contentClickToSaveCombo),
    button: options.contentClickToSaveButton,
  };

  let active: Record<number, boolean> = {};

  // Retries cover the MV3 service worker still starting up on first send
  const sendDownload = (source: string, retries = 2) => {
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
        },
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
          chrome.runtime.sendMessage({ type: "WAKE_WARM" }, () => chrome.runtime.lastError);
        } catch (err) {
          // Extension context invalidated
        }
      }
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      active[e.keyCode] = false;
    },
    true,
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
        ClickToSave.isMouseButtonActive(shortcutOptions.button!, e.buttons) &&
        ClickToSave.isKeyboardComboActive(shortcutOptions.combo, active)
      ) {
        const source = ClickToSave.findSource(e, options.links!);

        if (source) {
          e.preventDefault();
          e.stopImmediatePropagation();
          sendDownload(source);
        }
      }
    },
    true,
  );
};

ClickToSave.setupClickToSave = setupClickToSave;

try {
  chrome.runtime.sendMessage({ type: "OPTIONS" }, (response) => {
    if (!response || !response.body) {
      return;
    }

    const options = response.body;

    if (options.contentClickToSave) {
      setupClickToSave(options);
    }
  });
} catch (e) {
  // Extension context invalidated (extension reloaded/updated underneath us)
}

try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "TOGGLE_SOURCE_PANEL") return;
    toggleSourcePanel(({ url, kind }) => {
      chrome.runtime.sendMessage({
        type: "DOWNLOAD",
        body: { url, info: { pageUrl: `${window.location}`, srcUrl: url, sourceKind: kind } },
      });
    });
  });
} catch {
  // Extension context invalidated.
}

export default ClickToSave;
