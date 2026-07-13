import { setSourcePanelOpen, toggleSourcePanel, type PageSource } from "./source-panel.ts";
import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_OPTION_KEYS,
  contentClickComboToKeyCodes,
  normalizeContentOption,
  resolveContentOptions,
  type ContentOptions,
} from "../config/content-options.ts";

// Runs in every page. Uses callback-style chrome.* APIs: available in both
// Chrome and Firefox content scripts (no polyfill is loaded here). try/catch
// guards cover the extension being reloaded underneath the page
// ("Extension context invalidated").

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

  // Resolve the stored combo option to keyCodes. Raw keyCode numbers remain
  // backward compatible, while malformed strings fall back to Alt instead of
  // silently weakening the shortcut to mouse-button-only.
  comboToKeyCodes: contentClickComboToKeyCodes,

  // Resolves what to download for a click: media under the cursor first
  // (e.target can be an overlay), then the enclosing link (#226)
  findSource: (e: any, allowLinks: boolean): string | undefined => {
    let source;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];

    // Shadow-DOM retargeting can hide the actual media element from e.target.
    // Prefer the composed path, then retain the coordinate lookup for overlays.
    if (path.length > 0) {
      path.some((el: any) => {
        source = el && (el.currentSrc || el.src);
        return !!source;
      });
    }

    if (!source && document.elementsFromPoint) {
      document.elementsFromPoint(e.clientX, e.clientY).some((el: any) => {
        source = el["currentSrc"] || el["src"]; // undefined for non-media elements
        return !!source;
      });
    }

    if (!source) {
      source = e.target && (e.target.currentSrc || e.target.src);
    }

    if (!source && allowLinks) {
      const anchor =
        path.find((el: any) => el?.matches?.("a[href]")) || e.target?.closest?.("a[href]");
      const href = anchor && anchor.href;
      if (href && /^(https?|ftp|blob|data):/i.test(href)) {
        source = href;
      }
    }

    return source || undefined;
  },

  // Attached below; declared here so TypeScript allows the assignment
  setupClickToSave: undefined as unknown as (options: ContentOptions) => () => void,
};

const warmBackground = () => {
  try {
    // Reading lastError stops Chrome logging an unchecked error.
    chrome.runtime.sendMessage({ type: "WAKE_WARM" }, () => chrome.runtime.lastError);
  } catch {
    // Extension context invalidated while the page remained alive.
  }
};

type ContentDownloadRequest = {
  url: string;
  info: { pageUrl: string; srcUrl: string; sourceKind?: PageSource["kind"] };
};
type DownloadLifecycle = { signal: AbortSignal; retryTimers: Set<number> };

const sendRuntimeDownload = (
  body: ContentDownloadRequest,
  retries = 2,
  lifecycle?: DownloadLifecycle,
) => {
  if (lifecycle?.signal.aborted) return;
  try {
    chrome.runtime.sendMessage({ type: "DOWNLOAD", body }, () => {
      if (chrome.runtime.lastError && retries > 0) {
        const timer = window.setTimeout(() => {
          lifecycle?.retryTimers.delete(timer);
          sendRuntimeDownload(body, retries - 1, lifecycle);
        }, 300);
        lifecycle?.retryTimers.add(timer);
      }
    });
  } catch {
    // Extension context invalidated while the page remained alive.
  }
};

const setupClickToSave = (options: ContentOptions) => {
  const controller = new AbortController();
  const listenerOptions = { capture: true, signal: controller.signal };
  const shortcutOptions = {
    combo: ClickToSave.comboToKeyCodes(options.contentClickToSaveCombo),
    button: options.contentClickToSaveButton,
  };

  let active: Record<number, boolean> = {};
  const retryTimers = new Set<number>();
  const downloadLifecycle = { signal: controller.signal, retryTimers };

  const eventKeyCode = (e: KeyboardEvent) => {
    const named: Record<string, number> = { Alt: 18, Control: 17, Shift: 16, Meta: 91 };
    return named[e.key] || e.keyCode;
  };

  window.addEventListener(
    "keydown",
    (e) => {
      const code = eventKeyCode(e);
      const wasActive = active[code] === true;
      active[code] = true;

      // Wake the MV3 service worker as soon as the combo key is held so
      // it is warm by the time the click arrives
      if (!wasActive && shortcutOptions.combo.includes(code)) {
        warmBackground();
      }
    },
    listenerOptions,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      active[eventKeyCode(e)] = false;
    },
    listenerOptions,
  );

  const resetActive = () => {
    active = {};
  };
  window.addEventListener("focus", resetActive, { signal: controller.signal });
  window.addEventListener("blur", resetActive, { signal: controller.signal });
  window.addEventListener("pagehide", resetActive, { signal: controller.signal });

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        resetActive();
      }
    },
    { signal: controller.signal },
  );

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
          sendRuntimeDownload(
            { url: source, info: { pageUrl: `${window.location}`, srcUrl: source } },
            2,
            downloadLifecycle,
          );
        }
      }
    },
    listenerOptions,
  );

  return () => {
    controller.abort();
    retryTimers.forEach((timer) => window.clearTimeout(timer));
    retryTimers.clear();
  };
};

ClickToSave.setupClickToSave = setupClickToSave;

let currentOptions: ContentOptions = { ...CONTENT_OPTION_DEFAULTS };
let removeClickToSave: (() => void) | null = null;
let receivedInitialOptions = false;
let sourcePanelListenerReady = false;
let announcedSourcePanelReady = false;

const announceSourcePanelReady = () => {
  if (
    !receivedInitialOptions ||
    !sourcePanelListenerReady ||
    announcedSourcePanelReady ||
    currentOptions.sourcePanelEnabled !== true
  )
    return;
  announcedSourcePanelReady = true;
  try {
    chrome.runtime.sendMessage({ type: "SOURCE_PANEL_READY" }, () => chrome.runtime.lastError);
  } catch {
    // Extension context invalidated while the page remained alive.
  }
};

const applyOptions = (next: ContentOptions) => {
  const previous = currentOptions;
  currentOptions = { ...currentOptions, ...next };
  const clickOptionsChanged = (
    ["contentClickToSave", "contentClickToSaveCombo", "contentClickToSaveButton", "links"] as const
  ).some((key) => previous[key] !== currentOptions[key]);
  if (!clickOptionsChanged) {
    announceSourcePanelReady();
    return;
  }
  removeClickToSave?.();
  removeClickToSave = currentOptions.contentClickToSave ? setupClickToSave(currentOptions) : null;
  announceSourcePanelReady();
};

try {
  // Existing tabs outlive option-page changes and extension worker restarts.
  // storage.onChanged is additive and works with old backgrounds because it
  // does not require a new message type or atomic extension upgrade.
  const changedDuringRead = new Set<string>();
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const changed: ContentOptions = {};
    CONTENT_OPTION_KEYS.forEach((key) => {
      if (key in changes) {
        if (!receivedInitialOptions) changedDuringRead.add(key);
        changed[key] = normalizeContentOption(key, changes[key].newValue) as never;
      }
    });
    if (Object.keys(changed).length > 0) {
      applyOptions(changed);
    }
  });

  chrome.storage.local.get(CONTENT_OPTION_KEYS, (stored) => {
    // Reading lastError suppresses Chrome's unchecked-error log if an update
    // invalidated this long-lived content-script context during the read.
    void chrome.runtime.lastError;
    const snapshot = resolveContentOptions(stored);
    const unchangedSnapshot: ContentOptions = {};
    CONTENT_OPTION_KEYS.forEach((key) => {
      if (!changedDuringRead.has(key)) unchangedSnapshot[key] = snapshot[key] as never;
    });
    applyOptions(unchangedSnapshot);
    receivedInitialOptions = true;
    announceSourcePanelReady();
  });
} catch (e) {
  // Extension context invalidated (extension reloaded/updated underneath us)
  receivedInitialOptions = true;
}

try {
  chrome.runtime.onMessage.addListener((message) => {
    if (!["TOGGLE_SOURCE_PANEL", "SET_SOURCE_PANEL"].includes(message?.type)) return;
    const sendDownload = ({ url, kind }: PageSource) => {
      sendRuntimeDownload({
        url,
        info: { pageUrl: `${window.location}`, srcUrl: url, sourceKind: kind },
      });
    };
    const panelOptions = {
      enabled: currentOptions.sourcePanelEnabled === true,
      includeBackgrounds: currentOptions.sourcePanelBackgrounds !== false,
      live: currentOptions.sourcePanelLive !== false,
      previews: currentOptions.sourcePanelPreviews !== false,
      resourceHints: currentOptions.sourcePanelResourceHints !== false,
      includeLinks: currentOptions.sourcePanelLinks !== false,
      onSaveIntent: warmBackground,
      onOpenChange: (open: boolean) => {
        try {
          chrome.runtime.sendMessage(
            { type: "SOURCE_PANEL_STATE", body: { open } },
            () => chrome.runtime.lastError,
          );
        } catch {
          // Extension context invalidated while the page remained alive.
        }
      },
    };
    if (message.type === "SET_SOURCE_PANEL") {
      setSourcePanelOpen(Boolean(message.body?.open), sendDownload, panelOptions);
    } else {
      toggleSourcePanel(sendDownload, panelOptions);
    }
  });
  // Unlike timer retries in the service worker, this handshake is emitted
  // only after the receiving listener exists and reliably restores an open
  // panel after navigation or an extension worker restart.
  sourcePanelListenerReady = true;
  announceSourcePanelReady();
} catch {
  // Extension context invalidated.
}

export default ClickToSave;
