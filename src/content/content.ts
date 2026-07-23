import {
  replaceSourcePanel,
  setSourcePanelOpen,
  toggleSourcePanel,
  type PageSource,
} from "./source-panel.ts";
import {
  CONTENT_OPTION_DEFAULTS,
  CONTENT_LONG_PRESS_DEFAULT_MS,
  CONTENT_OPTIONS_CHANGED_MESSAGE,
  CONTENT_OPTION_KEYS,
  CONTENT_STORAGE_KEYS,
  contentClickComboToKeyCodes,
  normalizeContentOptionsPatch,
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
import { matchesAnyPatternOrUnreadable } from "../shared/match-pattern.ts";
import type { AutomaticRoutingCandidate } from "../automation/automatic-routing.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import type { RoutingRule } from "../routing/rule-types.ts";
import { isDataUrl, isDataUrlWithinCap } from "../shared/data-url.ts";
import {
  CLICK_GESTURES,
  resolveClickToSaveBindings,
  type ClickGesture,
} from "../shared/click-gesture.ts";
import {
  createDoubleClickTracker,
  createFollowUpSuppressor,
  createLongClickReleaseSuppressor,
  createLongPressTracker,
  isSingleGestureButton,
} from "./click-gesture-model.ts";
import { parseRegularExpressionList } from "../shared/pattern-list.ts";
import { configureContentPorts } from "./ports.ts";
import {
  cssSelectorsForRules,
  matchedCssSelectorsByOrigin,
  sourceOriginElements,
} from "./css-routing.ts";
import { contextLinkMetadataFromEvent } from "./context-link-metadata.ts";
import {
  CONTEXT_LINK_METADATA_REQUEST,
  parseContextLinkMetadata,
  type ContextLinkMetadata,
} from "../shared/context-link-metadata.ts";

declare const SAVE_IN_CONTENT_E2E: boolean;

// Runs in every page. Uses callback-style chrome.* APIs: available in both
// Chrome and Firefox content scripts (no polyfill is loaded here). try/catch
// guards cover the extension being reloaded underneath the page
// ("Extension context invalidated").

// This file is the content bundle's entry, so it composes the layer before
// anything below it runs, as the background and options entries do.
configureContentPorts();

const ClickToSave = {
  isKeyboardComboActive: (combo: number[], activeKeys: Record<number, boolean>) =>
    combo.map((code) => activeKeys[code]).every((code) => code === true),

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
    preferLink = false,
  ): { url: string; kind: PageSource["kind"]; element: Element } | undefined => {
    const withElement = (
      url: string,
      kind: PageSource["kind"],
      element: Element,
    ): { url: string; kind: PageSource["kind"]; element: Element } => {
      const result = { url, kind, element };
      // Keep findSource's established enumerable {url, kind} shape for callers
      // while retaining the DOM origin for routing inside this content script.
      Object.defineProperty(result, "element", { enumerable: false });
      return result;
    };
    let source: { url: string; kind: PageSource["kind"]; element: Element } | undefined;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    // Report the element's kind so a saved click carries its true source kind:
    // the `sourcekind:` routing matcher and the source sidecar both read it.
    const mediaSource = (
      element: unknown,
    ): { url: string; kind: PageSource["kind"]; element: Element } | undefined => {
      let kind: "image" | "video" | "audio";
      if (element instanceof HTMLVideoElement) kind = "video";
      else if (element instanceof HTMLAudioElement) kind = "audio";
      else if (element instanceof HTMLImageElement) kind = "image";
      else return undefined;
      const candidate = element.currentSrc || element.src;
      return /^(https?|ftp|blob|data):/i.test(candidate) &&
        (!isDataUrl(candidate) || isDataUrlWithinCap(candidate))
        ? withElement(candidate, kind, element)
        : undefined;
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

    if (allowLinks) {
      const pathAnchor = path.find(
        (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement && el.matches("a[href]"),
      );
      const targetAnchor =
        e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      const sourceAnchor = source?.element.closest<HTMLAnchorElement>("a[href]");
      const anchor = pathAnchor ?? targetAnchor ?? sourceAnchor;
      const href = anchor?.href;
      if (
        href &&
        /^(https?|ftp|blob|data):/i.test(href) &&
        (!isDataUrl(href) || isDataUrlWithinCap(href))
      ) {
        if (!source || preferLink) source = withElement(href, "link", anchor);
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
  info: {
    pageUrl: string;
    srcUrl: string;
    sourceKind?: PageSource["kind"];
    gesture?: ClickGesture;
    linkTitle?: string;
    linkDownload?: string;
    matchedCssSelectorsByOrigin?: string[][];
  };
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
> &
  Partial<
    Pick<
      ResolvedContentOptions,
      | "contentClickToSaveLongPressMs"
      | "preferLinks"
      | "preferLinksFilterEnabled"
      | "preferLinksFilter"
    >
  > & { contentClickToSaveBindings?: string; filenamePatterns?: string };
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
// Chrome can enqueue click after mouseup in a later task under load. Keep a
// bounded grace period if release produces no click (for example after detach).
const LONG_CLICK_SUPPRESSION_TTL_MS = 5000;

const setupClickToSave = (
  options: ResolvedClickToSaveOptions,
  acceptInput: (event: KeyboardEvent | MouseEvent) => boolean = (event) => event.isTrusted,
  isDisabled: () => boolean = () => false,
  sharedLongReleaseSuppression?: ReturnType<typeof createLongClickReleaseSuppressor>,
) => {
  const routingRules = parseRulesCollecting(options.filenamePatterns ?? "").rules;
  const cssSelectors = cssSelectorsForRules(routingRules);
  const preferLinkPatterns = options.preferLinksFilterEnabled
    ? parseRegularExpressionList(options.preferLinksFilter ?? "")
    : null;
  const preferLinkAtCurrentPage = (): boolean =>
    options.preferLinks === true ||
    (preferLinkPatterns?.issues.length === 0 &&
      preferLinkPatterns.entries.some(({ value }) => value.test(`${window.location}`)));
  const controller = new AbortController();
  const listenerOptions = { capture: true, signal: controller.signal };
  const shortcutOptions = resolveClickToSaveBindings(
    options.contentClickToSaveBindings,
    options.contentClickToSaveCombo,
    options.contentClickToSaveButton,
  ).map((binding) => ({ ...binding, keyCodes: contentClickComboToKeyCodes(binding.combo) }));

  let active: Record<number, boolean> = {};
  const retryTimers = new Set<number>();
  const downloadLifecycle = { signal: controller.signal, retryTimers };
  type ClickSource = NonNullable<ReturnType<typeof ClickToSave.findSource>>;
  const doubleClick = createDoubleClickTracker<ClickSource>(
    (first, second) =>
      first.element === second.element && first.url === second.url && first.kind === second.kind,
  );
  let suppressDoubleClickOn: Element | null = null;
  const longReleaseSuppression =
    sharedLongReleaseSuppression ??
    createLongClickReleaseSuppressor(LONG_CLICK_SUPPRESSION_TTL_MS, {
      set: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clear: (timer) => window.clearTimeout(timer),
    });
  const ownsLongReleaseSuppression = sharedLongReleaseSuppression === undefined;
  const followUps = createFollowUpSuppressor();
  type ShortcutBinding = (typeof shortcutOptions)[number];
  type LongPressCandidate = {
    binding: ShortcutBinding;
    source: ClickSource;
    linkMetadata: ContextLinkMetadata | null;
  };

  const sendClickDownload = (
    binding: ShortcutBinding,
    source: ClickSource,
    linkMetadata: ContextLinkMetadata | null,
  ): void => {
    void sendRuntimeDownload(
      {
        url: source.url,
        info: {
          pageUrl: `${window.location}`,
          srcUrl: source.url,
          sourceKind: source.kind,
          gesture: binding.gesture,
          ...(linkMetadata?.title ? { linkTitle: linkMetadata.title } : {}),
          ...(linkMetadata?.download ? { linkDownload: linkMetadata.download } : {}),
          ...(cssSelectors.length > 0
            ? {
                matchedCssSelectorsByOrigin: matchedCssSelectorsByOrigin(
                  [source.element],
                  routingRules,
                ),
              }
            : {}),
        },
      },
      2,
      downloadLifecycle,
    );
  };

  let longPressInputController: AbortController | null = null;
  const stopLongPressInputTracking = (): void => {
    longPressInputController?.abort();
    longPressInputController = null;
  };
  let startLongPressInputTracking = stopLongPressInputTracking;
  let longPressKeyCodes: readonly number[] = [];
  // A long page task can hold a physically short click's mouseup queued past
  // the hold threshold. Completion therefore never fires in the same task as
  // threshold expiry: the wait is split so the last millisecond runs as its
  // own task, giving that queued release a turn to cancel first. The follow-up
  // timer must be cleared alongside the threshold timer.
  const longPressFollowUps = new Map<number, number>();
  const longPress = shortcutOptions.some(({ gesture }) => gesture === CLICK_GESTURES.LONG_LEFT)
    ? createLongPressTracker<LongPressCandidate>(
        options.contentClickToSaveLongPressMs ?? CONTENT_LONG_PRESS_DEFAULT_MS,
        {
          set: (callback, delayMs) => {
            const timer = window.setTimeout(
              () => {
                longPressFollowUps.set(
                  timer,
                  window.setTimeout(() => {
                    longPressFollowUps.delete(timer);
                    callback();
                  }, 1),
                );
              },
              Math.max(0, delayMs - 1),
            );
            return timer;
          },
          clear: (timer) => {
            window.clearTimeout(timer);
            const followUp = longPressFollowUps.get(timer);
            if (followUp !== undefined) {
              window.clearTimeout(followUp);
              longPressFollowUps.delete(timer);
            }
          },
        },
        ({ binding, source, linkMetadata }) => {
          longPressKeyCodes = [];
          // Once the hold threshold wins, this physical sequence can no longer
          // become a later double-click, even if the live policy rejects save.
          doubleClick.reset();
          // The URL can change while the button is held on an SPA. Apply the live
          // page policy at the privileged action boundary, not only at mousedown.
          if (isDisabled() || !ClickToSave.isKeyboardComboActive(binding.keyCodes, active)) {
            stopLongPressInputTracking();
            return;
          }
          longReleaseSuppression.arm();
          sendClickDownload(binding, source, linkMetadata);
        },
      )
    : null;
  const cancelLongPress = (): void => {
    longPress?.cancel();
    longPressKeyCodes = [];
    stopLongPressInputTracking();
  };

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
      if (!wasActive && shortcutOptions.some(({ keyCodes }) => keyCodes.includes(code))) {
        warmBackground();
      }
    },
    listenerOptions,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (!acceptInput(e)) return;
      const code = eventKeyCode(e);
      active[code] = false;
      if (longPress?.isPending() && longPressKeyCodes.includes(code)) cancelLongPress();
    },
    listenerOptions,
  );

  const resetActive = () => {
    active = {};
    doubleClick.reset();
    suppressDoubleClickOn = null;
    followUps.disarm();
    cancelLongPress();
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
      // Every new press clears any follow-up suppression a previous matched
      // gesture armed and any completed-double marker; a new primary press
      // also clears a completed-long marker. This must run before isDisabled()
      // check: a matched press whose follow-ups never arrive (drag released
      // off-window) followed by an SPA navigation onto a per-site-disabled
      // URL must not leave stale state to eat later clicks on this page.
      followUps.disarm();
      suppressDoubleClickOn = null;
      if (e.button === 0) longReleaseSuppression.clear();
      cancelLongPress();
      // Enforced at click time against the live URL so a single-page-app
      // navigation onto or off the disable list takes effect immediately.
      if (isDisabled()) {
        doubleClick.reset();
        return;
      }
      const bindings = shortcutOptions.filter(
        ({ keyCodes, gesture }) =>
          ClickToSave.isKeyboardComboActive(keyCodes, active) &&
          (isSingleGestureButton(gesture, e.button) ||
            ((gesture === CLICK_GESTURES.DOUBLE_LEFT || gesture === CLICK_GESTURES.LONG_LEFT) &&
              e.button === 0)),
      );
      if (bindings.length === 0) {
        doubleClick.reset();
        return;
      }
      const source = ClickToSave.findSource(e, options.links, preferLinkAtCurrentPage());
      if (!source) {
        doubleClick.reset();
        return;
      }

      const doubleBinding = bindings.find(({ gesture }) => gesture === CLICK_GESTURES.DOUBLE_LEFT);
      if (doubleBinding) {
        if (e.detail === 1) warmBackground();
        if (doubleClick.press(e.detail, e.button, source)) {
          suppressDoubleClickOn = source.element;
          e.preventDefault();
          e.stopImmediatePropagation();
          sendClickDownload(doubleBinding, source, contextLinkMetadataFromEvent(e));
          return;
        }
      } else {
        doubleClick.reset();
      }

      const longBinding = bindings.find(({ gesture }) => gesture === CLICK_GESTURES.LONG_LEFT);
      if (longBinding) {
        // Unlike every immediate gesture, a long press must leave mousedown
        // untouched so a release before the threshold remains an ordinary
        // page click and movement can still become selection or dragging.
        warmBackground();
        longPressKeyCodes = longBinding.keyCodes;
        startLongPressInputTracking();
        longPress?.press(
          {
            binding: longBinding,
            source,
            linkMetadata: contextLinkMetadataFromEvent(e),
          },
          e.clientX,
          e.clientY,
        );
        return;
      }

      const binding = bindings.find(({ gesture }) => isSingleGestureButton(gesture, e.button));
      if (!binding) return;
      doubleClick.reset();
      e.preventDefault();
      e.stopImmediatePropagation();
      // Canceling this mousedown does not cancel what the same input sequence
      // triggers afterwards (context menu, middle-click link navigation), so
      // arm a one-shot suppression for the matched gesture's follow-up events.
      followUps.arm(binding.gesture, e.button);
      sendClickDownload(binding, source, contextLinkMetadataFromEvent(e));
    },
    listenerOptions,
  );

  if (longPress) {
    const updateLongPress = (e: MouseEvent): void => {
      if (!acceptInput(e)) return;
      if (e.type === "mousemove") {
        if ((e.buttons & 1) === 0) {
          cancelLongPress();
          return;
        }
        const wasPending = longPress.isPending();
        longPress.move(e.clientX, e.clientY);
        if (wasPending && !longPress.isPending()) cancelLongPress();
      } else if (e.type === "mouseup" && e.button === 0) {
        cancelLongPress();
        if (ownsLongReleaseSuppression) longReleaseSuppression.release();
      } else if (e.type === "dragstart" || (e.type === "mouseout" && e.relatedTarget === null)) {
        cancelLongPress();
      }
    };
    startLongPressInputTracking = () => {
      stopLongPressInputTracking();
      const inputController = new AbortController();
      longPressInputController = inputController;
      const inputListenerOptions = { capture: true, signal: inputController.signal };
      window.addEventListener("mousemove", updateLongPress, inputListenerOptions);
      window.addEventListener("mouseup", updateLongPress, inputListenerOptions);
      window.addEventListener("dragstart", updateLongPress, inputListenerOptions);
      window.addEventListener("mouseout", updateLongPress, inputListenerOptions);
    };
  }

  // Follow-up suppression for a matched middle/right gesture. Only real input
  // consumes the one-shot state: a page-synthesized event must be able neither
  // to burn the suppression before the browser's own follow-up arrives nor to
  // have its default action canceled by us.
  //
  // Back/forward (buttons 3/4) intentionally have no handler here. Measured
  // 2026-07 with Chrome 150 (CDP Input.dispatchMouseEvent, headless and
  // headed) and Firefox 152 (BiDi input.performActions, headless): both
  // browsers deliver cancelable pointerdown/mousedown/pointerup/mouseup for
  // buttons 3/4 to content — so the bindings work in both — but Chrome also
  // fires auxclick while Firefox does not, and NEITHER browser triggered
  // history navigation from protocol-synthesized input, with or without
  // preventDefault on any of those events. The real-hardware back/forward
  // action is decided above the content layer, no content event was shown to
  // gate it, and an unverifiable mouseup/pointerup handler would only cancel
  // unrelated page defaults.
  const suppressFollowUp = (e: MouseEvent) => {
    if (!acceptInput(e)) return;
    if (!followUps.suppress(e.type, e.button)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("contextmenu", suppressFollowUp, listenerOptions);
  window.addEventListener("auxclick", suppressFollowUp, listenerOptions);
  window.addEventListener("click", suppressFollowUp, listenerOptions);

  const suppressCompletedDoubleClick = (e: MouseEvent) => {
    // Same trust rule as suppressFollowUp: a page-synthesized click must
    // neither be canceled nor clear the marker before the browser's own
    // click/dblclick for the completed double arrive.
    if (
      !acceptInput(e) ||
      !suppressDoubleClickOn ||
      e.button !== 0 ||
      !e.composedPath().includes(suppressDoubleClickOn)
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "dblclick") suppressDoubleClickOn = null;
  };
  window.addEventListener("click", suppressCompletedDoubleClick, listenerOptions);
  window.addEventListener("dblclick", suppressCompletedDoubleClick, listenerOptions);

  const suppressCompletedLongClick = (e: MouseEvent) => {
    // The initial mousedown remains page-owned. Only the trusted click that a
    // successful hold produces is canceled, which stops link navigation while
    // leaving short clicks, drags, and page-synthesized events untouched.
    if (!acceptInput(e) || e.button !== 0 || !longReleaseSuppression.consume(e.detail)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  if (ownsLongReleaseSuppression) {
    window.addEventListener("click", suppressCompletedLongClick, listenerOptions);
  }

  return () => {
    controller.abort();
    cancelLongPress();
    if (ownsLongReleaseSuppression) longReleaseSuppression.clear();
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

  // The per-page limit is a silent stop otherwise: nothing tells the user
  // automatic adoption paused because it hit autoDownloadMaxPerPage. Report it
  // to the background debug log — the diagnostic surface the routing docs
  // already point users at — instead of adding new notification UI copy.
  const reportLimitReached = () => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "AUTO_DOWNLOAD_LIMIT_REACHED",
          body: { maxPerPage: options.autoDownloadMaxPerPage },
        },
        () => chrome.runtime.lastError,
      );
    } catch {
      // Extension context invalidated while the page remained alive.
    }
  };

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
    onLimitReached: reportLimitReached,
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
// A completed hold can overlap a live options update that replaces the
// click-to-save mount. Keep only its one-bit release marker at page lifetime;
// no source element or other page-owned object is retained across remounts.
const pageLongReleaseSuppression = createLongClickReleaseSuppressor(LONG_CLICK_SUPPRESSION_TTL_MS, {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (timer) => window.clearTimeout(timer),
});
let pageLongReleaseListenersInstalled = false;
const pageLongReleaseMousedown = (event: MouseEvent): void => {
  if (event.isTrusted && event.button === 0) pageLongReleaseSuppression.clear();
};
const pageLongReleaseMouseup = (event: MouseEvent): void => {
  if (event.isTrusted && event.button === 0) pageLongReleaseSuppression.release();
};
const pageLongReleaseClick = (event: MouseEvent): void => {
  if (!event.isTrusted || event.button !== 0 || !pageLongReleaseSuppression.consume(event.detail))
    return;
  event.preventDefault();
  event.stopImmediatePropagation();
};
const ensurePageLongReleaseListeners = (): void => {
  if (pageLongReleaseListenersInstalled) return;
  pageLongReleaseListenersInstalled = true;
  // These low-frequency listeners own release suppression across click-to-save
  // remounts. High-frequency movement tracking remains transient per hold.
  window.addEventListener("mousedown", pageLongReleaseMousedown, { capture: true });
  window.addEventListener("mouseup", pageLongReleaseMouseup, { capture: true });
  window.addEventListener("click", pageLongReleaseClick, { capture: true });
};
const removePageLongReleaseListeners = (): void => {
  // A completed hold may still be awaiting the release click it must consume;
  // keep the listeners until that one-shot state resolves so a rebind cannot
  // let the click through. A skipped removal retries on the next rebind.
  if (!pageLongReleaseListenersInstalled || !pageLongReleaseSuppression.idle()) return;
  pageLongReleaseListenersInstalled = false;
  window.removeEventListener("mousedown", pageLongReleaseMousedown, { capture: true });
  window.removeEventListener("mouseup", pageLongReleaseMouseup, { capture: true });
  window.removeEventListener("click", pageLongReleaseClick, { capture: true });
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
const E2E_CONTENT_READY_REQUEST = "SAVE_IN_E2E_CONTENT_READY";
const pendingE2EContentReadyResponses = new Set<(response: { type: string }) => void>();

const acknowledgeE2EContentReady = () => {
  if (!SAVE_IN_CONTENT_E2E || !receivedInitialOptions) return;
  pendingE2EContentReadyResponses.forEach((respond) =>
    respond({ type: E2E_CONTENT_READY_REQUEST }),
  );
  pendingE2EContentReadyResponses.clear();
};

// The per-site disable list turns off every content-script surface on matching
// pages. Feature mounts follow their own options; this predicate is re-evaluated
// at action time against the live URL so a single-page-app navigation that moves
// on or off the list takes effect without an options change. A list the parser
// cannot read in full disables every surface everywhere: a rejected line reads
// as "no match", which would keep running on the one site the line was written
// to exclude, and the list is only ever consulted to decide what to leave alone.
const isCurrentPageDisabled = (): boolean =>
  matchesAnyPatternOrUnreadable(`${window.location}`, currentOptions.perSiteDisableList);

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
    [
      "contentClickToSave",
      "contentClickToSaveBindings",
      "contentClickToSaveCombo",
      "contentClickToSaveButton",
      "contentClickToSaveLongPressMs",
      "links",
      "preferLinks",
      "preferLinksFilterEnabled",
      "preferLinksFilter",
      "filenamePatterns",
    ] as const
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
    removeClickToSave = null;
    let hasLongPress = false;
    if (currentOptions.contentClickToSave) {
      hasLongPress = resolveClickToSaveBindings(
        currentOptions.contentClickToSaveBindings,
        currentOptions.contentClickToSaveCombo,
        currentOptions.contentClickToSaveButton,
      ).some(({ gesture }) => gesture === CLICK_GESTURES.LONG_LEFT);
      if (hasLongPress) ensurePageLongReleaseListeners();
      removeClickToSave = setupClickToSave(
        currentOptions,
        undefined,
        isCurrentPageDisabled,
        pageLongReleaseSuppression,
      );
    }
    if (!hasLongPress) removePageLongReleaseListeners();
  }
  announceSourcePanelReady();
};

const changedDuringRead = new Set<string>();
let lastContextLinkMetadata: ContextLinkMetadata | null = null;

try {
  window.addEventListener(
    "contextmenu",
    (event) => {
      lastContextLinkMetadata = contextLinkMetadataFromEvent(event);
    },
    { capture: true },
  );
} catch {
  // Extension context invalidated before the page listener could be attached.
}

try {
  // Existing tabs receive later option deltas explicitly from the background.
  // Do not subscribe this every-page script to storage changes: Firefox sends
  // the complete old/new history array to every listener on every history
  // update, even though content options have no relationship to history.
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
    acknowledgeE2EContentReady();
    announceSourcePanelReady();
  });
} catch (e) {
  // Extension context invalidated (extension reloaded/updated underneath us)
  receivedInitialOptions = true;
  acknowledgeE2EContentReady();
}

try {
  let sourcePanelRoutingCache:
    | { patterns: string; rules: RoutingRule[]; hasCssSelectors: boolean }
    | undefined;
  const sourcePanelRouting = () => {
    const patterns = currentOptions.filenamePatterns;
    if (sourcePanelRoutingCache?.patterns === patterns) return sourcePanelRoutingCache;
    const rules = parseRulesCollecting(patterns).rules;
    sourcePanelRoutingCache = {
      patterns,
      rules,
      hasCssSelectors: cssSelectorsForRules(rules).length > 0,
    };
    return sourcePanelRoutingCache;
  };
  const sendDownload = (source: PageSource) => {
    const { rules, hasCssSelectors } = sourcePanelRouting();
    return sendRuntimeDownload({
      url: source.url,
      info: {
        pageUrl: `${window.location}`,
        srcUrl: source.url,
        sourceKind: source.kind,
        ...(hasCssSelectors
          ? {
              matchedCssSelectorsByOrigin: matchedCssSelectorsByOrigin(
                sourceOriginElements(source),
                rules,
              ),
            }
          : {}),
      },
    });
  };
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
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (SAVE_IN_CONTENT_E2E && message?.type === E2E_CONTENT_READY_REQUEST) {
      if (receivedInitialOptions) {
        sendResponse({ type: E2E_CONTENT_READY_REQUEST });
        return;
      }
      pendingE2EContentReadyResponses.add(sendResponse);
      // Callback-style Chrome listeners must keep the channel open for the
      // storage-read acknowledgement; Firefox honors the same return value.
      return true;
    }
    if (message?.type === CONTEXT_LINK_METADATA_REQUEST) {
      const expectedHref = message.body?.linkUrl;
      sendResponse(
        typeof expectedHref === "string" && lastContextLinkMetadata
          ? parseContextLinkMetadata(lastContextLinkMetadata, expectedHref)
          : null,
      );
      return;
    }
    if (message?.type === CONTENT_OPTIONS_CHANGED_MESSAGE) {
      const changed = normalizeContentOptionsPatch(message.body?.options);
      if (!receivedInitialOptions) {
        Object.keys(changed).forEach((key) => changedDuringRead.add(key));
      }
      if (Object.keys(changed).length > 0) applyOptions(changed);
      return;
    }
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
    return undefined;
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
