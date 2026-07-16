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

  updateTabContextControls(WEB_EXTENSION_CAPABILITIES.tabContextMenus);
};
