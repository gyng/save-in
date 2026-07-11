import { webExtensionApi } from "../platform/web-extension-api.ts";

type SearchEntry = { control: HTMLElement; label: string; section: string };

export const optionSearchEntries = (form: HTMLElement): SearchEntry[] =>
  [...form.querySelectorAll<HTMLElement>("input[id], select[id], textarea[id]")]
    .filter((control) => control.dataset.optionSearch !== "false")
    .map((control) => {
      const label = [...form.querySelectorAll<HTMLLabelElement>("label[for]")].find(
        (candidate) => candidate.htmlFor === control.id,
      );
      const wrappingLabel = control.closest("label");
      const panel = control.closest<HTMLElement>(".tab-panel");
      const tab = panel
        ? document.querySelector<HTMLElement>(`[aria-controls="${panel.id}"]`)
        : null;
      return {
        control,
        label: (label || wrappingLabel)?.textContent?.replace(/\s+/g, " ").trim() || control.id,
        section: tab?.textContent?.trim() || "",
      };
    });

export const setupOptionSearch = (): void => {
  const form = document.getElementById("options");
  if (!form || document.getElementById("option-search")) return;

  const entries = optionSearchEntries(form);
  const wrap = document.createElement("div");
  wrap.className = "option-search";
  const input = document.createElement("input");
  input.id = "option-search";
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = webExtensionApi.i18n.getMessage("o_lSearchOptions") || "Search options";
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
  form.prepend(wrap);

  let active = -1;
  let visibleEntries: SearchEntry[] = [];
  const close = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
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
      const label = document.createElement("span");
      label.textContent = entry.label;
      const section = document.createElement("small");
      section.textContent = entry.section;
      option.append(label, section);
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(entry));
      results.appendChild(option);
    });
    results.hidden = results.childElementCount === 0;
    input.setAttribute("aria-expanded", String(!results.hidden));
  };
  const setActive = (next: number) => {
    const options = [...results.querySelectorAll<HTMLElement>("[role=option]")];
    if (!options.length) return;
    active = (next + options.length) % options.length;
    options.forEach((option, index) =>
      option.setAttribute("aria-selected", String(index === active)),
    );
    input.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView?.({ block: "nearest" });
  };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      const entry = visibleEntries[active];
      if (entry) choose(entry);
    } else if (event.key === "Escape") close();
  });
  input.addEventListener("blur", () => window.setTimeout(close, 100));
};

document.addEventListener("DOMContentLoaded", setupOptionSearch);
