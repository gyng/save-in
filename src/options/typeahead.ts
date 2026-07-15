export type TypeaheadItem = {
  value: string;
  label: string;
  group?: string;
  description?: string;
  meta?: string;
  searchText?: string;
};

type TypeaheadOptions = {
  items: readonly TypeaheadItem[] | (() => readonly TypeaheadItem[]);
  onSelect: (item: TypeaheadItem) => void;
  preferredWidth?: number;
  maxResults?: number;
  variant?: "reference";
};

let typeaheadSequence = 0;

const normalized = (value: string): string => value.trim().toLocaleLowerCase();

const matchingItems = (
  items: readonly TypeaheadItem[],
  query: string,
  maxResults: number,
): readonly TypeaheadItem[] => {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return items
    .filter((item) => {
      if (terms.length === 0) return true;
      const searchable = normalized(
        `${item.label} ${item.description ?? ""} ${item.meta ?? ""} ${item.searchText ?? ""}`,
      );
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, maxResults);
};

export const attachTypeahead = (
  input: HTMLInputElement,
  options: TypeaheadOptions,
): (() => void) => {
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const listbox = document.createElement("div");
  const listboxId = `typeahead-${input.id || ++typeaheadSequence}`;
  listbox.id = listboxId;
  listbox.className = "typeahead-dropdown";
  if (options.variant) listbox.classList.add(`typeahead-dropdown-${options.variant}`);
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  document.body.append(listbox);

  input.autocomplete = "off";
  input.classList.add("typeahead-input");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listboxId);
  input.setAttribute("aria-expanded", "false");

  let active = -1;
  let visibleItems: readonly TypeaheadItem[] = [];
  let keyboardSearch = "";
  let keyboardSearchTimer: number | null = null;

  const availableItems = (): readonly TypeaheadItem[] =>
    typeof options.items === "function" ? options.items() : options.items;

  const close = (): void => {
    if (keyboardSearchTimer !== null) window.clearTimeout(keyboardSearchTimer);
    keyboardSearch = "";
    keyboardSearchTimer = null;
    listbox.hidden = true;
    listbox.replaceChildren();
    visibleItems = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const position = (): void => {
    if (listbox.hidden) return;
    const rect = input.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const preferredWidth = options.preferredWidth ?? rect.width;
    const availableWidth =
      window.innerWidth > edge * 2 ? window.innerWidth - edge * 2 : preferredWidth;
    const width = Math.min(Math.max(rect.width, preferredWidth), availableWidth);
    listbox.style.width = `${width}px`;
    const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge));
    listbox.style.left = `${left}px`;
    listbox.style.maxHeight = "";
    const desiredHeight = listbox.offsetHeight;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
    const spaceAbove = Math.max(0, rect.top - gap - edge);
    const openAbove = desiredHeight > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = openAbove ? spaceAbove : spaceBelow;
    const height = Math.min(desiredHeight, availableHeight);
    listbox.style.maxHeight = `${height}px`;
    listbox.style.top = openAbove
      ? `${Math.max(edge, rect.top - gap - height)}px`
      : `${Math.max(edge, rect.bottom + gap)}px`;
  };

  const setActive = (next: number): void => {
    const rows = [...listbox.querySelectorAll<HTMLElement>("[role=option]")];
    if (rows.length === 0) return close();
    active = (next + rows.length) % rows.length;
    rows.forEach((row, index) => row.setAttribute("aria-selected", String(index === active)));
    const selected = rows[active];
    /* v8 ignore next -- A non-empty row list and modulo index always select a row. */
    if (!selected) return;
    input.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView?.({ block: "nearest" });
  };

  const choose = (index: number): void => {
    const item = visibleItems[index];
    if (!item) return close();
    input.value = item.value;
    close();
    options.onSelect(item);
    input.focus();
  };

  const render = (showAll = false): void => {
    const items = availableItems();
    const maxResults = showAll && input.readOnly ? items.length : (options.maxResults ?? 12);
    visibleItems = matchingItems(items, showAll ? "" : input.value, maxResults);
    listbox.replaceChildren();
    if (visibleItems.length === 0) return close();
    let previousGroup = "";
    visibleItems.forEach((item, index) => {
      if (item.group && item.group !== previousGroup) {
        const heading = document.createElement("div");
        heading.className = "typeahead-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = item.group;
        listbox.append(heading);
        previousGroup = item.group;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.id = `${listboxId}-option-${index}`;
      row.className = "typeahead-option";
      row.setAttribute("role", "option");
      row.tabIndex = -1;
      const label = document.createElement("span");
      label.className = "typeahead-option-label";
      label.textContent = item.label;
      row.append(label);
      if (item.meta) {
        const meta = document.createElement("span");
        meta.className = "typeahead-option-meta";
        meta.textContent = item.meta;
        meta.title = item.meta;
        row.append(meta);
      }
      if (item.description) {
        const description = document.createElement("small");
        description.className = "typeahead-option-description";
        description.textContent = item.description;
        row.append(description);
      }
      row.addEventListener("mousedown", (event) => event.preventDefault(), listenerOptions);
      row.addEventListener("click", () => choose(index), listenerOptions);
      listbox.append(row);
    });
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    position();
    const current = visibleItems.findIndex(
      (item) => normalized(item.value) === normalized(input.value),
    );
    setActive(current >= 0 ? current : 0);
  };

  input.addEventListener("focus", () => render(true), listenerOptions);
  input.addEventListener(
    "click",
    () => {
      if (listbox.hidden) render(true);
    },
    listenerOptions,
  );
  input.addEventListener("input", () => render(), listenerOptions);
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (listbox.hidden) {
          render(true);
          if (!listbox.hidden && event.key === "ArrowUp") setActive(visibleItems.length - 1);
          return;
        }
        setActive(active + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter" && !listbox.hidden) {
        event.preventDefault();
        choose(active);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        close();
      } else if (
        input.readOnly &&
        event.key.length === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (listbox.hidden) render(true);
        const key = normalized(event.key);
        let nextSearch = `${keyboardSearch}${key}`;
        let match = visibleItems.findIndex((item) => normalized(item.label).startsWith(nextSearch));
        if (match < 0) {
          nextSearch = key;
          match = visibleItems.findIndex((item) => normalized(item.label).startsWith(nextSearch));
        }
        keyboardSearch = nextSearch;
        if (match >= 0) setActive(match);
        if (keyboardSearchTimer !== null) window.clearTimeout(keyboardSearchTimer);
        keyboardSearchTimer = window.setTimeout(() => {
          keyboardSearch = "";
          keyboardSearchTimer = null;
        }, 700);
      }
    },
    listenerOptions,
  );
  input.addEventListener("blur", close, listenerOptions);
  document.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target;
      if (target === input || (target instanceof Node && listbox.contains(target))) return;
      close();
    },
    listenerOptions,
  );
  window.addEventListener("resize", position, listenerOptions);
  document.addEventListener("scroll", position, { capture: true, signal: controller.signal });

  return () => {
    if (keyboardSearchTimer !== null) window.clearTimeout(keyboardSearchTimer);
    controller.abort();
    listbox.remove();
    input.classList.remove("typeahead-input");
    input.removeAttribute("role");
    input.removeAttribute("aria-autocomplete");
    input.removeAttribute("aria-controls");
    input.removeAttribute("aria-expanded");
    input.removeAttribute("aria-activedescendant");
  };
};
