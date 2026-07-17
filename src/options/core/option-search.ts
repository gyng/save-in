import { getMessage } from "../../platform/localization.ts";
import { setupAnchoredFloatingSurface } from "../ui/anchored-floating-surface.ts";

type SearchEntry = {
  control: HTMLElement;
  label: string;
  path: string[];
  target: HTMLElement;
};

const normalizedText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, " ").trim() || "";

const labelledByText = (control: HTMLElement): string => {
  const ids = control.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) || [];
  return normalizedText(
    ids
      .map((id) => control.ownerDocument.getElementById(id)?.textContent)
      .filter(Boolean)
      .join(" "),
  );
};

const headingPath = (target: HTMLElement, panel: HTMLElement): string[] => {
  const headings = [...panel.querySelectorAll<HTMLElement>("h3, h4, h5")];
  const levels = new Map<number, string>();
  for (const heading of headings) {
    if (!(heading.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const scope = heading.closest<HTMLElement>(
      "details, dialog, fieldset, section:not(.tab-panel), [data-behavior-group], [data-option-search-group]",
    );
    if (scope && !scope.contains(target)) continue;
    const name = normalizedText(heading.textContent);
    if (!name) continue;
    const level = Number(heading.tagName.slice(1));
    [...levels.keys()].filter((key) => key >= level).forEach((key) => levels.delete(key));
    levels.set(level, name);
  }
  return [...levels.entries()].toSorted(([left], [right]) => left - right).map(([, name]) => name);
};

const fieldsetPath = (target: HTMLElement, panel: HTMLElement): string[] => {
  const path: string[] = [];
  let current = target.parentElement;
  while (current && current !== panel) {
    if (current instanceof HTMLFieldSetElement) {
      const legend = current.querySelector<HTMLElement>(":scope > legend");
      const name = normalizedText(legend?.textContent);
      if (name) path.unshift(name);
    }
    current = current.parentElement;
  }
  return path;
};

const uniquePath = (segments: readonly string[], label: string): string[] => {
  const seen = new Set<string>();
  const labelKey = label.toLocaleLowerCase();
  return segments.filter((segment) => {
    const key = segment.toLocaleLowerCase();
    if (!segment || key === labelKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const displayedPath = (path: readonly string[]): string[] => {
  const first = path[0];
  return path.length > 3 && first !== undefined ? [first, ...path.slice(-2)] : [...path];
};

const textWords = (text: string): string[] => text.match(/[\p{L}\p{N}]+/gu) || [];

const matchQuality = (text: string, query: string, terms: readonly string[]): number => {
  if (text === query) return 5;
  if (text.startsWith(query)) return 4;
  const words = textWords(text);
  if (terms.every((term) => words.includes(term))) return 3;
  if (terms.every((term) => words.some((word) => word.startsWith(term)))) return 2;
  return terms.every((term) => text.includes(term)) ? 1 : 0;
};

const termCoverage = (text: string, terms: readonly string[]): number =>
  terms.filter((term) => text.includes(term)).length;

export const optionSearchEntries = (
  form: HTMLElement,
  additionalControls: readonly HTMLElement[] = [],
): SearchEntry[] => {
  const explicitLabels = new Map(
    [...form.ownerDocument.querySelectorAll<HTMLLabelElement>("label[for]")].map((label) => [
      label.htmlFor,
      label,
    ]),
  );
  const pathFor = (target: HTMLElement, label: string) => {
    const panel = target.closest<HTMLElement>(".tab-panel");
    if (!panel) return [];
    const tab = form.ownerDocument.querySelector<HTMLElement>(`[aria-controls="${panel.id}"]`);
    return uniquePath(
      [
        normalizedText(tab?.textContent),
        ...headingPath(target, panel),
        ...fieldsetPath(target, panel),
      ],
      label,
    );
  };
  return [
    ...form.querySelectorAll<HTMLElement>(
      'h3, h4, h5, input[id], select[id], textarea[id], button[id][data-option-search="true"]',
    ),
    ...additionalControls,
  ].flatMap((control) => {
    if (control.matches("h3, h4, h5")) {
      const name = normalizedText(control.textContent);
      if (!name) return [];
      control.tabIndex = -1;
      return [{ control, label: name, path: pathFor(control, name), target: control }];
    }
    if (control.dataset.optionSearch === "false" || control.id === "option-search") return [];
    const label = explicitLabels.get(control.id);
    const wrappingLabel = control.closest("label");
    const labelElement = label || wrappingLabel;
    const shortLabel = labelElement?.querySelector<HTMLElement>(":scope > .opt-title");
    const accessibleName =
      normalizedText(control.getAttribute("aria-label")) || labelledByText(control);
    const labelText = normalizedText(shortLabel?.textContent || labelElement?.textContent);
    const actionText =
      control instanceof HTMLButtonElement ? normalizedText(control.textContent) : "";
    const name = accessibleName || labelText || actionText;
    if (!name) return [];
    const explicitTarget = control.dataset.optionSearchTarget;
    const target = explicitTarget
      ? /* v8 ignore next -- Missing legacy search targets intentionally fall back to their control. */
        form.ownerDocument.getElementById(explicitTarget) || control
      : control;
    return [
      {
        control,
        label: name,
        path: pathFor(control, name),
        target,
      },
    ];
  });
};

export const setupOptionSearch = (): void => {
  const form = document.getElementById("options");
  const topNav = document.querySelector<HTMLElement>(".top-nav");
  const primaryNav = document.querySelector<HTMLElement>(".top-nav > div:first-child");
  const toolsNav = document.querySelector<HTMLElement>(".top-nav-tools");
  if (!form || document.getElementById("option-search")) return;

  const language = document.getElementById("uiLocale");
  const entries = optionSearchEntries(form, language ? [language] : []);
  const wrap = document.createElement("div");
  wrap.className = "option-search";
  const input = document.createElement("input");
  input.id = "option-search";
  input.dataset.runtimeControl = "true";
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = getMessage("o_lSearchOptions") || "Search options";
  input.setAttribute("aria-label", input.placeholder);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  const results = document.createElement("div");
  results.className = "option-search-results";
  results.id = "option-search-results";
  results.setAttribute("role", "listbox");
  results.hidden = true;
  input.setAttribute("aria-controls", results.id);
  wrap.append(input, results);
  const floatingResults = setupAnchoredFloatingSurface(input, results, {
    isOpen: () => !results.hidden,
  });
  const saveStatus = topNav?.querySelector<HTMLElement>(":scope > .save-status");
  if (primaryNav && topNav) {
    if (saveStatus) primaryNav.append(saveStatus);
    (toolsNav || topNav).append(wrap);
  } else {
    form.prepend(wrap);
  }

  let active = -1;
  let visibleEntries: SearchEntry[] = [];
  let blurTimer: number | null = null;
  const close = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
    visibleEntries = [];
  };
  const choose = (entry: SearchEntry) => {
    close();
    input.value = "";
    document.dispatchEvent(
      new CustomEvent("save-in:navigate-option", { detail: { target: entry.target } }),
    );
  };
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    active = -1;
    if (!query) return close();
    const terms = query.split(/\s+/);
    visibleEntries = entries
      .map((entry, index) => {
        const label = entry.label.toLocaleLowerCase();
        const path = entry.path.map((segment) => segment.toLocaleLowerCase());
        const nearestPath = path.at(-1) || "";
        const fullPath = path.join(" ");
        const searchable = `${label} ${fullPath}`;
        return {
          entry,
          index,
          labelQuality: matchQuality(label, query, terms),
          labelCoverage: termCoverage(label, terms),
          nearestPathQuality: matchQuality(nearestPath, query, terms),
          nearestPathCoverage: termCoverage(nearestPath, terms),
          fullPathQuality: matchQuality(fullPath, query, terms),
          fullPathCoverage: termCoverage(fullPath, terms),
          depth: path.length,
          matches: terms.every((term) => searchable.includes(term)),
        };
      })
      .filter(({ matches }) => matches)
      .toSorted(
        (left, right) =>
          right.labelQuality - left.labelQuality ||
          right.labelCoverage - left.labelCoverage ||
          right.nearestPathQuality - left.nearestPathQuality ||
          right.nearestPathCoverage - left.nearestPathCoverage ||
          right.fullPathQuality - left.fullPathQuality ||
          right.fullPathCoverage - left.fullPathCoverage ||
          left.depth - right.depth ||
          left.index - right.index,
      )
      .map(({ entry }) => entry)
      .slice(0, 12);
    visibleEntries.forEach((entry, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `option-search-result-${index}`;
      option.setAttribute("role", "option");
      option.tabIndex = -1;
      const label = document.createElement("span");
      label.className = "option-search-result-label";
      label.textContent = entry.label;
      option.append(label);
      if (entry.path.length > 0) {
        const location = document.createElement("small");
        location.className = "option-search-result-location";
        location.textContent = displayedPath(entry.path).join(" › ");
        location.title = entry.path.join(" › ");
        option.append(location);
      }
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(entry));
      results.appendChild(option);
    });
    results.hidden = results.childElementCount === 0;
    if (results.hidden) return close();
    input.setAttribute("aria-expanded", "true");
    setActive(0);
    floatingResults.position();
  };
  const setActive = (next: number) => {
    const options = [...results.querySelectorAll<HTMLElement>("[role=option]")];
    if (options.length === 0) return close();
    active = (next + options.length) % options.length;
    options.forEach((option, index) =>
      option.setAttribute("aria-selected", String(index === active)),
    );
    const activeOption = options[active];
    /* v8 ignore next -- A non-empty option list and modulo index always select an option. */
    if (!activeOption) return close();
    input.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView?.({ block: "nearest" });
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", () => {
    if (blurTimer !== null) window.clearTimeout(blurTimer);
    blurTimer = null;
    if (results.hidden && input.value.trim()) render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.hidden) {
        render();
        if (results.hidden) return;
        if (event.key === "ArrowUp") {
          setActive(visibleEntries.length - 1);
        }
        return;
      }
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && visibleEntries.length > 0) {
      event.preventDefault();
      const entry = visibleEntries[active];
      const option = results.querySelector<HTMLElement>(`#option-search-result-${active}`);
      if (!entry || !option) return close();
      choose(entry);
    } else if (event.key === "Escape") close();
  });
  input.addEventListener("blur", () => {
    if (blurTimer !== null) window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      blurTimer = null;
      close();
    }, 100);
  });
};
