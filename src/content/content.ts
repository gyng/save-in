import {
  replaceSourcePanel,
  setSourcePanelOpen,
  toggleSourcePanel,
  type PageSource,
} from "./source-panel.ts";
import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_OPTION_KEYS,
  CONTENT_STORAGE_KEYS,
  contentClickComboToKeyCodes,
  normalizeContentOption,
  resolveContentOptions,
  type ContentOptionName,
  type ContentOptions,
  type ResolvedContentOptions,
} from "../config/content-options.ts";
import {
  DEFAULT_SOURCE_PANEL_COPY,
  createSourcePanelCopy,
  isSourcePanelCopy,
  type SourcePanelCopy,
} from "../shared/source-panel-copy.ts";
import {
  createAutoDownloadDedup,
  setupAutoDownloadDiscovery,
  type AutoDownloadDedup,
  type AutoDownloadSendResult,
} from "./auto-download.ts";
import { matchesAnyPattern } from "../shared/match-pattern.ts";
import type { AutomaticRoutingCandidate } from "../automation/automatic-routing.ts";

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
  ): { url: string; kind: PageSource["kind"] } | undefined => {
    let source: { url: string; kind: PageSource["kind"] } | undefined;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    // Report the element's kind so a saved click carries its true source kind:
    // the `sourcekind:` routing matcher and the source sidecar both read it.
    const mediaSource = (
      element: unknown,
    ): { url: string; kind: PageSource["kind"] } | undefined => {
      let kind: "image" | "video" | "audio";
      if (element instanceof HTMLVideoElement) kind = "video";
      else if (element instanceof HTMLAudioElement) kind = "audio";
      else if (element instanceof HTMLImageElement) kind = "image";
      else return undefined;
      const candidate = element.currentSrc || element.src;
      return /^(https?|ftp|blob|data):/i.test(candidate) ? { url: candidate, kind } : undefined;
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
        source = { url: href, kind: "link" };
      }
    }

    return source;
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
): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "DOWNLOAD", body }, (response) => {
        if (chrome.runtime.lastError) {
          if (retries > 0 && !lifecycle?.signal.aborted) {
            const timer = window.setTimeout(() => {
              lifecycle?.retryTimers.delete(timer);
              void sendRuntimeDownload(body, retries - 1, lifecycle).then(resolve);
            }, 300);
            lifecycle?.retryTimers.add(timer);
            return;
          }
          resolve(false);
          return;
        }
        resolve(response?.type === "DOWNLOAD" && response.body?.status === "OK");
      });
    } catch {
      // Extension context invalidated while the page remained alive.
      resolve(false);
    }
  });

type ResolvedClickToSaveOptions = Pick<
  ResolvedContentOptions,
  "contentClickToSaveCombo" | "contentClickToSaveButton" | "links"
>;
type ResolvedAutoDownloadOptions = Pick<
  ResolvedContentOptions,
  | "autoDownloadLive"
  | "autoDownloadLinks"
  | "autoDownloadDocuments"
  | "autoDownloadBackgrounds"
  | "autoDownloadManifests"
  | "autoDownloadDataUrls"
  | "autoDownloadMaxPerPage"
> & { filenamePatterns: string };
type ResolvedContentScriptOptions = ResolvedContentOptions & ResolvedAutoDownloadOptions;

const setupClickToSave = (
  options: ResolvedClickToSaveOptions,
  acceptInput: (event: KeyboardEvent | MouseEvent) => boolean = (event) => event.isTrusted,
  isDisabled: () => boolean = () => false,
) => {
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
      if (!acceptInput(e)) return;
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
      if (!acceptInput(e)) return;
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
      if (!acceptInput(e)) return;
      // Enforced at click time against the live URL so a single-page-app
      // navigation onto or off the disable list takes effect immediately.
      if (isDisabled()) return;
      if (
        ClickToSave.isMouseButtonActive(shortcutOptions.button, e.buttons) &&
        ClickToSave.isKeyboardComboActive(shortcutOptions.combo, active)
      ) {
        const source = ClickToSave.findSource(e, options.links);

        if (source) {
          e.preventDefault();
          e.stopImmediatePropagation();
          void sendRuntimeDownload(
            {
              url: source.url,
              info: {
                pageUrl: `${window.location}`,
                srcUrl: source.url,
                sourceKind: source.kind,
              },
            },
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

const setupAutoDownload = (options: ResolvedAutoDownloadOptions, dedup: AutoDownloadDedup) => {
  const controller = new AbortController();
  const retryTimers = new Set<number>();
  const pendingResolvers = new Set<(result: AutoDownloadSendResult) => void>();
  const send = (
    candidate: AutomaticRoutingCandidate,
    retries = 2,
  ): Promise<AutoDownloadSendResult> =>
    new Promise((resolve) => {
      if (controller.signal.aborted) {
        resolve("skipped");
        return;
      }
      pendingResolvers.add(resolve);
      const finish = (result: AutoDownloadSendResult) => {
        pendingResolvers.delete(resolve);
        resolve(result);
      };
      try {
        chrome.runtime.sendMessage(
          { type: "AUTO_DOWNLOAD_SOURCE", body: candidate },
          (response) => {
            const failed = Boolean(chrome.runtime.lastError);
            if (failed && retries > 0 && !controller.signal.aborted) {
              const timer = window.setTimeout(() => {
                retryTimers.delete(timer);
                void send(candidate, retries - 1).then(finish);
              }, 300);
              retryTimers.add(timer);
              return;
            }
            const status = response?.body?.status;
            finish(["started", "skipped", "failed"].includes(status) ? status : "skipped");
          },
        );
      } catch {
        finish("skipped");
      }
    });

  const discovery = setupAutoDownloadDiscovery({
    rules: options.filenamePatterns,
    live: options.autoDownloadLive,
    maxPerPage: options.autoDownloadMaxPerPage,
    includeLinks: options.autoDownloadLinks,
    includeDocuments: options.autoDownloadDocuments,
    includeBackgrounds: options.autoDownloadBackgrounds,
    resourceHints: options.autoDownloadManifests,
    includeDataUrls: options.autoDownloadDataUrls,
    isPageDisabled: isCurrentPageDisabled,
    send,
    dedup,
  });
  return () => {
    controller.abort();
    discovery.stop();
    retryTimers.forEach((timer) => window.clearTimeout(timer));
    retryTimers.clear();
    pendingResolvers.forEach((resolve) => resolve("skipped"));
    pendingResolvers.clear();
  };
};

let currentOptions: ResolvedContentScriptOptions = {
  ...CONTENT_OPTION_DEFAULTS,
  filenamePatterns: "",
};
let removeClickToSave: (() => void) | null = null;
let removeAutoDownload: (() => void) | null = null;
// Owned per page load, not per discovery mount, so remounts cannot re-send
// sources this page already saved (see AutoDownloadDedup).
let autoDownloadDedup: AutoDownloadDedup = createAutoDownloadDedup();
let receivedInitialOptions = false;
let sourcePanelListenerReady = false;
let announcedSourcePanelReady = false;
let reconfigureOpenSourcePanel: (() => void) | null = null;

// The per-site disable list turns off every content-script surface on matching
// pages. Feature mounts follow their own options; this predicate is re-evaluated
// at action time against the live URL so a single-page-app navigation that moves
// on or off the list takes effect without an options change. Invalid pattern
// lines are ignored rather than treated as a broad match.
const isCurrentPageDisabled = (): boolean =>
  matchesAnyPattern(`${window.location}`, currentOptions.perSiteDisableList);

// Readiness is evaluated when options arrive or change; a pushState
// navigation off the disable list cannot re-trigger it (content scripts get
// no navigation event), so such a page announces only after a reload or the
// next option change.
const announceSourcePanelReady = () => {
  if (
    !receivedInitialOptions ||
    !sourcePanelListenerReady ||
    announcedSourcePanelReady ||
    isCurrentPageDisabled() ||
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
  // Features mount by their own options; the disable list is enforced at action
  // time. A changed list still re-runs the open-panel gate so newly matching the
  // current page closes an open panel.
  const disableListChanged = previous.perSiteDisableList !== currentOptions.perSiteDisableList;
  const clickOptionsChanged = (
    ["contentClickToSave", "contentClickToSaveCombo", "contentClickToSaveButton", "links"] as const
  ).some((key) => previous[key] !== currentOptions[key]);
  // A disable-list change remounts discovery so removing the site from the
  // list resumes automatic saves without a reload — but the dedup state
  // survives that remount, so nothing already saved is re-sent.
  const autoDownloadConfigChanged = (
    [
      "autoDownloadEnabled",
      "filenamePatterns",
      "autoDownloadLive",
      "autoDownloadLinks",
      "autoDownloadDocuments",
      "autoDownloadBackgrounds",
      "autoDownloadManifests",
      "autoDownloadDataUrls",
      "autoDownloadMaxPerPage",
    ] as const
  ).some((key) => previous[key] !== currentOptions[key]);
  const autoDownloadOptionsChanged = disableListChanged || autoDownloadConfigChanged;
  const sourcePanelOptionsChanged =
    disableListChanged ||
    (
      [
        "sourcePanelEnabled",
        "sourcePanelBackgrounds",
        "sourcePanelLive",
        "sourcePanelPreviews",
        "sourcePanelResourceHints",
        "sourcePanelLinks",
        "uiLocale",
        "uiTheme",
      ] as const
    ).some((key) => previous[key] !== currentOptions[key]);
  if (sourcePanelOptionsChanged) reconfigureOpenSourcePanel?.();
  if (autoDownloadOptionsChanged) {
    // Rule, limit, and toggle edits reset the dedup state (the 4.0 contract:
    // edited rules apply to media already on the page); a disable-list-only
    // edit keeps it, so toggling an unrelated site cannot re-download
    // everything this page already saved.
    if (autoDownloadConfigChanged) autoDownloadDedup = createAutoDownloadDedup();
    removeAutoDownload?.();
    removeAutoDownload =
      currentOptions.autoDownloadEnabled && currentOptions.filenamePatterns.trim()
        ? setupAutoDownload(currentOptions, autoDownloadDedup)
        : null;
  }
  if (clickOptionsChanged) {
    removeClickToSave?.();
    removeClickToSave = currentOptions.contentClickToSave
      ? setupClickToSave(currentOptions, undefined, isCurrentPageDisabled)
      : null;
  }
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
    if ("filenamePatterns" in changes) {
      if (!receivedInitialOptions) changedDuringRead.add("filenamePatterns");
      const value = changes.filenamePatterns?.newValue;
      changed.filenamePatterns = typeof value === "string" ? value : "";
    }
    if (Object.keys(changed).length > 0) {
      applyOptions(changed);
    }
  });

  chrome.storage.local.get([...CONTENT_STORAGE_KEYS], (stored) => {
    // Reading lastError suppresses Chrome's unchecked-error log if an update
    // invalidated this long-lived content-script context during the read.
    void chrome.runtime.lastError;
    const snapshot = resolveContentOptions(stored);
    const unchangedSnapshot: ContentOptions = {};
    CONTENT_OPTION_KEYS.forEach((key) => {
      if (!changedDuringRead.has(key)) setContentOption(unchangedSnapshot, key, snapshot[key]);
    });
    if (!changedDuringRead.has("filenamePatterns")) {
      unchangedSnapshot.filenamePatterns =
        typeof stored.filenamePatterns === "string" ? stored.filenamePatterns : "";
    }
    applyOptions(unchangedSnapshot);
    receivedInitialOptions = true;
    announceSourcePanelReady();
  });
} catch (e) {
  // Extension context invalidated (extension reloaded/updated underneath us)
  receivedInitialOptions = true;
}

try {
  const sendDownload = ({ url, kind }: PageSource) =>
    sendRuntimeDownload({
      url,
      info: { pageUrl: `${window.location}`, srcUrl: url, sourceKind: kind },
    });
  const createAutomaticRule = ({ url, kind }: PageSource): Promise<void> =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "CREATE_SOURCE_RULE", body: { sourceUrl: url, sourceKind: kind } },
          () => {
            void chrome.runtime.lastError;
            resolve();
          },
        );
      } catch {
        resolve();
      }
    });
  const resolvedPanelCopies = new Map<string, SourcePanelCopy>();
  const nativePanelCopy = () =>
    createSourcePanelCopy((key, substitutions) => chrome.i18n.getMessage(key, substitutions));
  const loadPanelCopy = (locale: string): Promise<SourcePanelCopy> => {
    const cached = resolvedPanelCopies.get(locale);
    if (cached) return Promise.resolve(cached);
    if (!locale || locale === "en") {
      const copy = nativePanelCopy();
      resolvedPanelCopies.set(locale, copy);
      return Promise.resolve(copy);
    }
    return new Promise<SourcePanelCopy>((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "SOURCE_PANEL_COPY" }, (response) => {
          void chrome.runtime.lastError;
          resolve(
            response?.type === "SOURCE_PANEL_COPY" && isSourcePanelCopy(response.body)
              ? response.body
              : DEFAULT_SOURCE_PANEL_COPY,
          );
        });
      } catch {
        resolve(DEFAULT_SOURCE_PANEL_COPY);
      }
    }).then((copy) => {
      resolvedPanelCopies.set(locale, copy);
      return copy;
    });
  };
  let sourcePanelIsOpen = false;
  let sourcePanelForcedOpen = false;
  let panelLocalizationQueue = Promise.resolve();
  const createPanelOptions = (copy: SourcePanelCopy, locale: string) => ({
    enabled: currentOptions.sourcePanelEnabled === true,
    includeBackgrounds: currentOptions.sourcePanelBackgrounds !== false,
    live: currentOptions.sourcePanelLive !== false,
    previews: currentOptions.sourcePanelPreviews !== false,
    resourceHints: currentOptions.sourcePanelResourceHints !== false,
    includeLinks: currentOptions.sourcePanelLinks !== false,
    copy,
    locale:
      locale ||
      (typeof chrome.i18n.getUILanguage === "function" ? chrome.i18n.getUILanguage() : ""),
    theme: currentOptions.uiTheme,
    onSaveIntent: warmBackground,
    onCreateRule: createAutomaticRule,
    onOpenChange: (open: boolean) => {
      sourcePanelIsOpen = open;
      if (!open) sourcePanelForcedOpen = false;
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
  const withPanelCopy = (action: (panelOptions: ReturnType<typeof createPanelOptions>) => void) => {
    const locale = currentOptions.uiLocale || "";
    const cached = resolvedPanelCopies.get(locale);
    if (cached) {
      action(createPanelOptions(cached, locale));
      return;
    }
    if (!locale || locale === "en") {
      const copy = nativePanelCopy();
      resolvedPanelCopies.set(locale, copy);
      action(createPanelOptions(copy, locale));
      return;
    }
    panelLocalizationQueue = panelLocalizationQueue
      .then(() => loadPanelCopy(locale))
      .then((copy) => {
        const activeLocale = currentOptions.uiLocale || "";
        if (activeLocale === locale) {
          action(createPanelOptions(copy, locale));
          return;
        }
        return loadPanelCopy(activeLocale).then((activeCopy) =>
          action(createPanelOptions(activeCopy, activeLocale)),
        );
      })
      .catch(() => {});
  };
  let panelPageWasDisabled: boolean | null = null;
  reconfigureOpenSourcePanel = () => {
    if (!sourcePanelIsOpen) {
      panelPageWasDisabled = null;
      return;
    }
    // Only a TRANSITION onto the disable list closes an open panel: a panel
    // force-opened on an already-disabled page (the explicit TOGGLE contract)
    // must survive unrelated option changes.
    const pageDisabled = isCurrentPageDisabled();
    const movedOntoDisableList = pageDisabled && panelPageWasDisabled === false;
    panelPageWasDisabled = pageDisabled;
    if (
      movedOntoDisableList ||
      (currentOptions.sourcePanelEnabled !== true && !sourcePanelForcedOpen)
    ) {
      setSourcePanelOpen(
        false,
        sendDownload,
        createPanelOptions(DEFAULT_SOURCE_PANEL_COPY, currentOptions.uiLocale || ""),
      );
      return;
    }
    withPanelCopy((panelOptions) =>
      replaceSourcePanel(
        sendDownload,
        sourcePanelForcedOpen ? { ...panelOptions, enabled: true } : panelOptions,
      ),
    );
  };
  chrome.runtime.onMessage.addListener((message) => {
    if (!["TOGGLE_SOURCE_PANEL", "SET_SOURCE_PANEL"].includes(message?.type)) return;
    // An explicit close (SET_SOURCE_PANEL open:false) is always honored.
    if (message.type === "SET_SOURCE_PANEL" && !message.body?.open) {
      setSourcePanelOpen(
        false,
        sendDownload,
        createPanelOptions(DEFAULT_SOURCE_PANEL_COPY, currentOptions.uiLocale || ""),
      );
      return;
    }
    // TOGGLE_SOURCE_PANEL is only sent by the context menu or keyboard command,
    // so it is an explicit user action that opens even a disabled page. An
    // ambient SET_SOURCE_PANEL open:true (background state restore) stays gated.
    if (message.type === "SET_SOURCE_PANEL" && isCurrentPageDisabled()) return;
    withPanelCopy((panelOptions) => {
      if (message.type === "SET_SOURCE_PANEL") {
        setSourcePanelOpen(true, sendDownload, panelOptions);
      } else {
        sourcePanelForcedOpen = message.body?.force === true;
        toggleSourcePanel(
          sendDownload,
          sourcePanelForcedOpen ? { ...panelOptions, enabled: true } : panelOptions,
        );
      }
      // Baseline for the transition-close rule: a panel opened on an
      // already-disabled page must not be closed by later unrelated option
      // changes, only by the page newly matching the list.
      panelPageWasDisabled = sourcePanelIsOpen ? isCurrentPageDisabled() : null;
    });
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
