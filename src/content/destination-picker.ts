import type { UiTheme } from "../config/content-options.ts";
import type { PickerModel } from "../shared/destination-picker.ts";
import {
  createPickerState,
  flattenPickerModel,
  hasPickerDestinations,
  isPickerKeyLive,
  leavePickerScope,
  movePickerActive,
  pickerKeyAction,
  setPickerActive,
  setPickerQuery,
  splitPickerMatches,
  type PickerRow,
  type PickerState,
  type PickerSubject,
  splitPickerSubjectName,
} from "./destination-picker-model.ts";
import { createSourceKindIcon } from "./source-panel-icons.ts";
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
  // What a choice will save, named in the header.
  subject?: PickerSubject | undefined;
  onPick: (menuItemId: string) => void;
};

let closeActivePicker: (() => void) | null = null;

export const closeDestinationPicker = (): void => {
  closeActivePicker?.();
};

const acceptsEvent = (event: Event): boolean => event.isTrusted || SAVE_IN_CONTENT_E2E === true;

const optionId = (index: number): string => `destination-${index}`;

// A closed shadow root hides nodes from page script, but not text: find-in-page
// (`window.find`) answers whether a string is on screen, and a selection
// extended across the document serializes whatever it covers. Both skip inert
// content (measured in Chrome and Firefox; `user-select: none` alone still
// answers `find`), so every piece of text the picker shows is drawn inside an
// inert element. Inert content is also skipped by hit-testing, so a click or
// pointer move over the text targets the row that holds it, and it leaves the
// accessibility tree, so each row carries its name and description as ARIA
// attributes instead.
const shieldedText = <K extends "span" | "kbd">(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  element.setAttribute("inert", "");
  return element;
};

// A folder name is often a path. Offer a line break after each "/" so a long
// one wraps between its folders before it breaks inside a word.
const withPathBreaks = (text: string): Node[] =>
  text
    .split(/(?<=\/)/)
    .flatMap((part, index) =>
      index === 0
        ? [document.createTextNode(part)]
        : [document.createElement("wbr"), document.createTextNode(part)],
    );

const ROW_ICON_PATHS = {
  folder: ["M3 6h6l2 2h10v11H3z"],
  // An open folder: a submenu heading is a folder too, shown holding the rows
  // beneath it, which is why it cannot itself be picked.
  folderOpen: ["M3 19V6h6l2 2h8v3", "M3 19l3-8h16l-3 8z"],
  lastUsed: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3 2"],
} as const;

const rowIcon = (icon: keyof typeof ROW_ICON_PATHS): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("row-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  ROW_ICON_PATHS[icon].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
};

// A key is shown only while it works: within the submenu level the keys are
// currently in, and never once a filter is being typed.
const appendLiveKey = (element: HTMLElement, row: PickerRow, state: PickerState): void => {
  if (row.kind === "separator" || row.key === undefined || !isPickerKeyLive(state, row)) return;
  const key = shieldedText("kbd", "row-key", row.key);
  key.setAttribute("aria-hidden", "true");
  if (row.kind === "destination") element.setAttribute("aria-keyshortcuts", row.key);
  element.append(key);
};

const renderRow = (
  row: PickerRow,
  index: number,
  lastUsedHint: string,
  state: PickerState,
): HTMLElement => {
  const { query } = state;
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
    // The submenu the keys have stepped into reads as the current one.
    if (state.scope === row.id) element.dataset.scope = "current";
    const title = shieldedText("span", "heading-title", "");
    title.append(...withPathBreaks(row.title));
    element.append(rowIcon("folderOpen"), title);
    appendLiveKey(element, row, state);
    return element;
  }
  element.className = "option";
  element.id = optionId(index);
  element.dataset.id = row.id;
  element.setAttribute("role", "option");
  // The label carries the ancestors a screen reader cannot get from indentation.
  element.setAttribute("aria-label", row.label);
  // The marks are visual only; the accessible name above is the whole label.
  const title = shieldedText("span", "option-title", "");
  title.append(
    ...splitPickerMatches(row.title, query)
      .map(({ text, match }) => {
        if (!match) return withPathBreaks(text);
        const mark = document.createElement("mark");
        mark.append(...withPathBreaks(text));
        return [mark];
      })
      .flat(),
  );
  element.append(rowIcon(row.lastUsed ? "lastUsed" : "folder"), title);
  if (row.lastUsed) {
    // Not `aria-describedby`: the visible hint is inert, and an inert element
    // describes nothing.
    element.setAttribute("aria-description", lastUsedHint);
    element.append(shieldedText("span", "hint", lastUsedHint));
  }
  appendLiveKey(element, row, state);
  return element;
};

// The header says what the picker will save: its kind as an icon and its name
// when the address or page has one. The dialog's accessible name stays the
// title alone; the name is page-controlled text and only ever shown.
const renderHeader = (title: string, subject: PickerSubject | undefined): HTMLElement => {
  const header = document.createElement("div");
  header.className = "header";
  if (subject)
    header.append(createSourceKindIcon(subject.kind === "page" ? "document" : subject.kind));
  header.append(shieldedText("span", "header-title", title));
  if (subject?.name) {
    // The tooltip for a clipped name sits on the header: an inert element is
    // never hovered.
    header.title = subject.name;
    const { head, tail } = splitPickerSubjectName(subject);
    const name = document.createElement("span");
    name.className = "header-subject";
    name.append(shieldedText("span", "header-subject-head", head));
    if (tail) name.append(shieldedText("span", "header-subject-tail", tail));
    header.append(name);
  }
  return header;
};

// Key legend for sighted keyboard users. The keys are glyphs, not words, so
// there is nothing to translate; assistive technology gets the same contract
// from the combobox and listbox roles instead.
const renderKeyLegend = (): HTMLElement => {
  const legend = document.createElement("div");
  legend.className = "keys";
  legend.setAttribute("aria-hidden", "true");
  legend.setAttribute("inert", "");
  for (const group of [["\u2191", "\u2193"], ["\u21B5"], ["Esc"]]) {
    const keys = document.createElement("span");
    keys.className = "key-group";
    keys.append(
      ...group.map((label) => {
        const key = document.createElement("kbd");
        key.textContent = label;
        return key;
      }),
    );
    legend.append(keys);
  }
  return legend;
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
  const empty = shieldedText("span", "empty", copy.empty);
  // A live region announces only text that changes inside it while it is
  // rendered, and inert text is not in the accessibility tree at all. So the
  // status is always present, visually hidden, and gets its text when the
  // list empties. That text is fixed extension copy, never a folder name, so
  // it is the one string here find-in-page may see.
  const status = document.createElement("div");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  picker.append(
    renderHeader(copy.title, options.subject),
    filter,
    list,
    empty,
    status,
    renderKeyLegend(),
  );
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
      ...state.visible.map((row, index) => renderRow(row, index, copy.lastUsed, state)),
    );
    empty.hidden = state.visible.length > 0;
    const statusText = empty.hidden ? "" : copy.empty;
    if (status.textContent !== statusText) status.textContent = statusText;
    // Inside a submenu the list is named by that folder, so a screen reader
    // hears where the keys now apply. An attribute, not text: a folder name
    // must stay out of reach of find-in-page.
    const scope = state.rows.find((row) => row.kind === "heading" && row.id === state.scope);
    list.setAttribute("aria-label", scope?.kind === "heading" ? scope.title : copy.title);
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
      // A destination's own key, as in the browser menu. Only a bare
      // keystroke counts, so shortcuts and typed capitals with Ctrl, Alt, or
      // Meta held are left to the filter and the browser.
      // Nor does an auto-repeat: the key that opened the picker by a keyboard
      // command may still be held after its modifiers are released, and its
      // repeats would land here as a bare key and save without a choice.
      const keyAction =
        event.ctrlKey || event.altKey || event.metaKey || event.repeat
          ? null
          : pickerKeyAction(state, event.key);
      if (keyAction !== null) {
        event.preventDefault();
        if (keyAction.kind === "pick") {
          pick(keyAction.id);
        } else {
          // A submenu heading's key steps into it, as it opens that submenu in
          // the browser menu; its children's keys are the live ones now.
          state = keyAction.state;
          render();
        }
      } else if (event.key === "Backspace" && state.query === "" && state.scope !== null) {
        event.preventDefault();
        state = leavePickerScope(state);
        render();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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

  // The rows are what the background listed when the picker opened. Left open
  // behind another tab or window, they go stale: Last used moves on, and a
  // folder's id is its position in a list that may be edited meanwhile, so a
  // later Enter would save somewhere other than the row says. A picker the
  // user walked away from closes instead.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) close();
    },
    { signal },
  );
  window.addEventListener("blur", close, { signal });

  closeActivePicker = close;
  document.documentElement.append(host);
  render();
  filter.focus({ preventScroll: true });
  return true;
};
