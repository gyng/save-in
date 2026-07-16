import { isSourceSort, type SourceSort } from "./source-panel-model.ts";
import { saveSourceSort } from "./source-panel-layout.ts";
import { activePanelHost } from "./source-panel-host.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

/** The filter/sort toolbar and the (empty, row-render-populated) kind
 * facets bar beneath it. Exposes applyStoredSortPreference so the caller
 * can restore the persisted sort choice once storage resolves, without
 * clobbering a sort the user already changed or a panel that already
 * closed. */
export const wirePanelFilterSort = (ctx: SourcePanelContext): void => {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = ctx.copy.filterSources;
  filter.setAttribute("aria-label", ctx.copy.filterLabel);
  const sort = document.createElement("select");
  sort.setAttribute("aria-label", ctx.copy.sortLabel);
  const sortOptions: ReadonlyArray<readonly [SourceSort, keyof typeof ctx.copy.sort]> = [
    ["relevance", "relevance"],
    ["detected-desc", "newest"],
    ["detected-asc", "oldest"],
    ["size-desc", "largest"],
    ["name-asc", "name"],
  ];
  sortOptions.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = ctx.copy.sort[label];
    sort.append(option);
  });
  sort.value = "relevance";
  toolbar.append(filter, sort);
  const facets = document.createElement("div");
  facets.className = "facets";
  facets.setAttribute("aria-label", ctx.copy.filterLabel);

  let filterTimer = 0;
  filter.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => ctx.render(), 80);
  });
  let sortChanged = false;
  sort.addEventListener("change", () => {
    if (!isSourceSort(sort.value)) return;
    sortChanged = true;
    saveSourceSort(sort.value);
    ctx.render();
  });

  ctx.toolbar = toolbar;
  ctx.filter = filter;
  ctx.sort = sort;
  ctx.facets = facets;
  ctx.sortOptions = sortOptions;
  ctx.applyStoredSortPreference = (storedSort: SourceSort) => {
    if (sortChanged || activePanelHost !== ctx.host) return;
    sort.value = storedSort;
    ctx.render();
  };
  ctx.cleanupTasks.push(() => window.clearTimeout(filterTimer));
};
