import type { UiTheme } from "../config/content-options.ts";
import type { PickerModel } from "../shared/destination-picker.ts";
import {
  createPickerState,
  flattenPickerModel,
  hasPickerDestinations,
  movePickerActive,
  setPickerActive,
  setPickerQuery,
  type PickerRow,
} from "./destination-picker-model.ts";
import { resolvedPanelTheme } from "./source-panel-format.ts";
import SOURCE_PANEL_TOKENS_CSS from "./source-panel-tokens.css";
import SOURCE_PANEL_THEMES_CSS from "./source-panel-themes.css";
import SOURCE_PANEL_THEMES_PREMIUM_CSS from "./source-panel-themes-premium.css";
import DESTINATION_PICKER_CSS from "./destination-picker.css";

declare const SAVE_IN_CONTENT_E2E: boolean;

// The opt-in in-page destination picker. It is drawn in a closed shadow root
// and acts only on browser-trusted input, so the page it floats over can
// neither read the user's folder names nor choose a destination. E2E builds
// open the root and accept synthesized input so the suites can drive it.

// A custom element name, never registered: the context-image lookup already
// treats any such element as content, so it never reads "through" the picker.
const PICKER_HOST_NAME = "save-in-picker";
const LIST_ID = "destinations";

export const isDestinationPickerHost = (candidate: unknown): boolean =>
  candidate instanceof Element && candidate.localName === PICKER_HOST_NAME;

export type DestinationPickerOptions = {
  model: PickerModel;
  // Viewport position of the gesture that opened the picker. Absent for a
  // keyboard command, which centers it.
  point?: { x: number; y: number } | undefined;
  theme: UiTheme | undefined;
  onPick: (menuItemId: string) => void;
};

let closeActivePicker: (() => void) | null = null;

export const closeDestinationPicker = (): void => {
  closeActivePicker?.();
};

const acceptsEvent = (event: Event): boolean => event.isTrusted || SAVE_IN_CONTENT_E2E === true;

const optionId = (index: number): string => `destination-${index}`;

const renderRow = (row: PickerRow, index: number, lastUsedHint: string): HTMLElement => {
  const element = document.createElement("div");
  if (row.kind === "separator") {
    element.className = "separator";
    element.setAttribute("role", "separator");
    return element;
  }
  element.style.setProperty("--picker-depth", String(row.depth));
  if (row.kind === "heading") {
    element.className = "heading";
    element.setAttribute("role", "presentation");
    element.textContent = row.title;
    return element;
  }
  element.className = "option";
  element.id = optionId(index);
  element.dataset.id = row.id;
  element.setAttribute("role", "option");
  // The label carries the ancestors a screen reader cannot get from indentation.
  element.setAttribute("aria-label", row.label);
  const title = document.createElement("span");
  title.textContent = row.title;
  element.append(title);
  if (row.lastUsed) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.id = `${element.id}-hint`;
    hint.textContent = lastUsedHint;
    element.setAttribute("aria-describedby", hint.id);
    element.append(hint);
  }
  return element;
};

// Returns false without showing anything when the model offers no destination.
export const openDestinationPicker = (options: DestinationPickerOptions): boolean => {
  const rows = flattenPickerModel(options.model);
  if (!hasPickerDestinations(rows)) return false;
  closeDestinationPicker();
  // A host left behind by an earlier content-script instance can no longer
  // reach the extension, so it would be a dead control on the page.
  document.querySelectorAll(PICKER_HOST_NAME).forEach((orphan) => orphan.remove());

  const { copy } = options.model;
  const host = document.createElement(PICKER_HOST_NAME);
  host.dataset.theme = resolvedPanelTheme(options.theme);
  if (options.point) {
    host.style.setProperty("--picker-x", `${options.point.x}px`);
    host.style.setProperty("--picker-y", `${options.point.y}px`);
  }
  const shadow = host.attachShadow({ mode: SAVE_IN_CONTENT_E2E === true ? "open" : "closed" });
  const style = document.createElement("style");
  style.textContent = [
    SOURCE_PANEL_TOKENS_CSS,
    SOURCE_PANEL_THEMES_CSS,
    SOURCE_PANEL_THEMES_PREMIUM_CSS,
    DESTINATION_PICKER_CSS,
  ].join("\n");

  const picker = document.createElement("div");
  picker.className = "picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", copy.title);
  const filter = document.createElement("input");
  filter.className = "filter";
  filter.type = "text";
  filter.autocomplete = "off";
  filter.spellcheck = false;
  filter.placeholder = copy.filter;
  filter.setAttribute("role", "combobox");
  filter.setAttribute("aria-label", copy.filter);
  filter.setAttribute("aria-expanded", "true");
  filter.setAttribute("aria-autocomplete", "list");
  filter.setAttribute("aria-controls", LIST_ID);
  const list = document.createElement("div");
  list.className = "list";
  list.id = LIST_ID;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", copy.title);
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.setAttribute("role", "status");
  empty.textContent = copy.empty;
  picker.append(filter, list, empty);
  shadow.append(style, picker);

  let state = createPickerState(rows);
  // The active row is restyled in place. Rebuilding the list under a pressed
  // pointer would replace the element a click is about to land on.
  const showActive = (): void => {
    let activeElementId: string | null = null;
    for (const option of list.querySelectorAll<HTMLElement>(".option")) {
      const active = option.dataset.id === state.activeId;
      option.setAttribute("aria-selected", String(active));
      if (active) {
        activeElementId = option.id;
        option.scrollIntoView({ block: "nearest" });
      }
    }
    if (activeElementId === null) filter.removeAttribute("aria-activedescendant");
    else filter.setAttribute("aria-activedescendant", activeElementId);
  };
  const render = (): void => {
    list.replaceChildren(
      ...state.visible.map((row, index) => renderRow(row, index, copy.lastUsed)),
    );
    empty.hidden = state.visible.length > 0;
    showActive();
  };

  const controller = new AbortController();
  const { signal } = controller;
  const previousFocus = document.activeElement;
  // Reached once: every caller is either the module's single active reference
  // or one of the listeners the abort below removes.
  const close = (): void => {
    closeActivePicker = null;
    controller.abort();
    // Hand focus back only while the picker still holds it: a close the user
    // did not trigger from inside it must not pull focus out of the page field
    // they have since moved to.
    if (
      document.activeElement === host &&
      previousFocus instanceof HTMLElement &&
      previousFocus.isConnected
    ) {
      previousFocus.focus({ preventScroll: true });
    }
    host.remove();
  };
  const pick = (menuItemId: string): void => {
    close();
    options.onPick(menuItemId);
  };

  filter.addEventListener(
    "input",
    (event) => {
      if (!acceptsEvent(event)) return;
      state = setPickerQuery(state, filter.value);
      render();
    },
    { signal },
  );
  picker.addEventListener(
    "keydown",
    (event) => {
      // An IME confirms its own composition with Enter and may use the arrows.
      if (!acceptsEvent(event) || event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        state = movePickerActive(state, event.key === "ArrowDown" ? 1 : -1);
        showActive();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (state.activeId !== null) pick(state.activeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        // The filter is the only stop. Leaving it would strand an open picker
        // that Escape can no longer reach.
        event.preventDefault();
      }
    },
    { signal },
  );
  // Key events are composed and retargeted to the host, so a page hotkey
  // handler that exempts INPUT targets does not exempt the filter: typing
  // there would run site shortcuts. Registered after the picker's own handler,
  // in the bubble phase, so that still runs first.
  (["keydown", "keypress", "keyup"] as const).forEach((type) =>
    picker.addEventListener(type, (event) => event.stopPropagation(), { signal }),
  );
  const optionAt = (event: Event): string | undefined =>
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(".option")?.dataset.id
      : undefined;
  list.addEventListener(
    "pointermove",
    (event) => {
      const id = optionAt(event);
      if (!acceptsEvent(event) || id === undefined) return;
      const next = setPickerActive(state, id);
      if (next === state) return;
      state = next;
      showActive();
    },
    { signal },
  );
  list.addEventListener(
    "click",
    (event) => {
      const id = optionAt(event);
      if (acceptsEvent(event) && id !== undefined) pick(id);
    },
    { signal },
  );
  // A press anywhere else dismisses. On window rather than document: a
  // click-to-save gesture opens the picker from its own window-level mousedown
  // listener, and a listener added to a later target of that same event would
  // run for it and close the picker it had just opened.
  window.addEventListener(
    "mousedown",
    (event) => {
      if (acceptsEvent(event) && !event.composedPath().includes(host)) close();
    },
    { capture: true, signal },
  );

  closeActivePicker = close;
  document.documentElement.append(host);
  render();
  filter.focus({ preventScroll: true });
  return true;
};
