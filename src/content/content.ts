import {
  replaceSourcePanel,
  setSourcePanelOpen,
  toggleSourcePanel,
  type PageSource,
} from "./source-panel.ts";
import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_OPTION_KEYS,
  contentClickComboToKeyCodes,
  normalizeContentOption,
  resolveContentOptions,
  type ContentOptionName,
  type ContentOptions,
  type ResolvedContentOptions,
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
    if (!bit) return false;
    return (buttons & bit) === bit;
  },

  // Resolve the stored combo option to keyCodes. Raw keyCode numbers remain
  // backward compatible, while malformed strings fall back to Alt instead of
  // silently weakening the shortcut to mouse-button-only.
  comboToKeyCodes: contentClickComboToKeyCodes,

  // Resolves what to download for a click: media under the cursor first
  // (e.target can be an overlay), then the enclosing link (#226)
  findSource: (
    e: {
      target: EventTarget | null;
      clientX: number;
      clientY: number;
      composedPath?: () => Array<EventTarget | null>;
    },
    allowLinks: boolean,
  ): string | undefined => {
    let source: string | undefined;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const mediaSource = (element: unknown): string | undefined => {
      if (!(element instanceof HTMLImageElement) && !(element instanceof HTMLMediaElement))
        return undefined;
      const candidate = element.currentSrc || element.src;
      return /^(https?|ftp|blob|data):/i.test(candidate) ? candidate : undefined;
    };

    // Shadow-DOM retargeting can hide the actual media element from e.target.
    // Prefer the composed path, then retain the coordinate lookup for overlays.
    if (path.length > 0) {
      path.some((el) => {
        source = mediaSource(el);
        return !!source;
      });
    }

    if (!source && document.elementsFromPoint) {
      document.elementsFromPoint(e.clientX, e.clientY).some((el) => {
        source = mediaSource(el);
        return !!source;
      });
    }

    if (!source) {
      source = mediaSource(e.target);
    }

    if (!source && allowLinks) {
      const pathAnchor = path.find(
        (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement && el.matches("a[href]"),
      );
      const targetAnchor =
        e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      const href = (pathAnchor ?? targetAnchor)?.href;
      if (href && /^(https?|ftp|blob|data):/i.test(href)) {
        source = href;
      }
    }

    return source || undefined;
  },
};

const setContentOption = <Name extends ContentOptionName>(
  target: ContentOptions,
  name: Name,
  value: ResolvedContentOptions[Name],
): void => {
  target[name] = value;
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

let currentOptions: ContentOptions = { ...CONTENT_OPTION_DEFAULTS };
let removeClickToSave: (() => void) | null = null;
let receivedInitialOptions = false;
let sourcePanelListenerReady = false;
let announcedSourcePanelReady = false;
let reconfigureOpenSourcePanel: (() => void) | null = null;

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
  const sourcePanelOptionsChanged = (
    [
      "sourcePanelEnabled",
      "sourcePanelBackgrounds",
      "sourcePanelLive",
      "sourcePanelPreviews",
      "sourcePanelResourceHints",
      "sourcePanelLinks",
      "sourcePanelTheme",
    ] as const
  ).some((key) => previous[key] !== currentOptions[key]);
  if (sourcePanelOptionsChanged) reconfigureOpenSourcePanel?.();
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
        const change = changes[key];
        if (change) setContentOption(changed, key, normalizeContentOption(key, change.newValue));
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
      if (!changedDuringRead.has(key)) setContentOption(unchangedSnapshot, key, snapshot[key]);
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
  const sendDownload = ({ url, kind }: PageSource) => {
    sendRuntimeDownload({
      url,
      info: { pageUrl: `${window.location}`, srcUrl: url, sourceKind: kind },
    });
  };
  const createPanelOptions = () => ({
    enabled: currentOptions.sourcePanelEnabled === true,
    includeBackgrounds: currentOptions.sourcePanelBackgrounds !== false,
    live: currentOptions.sourcePanelLive !== false,
    previews: currentOptions.sourcePanelPreviews !== false,
    resourceHints: currentOptions.sourcePanelResourceHints !== false,
    includeLinks: currentOptions.sourcePanelLinks !== false,
    theme: currentOptions.sourcePanelTheme || "system",
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
  });
  reconfigureOpenSourcePanel = () => {
    const panelOptions = createPanelOptions();
    if (panelOptions.enabled) replaceSourcePanel(sendDownload, panelOptions);
    else setSourcePanelOpen(false, sendDownload, panelOptions);
  };
  chrome.runtime.onMessage.addListener((message) => {
    if (!["TOGGLE_SOURCE_PANEL", "SET_SOURCE_PANEL"].includes(message?.type)) return;
    const panelOptions = createPanelOptions();
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

export default { ...ClickToSave, setupClickToSave };
