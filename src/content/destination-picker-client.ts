import type { UiTheme } from "../config/content-options.ts";
import {
  parsePickerModel,
  parsePickerSource,
  type PickerSource,
} from "../shared/destination-picker.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { closeDestinationPicker, openDestinationPicker } from "./destination-picker.ts";

// Connects the picker view to the background: the model comes from it, and a
// choice goes back to it as a menu item id. Message types are spelled out, as
// everywhere in the content bundle, which has no polyfill and uses
// callback-style chrome.* calls.

type PickerClientDependencies = {
  // Re-read at every step: a single-page-app navigation can move the page onto
  // the per-site disable list while the model is on its way.
  isPageDisabled: () => boolean;
  theme: () => UiTheme | undefined;
  // True once the extension was reloaded underneath this page. Nothing can be
  // saved from here any more, so nothing may be shown either.
  releaseIfInvalidated: () => boolean;
};

const RETRY_DELAY_MS = 300;

export const createDestinationPickerClient = (dependencies: PickerClientDependencies) => {
  // A request is retried because a click can race the service worker's cold
  // start; an invalidated context is not such a race and is never retried.
  const request = (message: { type: string; body?: unknown }, retries = 2): Promise<unknown> =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (!chrome.runtime.lastError) {
            resolve(response);
            return;
          }
          if (retries > 0 && !dependencies.releaseIfInvalidated()) {
            window.setTimeout(() => {
              void request(message, retries - 1).then(resolve);
            }, RETRY_DELAY_MS);
            return;
          }
          resolve(null);
        });
      } catch {
        // Extension context invalidated while the page remained alive.
        resolve(null);
        dependencies.releaseIfInvalidated();
      }
    });

  let latestOpen = 0;

  // `source` is what a choice will save; null saves the page.
  const open = async (
    source: PickerSource | null,
    point?: { x: number; y: number },
  ): Promise<boolean> => {
    latestOpen += 1;
    const thisOpen = latestOpen;
    if (dependencies.isPageDisabled() || dependencies.releaseIfInvalidated()) return false;
    const response = await request({ type: "PICKER_MODEL" });
    const model =
      isStringKeyedRecord(response) && response.type === "PICKER_MODEL"
        ? parsePickerModel(response.body)
        : null;
    // A later request owns the picker now, or the page moved meanwhile.
    if (!model || thisOpen !== latestOpen || dependencies.isPageDisabled()) return false;
    return openDestinationPicker({
      model,
      point,
      theme: dependencies.theme(),
      onPick: (menuItemId) => {
        void request({ type: "PICKER_SAVE", body: { menuItemId, source } });
      },
    });
  };

  return {
    open,
    // A click-to-save gesture resolved one element. Anything the background
    // could not save as that element opens nothing, rather than a picker that
    // would save the page in its place.
    openForClick: (
      clicked: { url: string; kind: string },
      point: { x: number; y: number },
    ): Promise<boolean> => {
      const source = parsePickerSource(
        clicked.kind === "link" ? { linkUrl: clicked.url } : { media: clicked },
      );
      return source ? open(source, point) : Promise.resolve(false);
    },
    close: closeDestinationPicker,
  };
};
