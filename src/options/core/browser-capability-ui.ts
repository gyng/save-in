// Toggles/disables controls the current browser doesn't support. Called once
// browser detection resolves (see waitForBrowserDetection in options.ts,
// which owns the timing contract with the bootstrap's startBrowserDetection
// port).
import {
  CURRENT_BROWSER,
  BROWSERS,
  WEB_EXTENSION_CAPABILITIES,
} from "../../platform/chrome-detector.ts";
import { updateTabContextControls } from "./tab-context-controls.ts";

export const applyBrowserCapabilityUi = (): void => {
  document.querySelectorAll<HTMLElement>(".filename-suggestion-only").forEach((el) => {
    el.hidden = !WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
  });
  // Only the "prompt" conflict action is Chrome-only; Firefox has never
  // implemented it and fails the download outright. "uniquify"/"overwrite" work
  // in both, so gate the option rather than the whole control. Hidden alone
  // leaves an <option> selectable, so disable it too.
  document.querySelectorAll<HTMLElement>(".conflict-prompt-only").forEach((el) => {
    el.hidden = !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt;
    if (el instanceof HTMLOptionElement) {
      el.disabled = !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt;
    }
  });
  // Firefox fails a download outright when the filename ends in a shortcut
  // extension it treats as dangerous, so .url and .desktop formats cannot be
  // offered there at all (#207). Same shape as the conflict action above:
  // hidden alone leaves an <option> selectable, so disable it too.
  document.querySelectorAll<HTMLElement>(".shortcut-extension-only").forEach((el) => {
    el.hidden = !WEB_EXTENSION_CAPABILITIES.shortcutFileExtensions;
    if (el instanceof HTMLOptionElement) {
      el.disabled = !WEB_EXTENSION_CAPABILITIES.shortcutFileExtensions;
    }
  });
  // The inverse: say why those formats are missing, only where they are.
  document.querySelectorAll<HTMLElement>(".shortcut-extension-unavailable").forEach((el) => {
    el.hidden = WEB_EXTENSION_CAPABILITIES.shortcutFileExtensions;
  });
  document.querySelectorAll<HTMLElement>(".firefox-reroute-only").forEach((el) => {
    el.hidden =
      CURRENT_BROWSER !== BROWSERS.FIREFOX || WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
  });
  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    document.querySelectorAll<HTMLElement>(".firefox-only").forEach((el) => {
      el.hidden = true;
    });
    document
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        ".chrome-disabled",
      )
      .forEach((el) => {
        el.disabled = true;
      });
  }
  if (CURRENT_BROWSER === BROWSERS.FIREFOX) {
    // Chrome-only surfaces (e.g. the offscreen-document permission rationale)
    // describe behavior Firefox never runs; hide them where they do not apply.
    document.querySelectorAll<HTMLElement>(".chrome-only").forEach((el) => {
      el.hidden = true;
    });
  }

  updateTabContextControls(WEB_EXTENSION_CAPABILITIES.tabContextMenus);
};
