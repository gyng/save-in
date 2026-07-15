// Progressive enhancement: groups the options form's <h2> sections into
// tabbed panels. Runs entirely at load time and touches no option element
// or its id, so the page degrades to a single scrolling form if this script
// is absent or errors. The selected tab is remembered in localStorage.

import { bindTabInteractions, syncTabSelection } from "./tab-controls.ts";

const TAB_STORAGE_KEY = "si-options-tab";
const STORED_TAB_REDIRECTS: Readonly<Record<string, string>> = {
  "section-notifications": "section-more-options",
};
const LEGACY_POSITION_KEYS = [
  "section-downloads",
  "section-dynamic-downloads",
  "section-notifications",
  "section-save-as-shortcuts",
  "section-keyboard-shortcuts",
  "section-history",
  "section-more-options",
];

type TabSection = { heading: HTMLElement; nodes: HTMLElement[]; key: string };
type TabsOptions = {
  confirmPendingChanges?: () => boolean | Promise<boolean>;
  onGuardError?: (error: unknown) => void;
  label?: string;
};
const PRIMARY_SECTION_ORDER = [
  "section-downloads",
  "section-dynamic-downloads",
  "section-browser-downloads",
  "section-keyboard-shortcuts",
  "section-save-as-shortcuts",
  "section-page-sources",
  "section-history",
  "section-more-options",
];

export const orderSections = (sections: TabSection[]): TabSection[] =>
  [...sections].toSorted((a, b) => {
    const ai = PRIMARY_SECTION_ORDER.indexOf(a.key);
    const bi = PRIMARY_SECTION_ORDER.indexOf(b.key);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });

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

export const setupTabs = ({
  confirmPendingChanges,
  onGuardError,
  label = "Settings sections",
}: TabsOptions = {}): void => {
  const form = document.getElementById("options");
  if (!form) {
    return;
  }

  const sections = orderSections(collectSections(form));
  // Nothing to tab if the form isn't the expected multi-section shape
  if (sections.length < 2) {
    return;
  }

  const tablist = document.createElement("div");
  tablist.className = "tablist";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", label);

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
  const revealTab = (index: number): void => {
    tabs[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const activate = (index: number): void => {
    const section = sections[index];
    if (!section || !tabs[index] || !panels[index]) return;
    currentIndex = index;

    syncTabSelection(tabs, panels, index);
    revealTab(index);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, section.key);
    } catch (e) {
      // localStorage may be unavailable; selection just won't persist
    }
  };

  const select = (index: number, focusOnActivate = false, afterActivate?: () => void): void => {
    const mine = ++navigationGeneration;
    const restoreFocus = (): void => {
      tabs[currentIndex]?.focus();
    };
    const finishGuardedNavigation = (allowed: boolean): void => {
      if (mine !== navigationGeneration) return;
      if (!allowed) {
        restoreFocus();
        return;
      }
      activate(index);
      if (focusOnActivate) tabs[index]?.focus();
      afterActivate?.();
    };
    const failGuardedNavigation = (error: unknown): void => {
      try {
        onGuardError?.(error);
      } catch {
        // Error reporting must not turn a contained guard failure into an unhandled rejection.
      }
      if (mine === navigationGeneration) restoreFocus();
    };
    // Leaving a tab with unsaved editor changes prompts to save/discard
    // (main tabs don't unload the page, so beforeunload can't cover this)
    if (currentIndex !== -1 && index !== currentIndex && confirmPendingChanges) {
      let allowed: boolean | Promise<boolean>;
      try {
        allowed = confirmPendingChanges();
      } catch (error) {
        failGuardedNavigation(error);
        return;
      }
      if (typeof allowed !== "boolean") {
        void allowed.then(finishGuardedNavigation, failGuardedNavigation);
        return;
      }
      if (!allowed) {
        restoreFocus();
        return;
      }
    }
    activate(index);
    if (focusOnActivate) tabs[index]?.focus();
    afterActivate?.();
  };

  bindTabInteractions(tabs, (index, focus) => select(index, focus));
  window.addEventListener("resize", () => revealTab(currentIndex), { passive: true });
  tabs.forEach((tab) => tablist.appendChild(tab));

  form.prepend(tablist);
  panels.forEach((panel) => form.appendChild(panel));

  document.addEventListener("save-in:navigate-option", (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detailTarget: unknown = Reflect.get(event.detail ?? {}, "target");
    const target = detailTarget instanceof HTMLElement ? detailTarget : undefined;
    const panel = target?.closest<HTMLElement>(".tab-panel");
    const index = panel ? panels.indexOf(panel) : -1;
    if (!target || index < 0) return;
    select(index, false, () => {
      const rowTarget =
        target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)
          ? target.closest<HTMLElement>("label")
          : null;
      const highlightTarget = rowTarget || target;
      target.focus({ preventScroll: true });
      highlightTarget.scrollIntoView?.({ block: "center", behavior: "smooth" });
      highlightTarget.classList.add(
        rowTarget ? "option-search-target-row" : "option-search-target",
      );
      window.setTimeout(
        () => highlightTarget.classList.remove("option-search-target", "option-search-target-row"),
        1600,
      );
    });
  });

  let initial = 0;
  try {
    const rawStored = localStorage.getItem(TAB_STORAGE_KEY);
    const stored = rawStored ? (STORED_TAB_REDIRECTS[rawStored] ?? rawStored) : rawStored;
    const stableIndex = sections.findIndex((section) => section.key === stored);
    if (stableIndex >= 0) {
      initial = stableIndex;
    } else {
      // Migrate the pre-4.0 positional value without losing the user's tab.
      const saved = stored == null ? Number.NaN : parseInt(stored, 10);
      if (!Number.isNaN(saved) && saved >= 0 && saved < LEGACY_POSITION_KEYS.length) {
        const storedLegacyKey = LEGACY_POSITION_KEYS[saved]!;
        const legacyKey = STORED_TAB_REDIRECTS[storedLegacyKey] ?? storedLegacyKey;
        const legacyIndex = sections.findIndex(({ key }) => key === legacyKey);
        initial = legacyIndex >= 0 ? legacyIndex : saved;
      }
    }
  } catch (e) {
    // ignore
  }
  select(initial);
};

export { TAB_STORAGE_KEY };
