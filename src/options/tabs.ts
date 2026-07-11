// Progressive enhancement: groups the options form's <h2> sections into
// tabbed panels. Runs entirely at load time and touches no option element
// or its id, so the page degrades to a single scrolling form if this script
// is absent or errors. The selected tab is remembered in localStorage.

const TAB_STORAGE_KEY = "si-options-tab";

type TabSection = { heading: HTMLElement; nodes: HTMLElement[]; key: string };

// The <h2> that heads a section: the node itself, or (for a section whose
// content is wrapped, e.g. Dynamic Downloads in a label.column) its first
// element child.
const sectionHeading = (node: HTMLElement): HTMLElement | null => {
  if (node.tagName === "H2") {
    return node;
  }
  const first = node.firstElementChild;
  return first instanceof HTMLElement && first.tagName === "H2" ? first : null;
};

// The heading's own label text, ignoring nested controls (e.g. the reset
// button inside the "More Options" heading).
export const headingLabel = (heading: HTMLElement): string =>
  Array.from(heading.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("")
    .trim();

// Splits the form's children into [{ heading, nodes }] runs, one per section.
export const collectSections = (form: HTMLElement): TabSection[] => {
  const sections: TabSection[] = [];
  let current: TabSection | null = null;

  Array.from(form.children).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const heading = sectionHeading(node);
    if (heading) {
      current = {
        heading,
        nodes: [node],
        key: heading.id || `section-${sections.length}`,
      };
      sections.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
  });

  return sections;
};

export const setupTabs = (): void => {
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

  const panels = sections.map((section) => {
    const panel = document.createElement("section");
    panel.className = "tab-panel";
    panel.id = `tab-panel-${section.key}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${section.key}`);
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
    tab.id = `tab-${section.key}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `tab-panel-${section.key}`);
    tab.textContent = headingLabel(section.heading);
    tab.dataset.index = String(index);
    return tab;
  });

  let currentIndex = -1;
  let navigationGeneration = 0;

  const activate = (index: number): void => {
    currentIndex = index;

    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      panels[i].classList.toggle("active", selected);
    });
    try {
      localStorage.setItem(TAB_STORAGE_KEY, sections[index].key);
    } catch (e) {
      // localStorage may be unavailable; selection just won't persist
    }
  };

  const select = (index: number, focusOnActivate = false, afterActivate?: () => void): void => {
    const mine = ++navigationGeneration;
    // Leaving a tab with unsaved editor changes prompts to save/discard
    // (main tabs don't unload the page, so beforeunload can't cover this)
    if (
      currentIndex !== -1 &&
      index !== currentIndex &&
      typeof window.confirmPendingChanges === "function"
    ) {
      const allowed = window.confirmPendingChanges();
      if (allowed && typeof (allowed as Promise<boolean>).then === "function") {
        void (allowed as Promise<boolean>).then((result) => {
          if (mine !== navigationGeneration) return;
          if (result) {
            activate(index);
            if (focusOnActivate) tabs[index].focus();
            afterActivate?.();
          } else if (focusOnActivate && currentIndex >= 0) tabs[currentIndex].focus();
        });
        return;
      }
      if (allowed === false) {
        return;
      }
    }
    activate(index);
    if (focusOnActivate) tabs[index].focus();
    afterActivate?.();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
        return;
      }
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(next, true);
    });
    tablist.appendChild(tab);
  });

  form.prepend(tablist);
  panels.forEach((panel) => form.appendChild(panel));

  document.addEventListener("save-in:navigate-option", (event) => {
    const target = (event as CustomEvent<{ target?: HTMLElement }>).detail?.target;
    const panel = target?.closest<HTMLElement>(".tab-panel");
    const index = panel ? panels.indexOf(panel) : -1;
    if (!target || index < 0) return;
    select(index, false, () => {
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
      target.classList.add("option-search-target");
      window.setTimeout(() => target.classList.remove("option-search-target"), 1600);
    });
  });

  let initial = 0;
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    const stableIndex = sections.findIndex((section) => section.key === stored);
    if (stableIndex >= 0) {
      initial = stableIndex;
    } else {
      // Migrate the pre-4.0 positional value without losing the user's tab.
      const saved = stored == null ? Number.NaN : parseInt(stored, 10);
      if (!Number.isNaN(saved) && saved >= 0 && saved < tabs.length) {
        initial = saved;
      }
    }
  } catch (e) {
    // ignore
  }
  select(initial);
};

document.addEventListener("DOMContentLoaded", setupTabs);

export { TAB_STORAGE_KEY };
