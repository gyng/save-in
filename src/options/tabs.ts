// Progressive enhancement: groups the options form's <h2> sections into
// tabbed panels. Runs entirely at load time and touches no option element
// or its id, so the page degrades to a single scrolling form if this script
// is absent or errors. The selected tab is remembered in localStorage.

const TAB_STORAGE_KEY = "si-options-tab";

// The <h2> that heads a section: the node itself, or (for a section whose
// content is wrapped, e.g. Dynamic Downloads in a label.column) its first
// element child.
const sectionHeading = (node) => {
  if (node.tagName === "H2") {
    return node;
  }
  const first = node.firstElementChild;
  return first && first.tagName === "H2" ? first : null;
};

// The heading's own label text, ignoring nested controls (e.g. the reset
// button inside the "More Options" heading).
export const headingLabel = (heading) =>
  Array.from(heading.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("")
    .trim();

// Splits the form's children into [{ heading, nodes }] runs, one per section.
export const collectSections = (form) => {
  const sections = [];
  let current = null;

  Array.from(form.children).forEach((node) => {
    const heading = sectionHeading(node);
    if (heading) {
      current = { heading, nodes: [node] };
      sections.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
  });

  return sections;
};

export const setupTabs = () => {
  const form = document.getElementById("options");
  if (!form) {
    return;
  }

  const sections = collectSections(form);
  // Nothing to tab if the form isn't the expected multi-section shape
  if (sections.length < 2) {
    return;
  }

  const tablist = document.createElement("div");
  tablist.className = "tablist";
  tablist.setAttribute("role", "tablist");

  const panels = sections.map((section, index) => {
    const panel = document.createElement("section");
    panel.className = "tab-panel";
    panel.id = `tab-panel-${index}`;
    panel.setAttribute("role", "tabpanel");
    // The active tab already labels the section; an in-panel heading
    // would just duplicate it
    section.heading.classList.add("tab-heading-hidden");
    section.nodes.forEach((node) => panel.appendChild(node));
    return panel;
  });

  const tabs = sections.map((section, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.id = `tab-${index}`;
    tab.setAttribute("role", "tab");
    tab.textContent = headingLabel(section.heading);
    tab.dataset.index = String(index);
    return tab;
  });

  let currentIndex = -1;

  const select = (index) => {
    // Leaving a tab with unsaved editor changes prompts to save/discard
    // (main tabs don't unload the page, so beforeunload can't cover this)
    if (
      currentIndex !== -1 &&
      index !== currentIndex &&
      typeof window.confirmPendingChanges === "function"
    ) {
      window.confirmPendingChanges();
    }
    currentIndex = index;

    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      panels[i].classList.toggle("active", selected);
    });
    try {
      localStorage.setItem(TAB_STORAGE_KEY, String(index));
    } catch (e) {
      // localStorage may be unavailable; selection just won't persist
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
        return;
      }
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (index + delta + tabs.length) % tabs.length;
      tabs[next].focus();
      select(next);
    });
    tablist.appendChild(tab);
  });

  form.prepend(tablist);
  panels.forEach((panel) => form.appendChild(panel));

  let initial = 0;
  try {
    const saved = parseInt(localStorage.getItem(TAB_STORAGE_KEY), 10);
    if (!Number.isNaN(saved) && saved >= 0 && saved < tabs.length) {
      initial = saved;
    }
  } catch (e) {
    // ignore
  }
  select(initial);
};

document.addEventListener("DOMContentLoaded", setupTabs);

export { TAB_STORAGE_KEY };
