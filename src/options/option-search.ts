import { getMessage } from "../platform/localization.ts";

type SearchEntry = { control: HTMLElement; label: string; section: string };

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
  const sectionFor = (target: HTMLElement) => {
    const panel = target.closest<HTMLElement>(".tab-panel");
    const tab = panel ? document.querySelector<HTMLElement>(`[aria-controls="${panel.id}"]`) : null;
    return tab?.textContent?.trim() || "";
  };
  return [
    ...form.querySelectorAll<HTMLElement>("h3, h4, input[id], select[id], textarea[id]"),
    ...additionalControls,
  ].flatMap((control) => {
    if (control.matches("h3, h4")) {
      const name = control.textContent?.replace(/\s+/g, " ").trim();
      if (!name) return [];
      control.tabIndex = -1;
      return [{ control, label: name, section: sectionFor(control) }];
    }
    if (control.dataset.optionSearch === "false" || control.id === "option-search") return [];
    const label = explicitLabels.get(control.id);
    const wrappingLabel = control.closest("label");
    const labelElement = label || wrappingLabel;
    const shortLabel = labelElement?.querySelector<HTMLElement>(":scope > .opt-title");
    const labelText =
      shortLabel?.textContent?.trim() || labelElement?.textContent?.replace(/\s+/g, " ").trim();
    const accessibleName = control.getAttribute("aria-label")?.trim();
    const name = labelText || accessibleName;
    if (!name) return [];
    return [
      {
        control,
        label: name,
        section: sectionFor(control),
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
      new CustomEvent("save-in:navigate-option", { detail: { target: entry.control } }),
    );
  };
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    active = -1;
    if (!query) return close();
    visibleEntries = entries
      .filter(({ label, section }) => `${label} ${section}`.toLocaleLowerCase().includes(query))
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
      const section = document.createElement("small");
      section.className = "option-search-result-location";
      section.textContent = entry.section;
      option.append(label, section);
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(entry));
      results.appendChild(option);
    });
    results.hidden = results.childElementCount === 0;
    if (results.hidden) return close();
    input.setAttribute("aria-expanded", "true");
    setActive(0);
  };
  const setActive = (next: number) => {
    const options = [...results.querySelectorAll<HTMLElement>("[role=option]")];
    if (options.length === 0) return close();
    active = (next + options.length) % options.length;
    options.forEach((option, index) =>
      option.setAttribute("aria-selected", String(index === active)),
    );
    const activeOption = options[active]!;
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
      choose(visibleEntries[active]!);
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
