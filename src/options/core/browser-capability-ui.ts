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
  document.querySelectorAll<HTMLElement>(".firefox-reroute-only").forEach((el) => {
    el.hidden =
      CURRENT_BROWSER !== BROWSERS.FIREFOX || WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
  });
  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    document.querySelectorAll<HTMLElement>(".firefox-only").forEach((el) => {
      el.hidden = true;
    });
    document.querySelectorAll(".chrome-enabled").forEach((el) => {
      el.removeAttribute("disabled");
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
