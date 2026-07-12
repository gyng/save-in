import { filterKeyComboOptions } from "./options-logic.ts";

const OPTIONS = [
  { value: "", label: "No key — mouse button only" },
  { value: "Alt", label: "Alt / Option" },
  { value: "Ctrl", label: "Control" },
  { value: "Shift", label: "Shift" },
  { value: "Meta", label: "Command / Windows key" },
];

export const setupKeyComboPicker = () => {
  const input = document.querySelector("#contentClickToSaveCombo");
  const wrap = input instanceof HTMLElement ? input.closest(".combo-wrap") : null;
  if (!(input instanceof HTMLInputElement) || !wrap) return;

  const dropdown = document.createElement("ul");
  // Autocomplete owns its similarly shaped dropdown and its e2e selector.
  dropdown.className = "combo-dropdown";
  dropdown.id = "click-to-save-modifier-options";
  dropdown.setAttribute("role", "listbox");
  dropdown.hidden = true;
  wrap.appendChild(dropdown);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", dropdown.id);
  input.setAttribute("aria-expanded", "false");

  let activeIndex = -1;
  const rows = () => [...dropdown.querySelectorAll("li")];
  const highlight = (index: number) => {
    activeIndex = index;
    rows().forEach((row, rowIndex) => {
      row.classList.toggle("selected", rowIndex === index);
      row.setAttribute("aria-selected", String(rowIndex === index));
    });
    const active = rows()[index];
    if (active) input.setAttribute("aria-activedescendant", active.id);
    else input.removeAttribute("aria-activedescendant");
  };
  const close = () => {
    dropdown.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  };
  const choose = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };
  const open = (filter: boolean) => {
    dropdown.replaceChildren();
    filterKeyComboOptions(OPTIONS, filter ? input.value : "").forEach((option) => {
      const row = document.createElement("li");
      row.id = `click-to-save-modifier-${dropdown.children.length}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      const value = document.createElement("span");
      value.className = "combo-value";
      value.textContent = option.value || "None";
      const label = document.createElement("span");
      label.className = "combo-label";
      label.textContent = option.label;
      row.append(value, label);
      row.dataset.value = option.value;
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(option.value);
      });
      dropdown.appendChild(row);
    });
    activeIndex = -1;
    dropdown.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  input.addEventListener("focus", () => open(false));
  input.addEventListener("click", () => open(false));
  input.addEventListener("input", () => open(true));
  input.addEventListener("blur", () => window.setTimeout(close, 120));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return close();
    if (dropdown.hidden) {
      if (event.key === "ArrowDown") open(false);
      return;
    }
    const items = rows();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight(Math.min(activeIndex + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(items[activeIndex].dataset.value || "");
    }
  });
};
