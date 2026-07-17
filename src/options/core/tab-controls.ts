const TAB_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export const nextTabIndex = (key: string, current: number, count: number): number => {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  return (current + delta + count) % count;
};

export const syncTabSelection = (
  tabs: readonly HTMLElement[],
  panels: readonly HTMLElement[],
  selectedIndex: number,
): void => {
  tabs.forEach((tab, index) => {
    const selected = index === selectedIndex;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel, index) => {
    const selected = index === selectedIndex;
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });
};

export const bindTabInteractions = (
  tabs: readonly HTMLElement[],
  select: (index: number, focus: boolean) => void,
): void => {
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index, false));
    tab.addEventListener("keydown", (event) => {
      if (!TAB_KEYS.has(event.key)) return;
      event.preventDefault();
      const next = nextTabIndex(event.key, index, tabs.length);
      select(next, true);
    });
  });
};
