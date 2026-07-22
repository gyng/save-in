import {
  createSourceTooltip,
  filterPageSources,
  isSourceSort,
  positionSourceTooltip,
  sortPageSources,
  type PageSource,
  type PageSourceKind,
} from "./source-panel-model.ts";
import {
  SOURCE_PANEL_COPY_URL_SLOT,
  SOURCE_PANEL_COPY_VALUE_SLOT,
  formatSourcePanelCopy,
} from "../shared/source-panel-copy.ts";
import { preferredScrollBehavior } from "../shared/motion-preference.ts";
import { sourcePanelViewport } from "./source-panel-format.ts";
import { createSourceKindIcon, setButtonIcon } from "./source-panel-icons.ts";
import type { CachedRow, SourcePanelContext } from "./source-panel-context.ts";

const SOURCE_RENDER_CHUNK_SIZE = 100;
const SOURCE_RENDER_LOAD_THRESHOLD_PX = 300;
const CONNECTED_ROW_LIMIT = SOURCE_RENDER_CHUNK_SIZE * 2;
const DETACHED_ROW_CACHE_LIMIT = SOURCE_RENDER_CHUNK_SIZE * 2;

const decodeSourcePart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Renders the filtered/sorted source list: kind facets, the empty state,
 * and per-row previews, metadata, selection checkbox, and action menu. This
 * is the panel's core view — most other builders exist to feed it state
 * (ctx.allSources, ctx.filter/sort, ctx.selectedSourceUrls) or to react to
 * what it produces (ctx.visibleSources). Also owns the "locate on page" /
 * hover-preview highlight outline, since only row actions trigger it, and
 * the row cache that keeps unaffected rows stable across re-renders. */
export const wirePanelRowRender = (ctx: SourcePanelContext): void => {
  let activeKind: "all" | PageSourceKind = "all";
  let renderedSourceStart = 0;
  let renderedSourceEnd = SOURCE_RENDER_CHUNK_SIZE;
  let visibleSourceCount = 0;
  let resultViewKey = "";
  // Reconciliation replaces sources whose DOM context changes; byte scoring stays dynamic.
  const relevanceCache = new WeakMap<PageSource, number>();
  const highlightStates = new WeakMap<HTMLElement, { outline: string; owners: Set<object> }>();
  const acquireHighlight = (target: HTMLElement, owner: object) => {
    let state = highlightStates.get(target);
    if (!state) {
      state = { outline: target.style.outline, owners: new Set() };
      highlightStates.set(target, state);
    }
    state.owners.add(owner);
    ctx.highlightedElements.add(target);
    target.style.outline = "3px solid #0a84ff";
  };
  const releaseHighlight = (target: HTMLElement, owner: object) => {
    const state = highlightStates.get(target);
    if (!state) return;
    state.owners.delete(owner);
    if (state.owners.size > 0) return;
    target.style.outline = state.outline;
    highlightStates.delete(target);
    window.setTimeout(() => ctx.highlightedElements.delete(target));
  };
  const sourceDisplay = (source: PageSource): { name: string; url: string } => {
    const parsed = new URL(source.url);
    if (parsed.protocol === "data:") {
      const mediaType = source.url.slice(5).split(/[;,]/, 1)[0] || "data";
      return { name: ctx.copy.embeddedSource, url: `data:${mediaType}` };
    }
    if (parsed.protocol === "blob:") return { name: ctx.copy.embeddedSource, url: "blob:" };
    const path = decodeSourcePart(parsed.pathname);
    const filename = path.split("/").filter(Boolean).at(-1);
    return {
      name: filename || parsed.hostname,
      url: `${parsed.hostname}${path === "/" ? "" : path}`,
    };
  };
  // Reconciliation compacts candidates into fresh records on every commit, and
  // render repoints cached.source at the new record — but listeners created by
  // buildRow still close over the record the row was built with, whose
  // originElements may name detached duplicates that no longer carry live DOM
  // evidence for css: routing. Resolve the record by URL at save time, the same
  // live read the batch save does. If the URL left the list between render and
  // click, the captured record is still the user's visible request: send it
  // rather than drop the save.
  const currentSourceRecord = (captured: PageSource): PageSource =>
    ctx.allSources.find(({ url }) => url === captured.url) ?? captured;
  const cachedRows = new WeakMap<HTMLElement, CachedRow>();
  const deactivateAndRemove = ({ row, deactivate }: CachedRow) => {
    deactivate();
    row.remove();
  };
  const evictDetachedRows = () => {
    let excess = ctx.rowCache.size - DETACHED_ROW_CACHE_LIMIT;
    if (excess <= 0) return;
    for (const [url, cached] of ctx.rowCache) {
      if (excess <= 0) break;
      if (cached.row.isConnected) continue;
      ctx.rowCache.delete(url);
      excess -= 1;
    }
  };
  ctx.deactivateAndRemove = deactivateAndRemove;

  const SOURCE_KINDS = ["all", "image", "video", "audio", "document", "stream", "link"] as const;

  // The kind filter. Counts come from every discovered source, not the
  // filtered view, so a facet always says how much it would show.
  const renderFacets = () => {
    const { copy } = ctx;
    const counts: Record<PageSourceKind, number> = {
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      stream: 0,
      link: 0,
    };
    ctx.allSources.forEach(({ kind }) => {
      counts[kind] += 1;
    });
    ctx.facets.replaceChildren();
    SOURCE_KINDS.forEach((kindName) => {
      const count = kindName === "all" ? ctx.allSources.length : counts[kindName];
      const facet = document.createElement("button");
      facet.className = "facet";
      const label = copy.kinds[kindName];
      const facetCount = document.createElement("span");
      facetCount.className = "facet-count";
      facetCount.textContent = String(count);
      facet.append(document.createTextNode(label), facetCount);
      facet.setAttribute("aria-pressed", String(activeKind === kindName));
      facet.addEventListener("click", () => {
        activeKind = kindName;
        render();
      });
      ctx.facets.append(facet);
    });
  };

  // Nothing to show: either the page has no sources at all, or the filters
  // hid them. Only the second case can be cleared.
  const renderEmptyState = () => {
    const { copy, list, rowCache } = ctx;
    const empty = document.createElement("li");
    empty.className = "empty";
    const emptyMessage = document.createElement("p");
    const normalizedFilter = ctx.filter.value.trim();
    const message = ctx.allSources.length
      ? normalizedFilter
        ? formatSourcePanelCopy(
            copy.noMatchesFilterTemplate,
            SOURCE_PANEL_COPY_VALUE_SLOT,
            normalizedFilter,
          )
        : copy.noMatches
      : copy.noSources;
    emptyMessage.textContent = message;
    empty.append(emptyMessage);
    if (ctx.allSources.length) {
      const clearFilters = document.createElement("button");
      clearFilters.type = "button";
      clearFilters.textContent = copy.clearFilters;
      clearFilters.addEventListener("click", () => {
        ctx.filter.value = "";
        activeKind = "all";
        render();
        ctx.filter.focus();
      });
      empty.append(clearFilters);
    }
    rowCache.forEach((cached) => {
      if (cached.row.isConnected) deactivateAndRemove(cached);
    });
    list.replaceChildren(empty);
    evictDetachedRows();
    ctx.copyUrls.disabled = true;
    ctx.announce(message);
  };

  const buildSelection = (
    source: PageSource,
  ): { selection: HTMLElement; selectionInput: HTMLInputElement } => {
    const selection = document.createElement("label");
    selection.className = "source-selection";
    const selectionInput = document.createElement("input");
    selectionInput.type = "checkbox";
    selectionInput.dataset.sourceUrl = source.url;
    selectionInput.checked = ctx.selectedSourceUrls.has(source.url);
    selectionInput.setAttribute("aria-label", source.url);
    selectionInput.addEventListener("pointerdown", (event) =>
      ctx.startSelectionPaint(event, selectionInput),
    );
    // A paint drag ends on a checkbox, and the click it would fire has already
    // been applied by the paint; swallow it rather than toggle back.
    selectionInput.addEventListener("click", (event) => {
      if (!ctx.suppressedSelectionClicks.has(selectionInput)) return;
      if (event.detail === 0) {
        ctx.suppressedSelectionClicks.delete(selectionInput);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectionInput.checked = ctx.selectedSourceUrls.has(source.url);
      window.setTimeout(() => ctx.suppressedSelectionClicks.delete(selectionInput));
    });
    selectionInput.addEventListener("change", () => {
      if (selectionInput.checked) ctx.selectedSourceUrls.add(source.url);
      else ctx.selectedSourceUrls.delete(source.url);
      ctx.rowCache
        .get(source.url)
        ?.updateSelection(ctx.selectedSourceUrls.has(source.url), ctx.batchSaving);
      ctx.updateSelectionUi();
    });
    selection.append(selectionInput);
    return { selection, selectionInput };
  };

  // A real media element when it can be shown, otherwise a glyph standing in
  // for the kind.
  const buildPreview = (source: PageSource): HTMLElement => {
    const { panelOptions } = ctx;
    const previewable =
      panelOptions.previews !== false &&
      source.previewable !== false &&
      ["image", "video"].includes(source.kind);
    if (previewable) {
      // Name each tag rather than choose one inside createElement: the tag-name
      // overload is what types the element, and a computed tag erases it back to
      // HTMLElement — which is why this used to re-narrow with instanceof and
      // carry a third case createElement cannot produce.
      const media =
        source.kind === "image"
          ? Object.assign(document.createElement("img"), { loading: "lazy" })
          : Object.assign(document.createElement("video"), { preload: "metadata", muted: true });
      ctx.queuePreview(media, source.url);
      return media;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "audio";
    placeholder.textContent =
      source.kind === "stream"
        ? "≋"
        : source.kind === "document"
          ? "PDF"
          : source.kind === "link"
            ? "↗"
            : panelOptions.previews === false
              ? source.kind === "image"
                ? "▧"
                : "▶"
              : source.kind === "audio"
                ? "♪"
                : "•";
    return placeholder;
  };

  // The kind badge, size, and any dimensions/duration the preview reports once
  // it loads. copy/formatters are read now, not at update time: a cached row
  // keeps the wording it was built with until the next full render.
  const buildMetaBlock = (
    source: PageSource,
    preview: HTMLElement,
  ): { meta: HTMLElement; updateBytes: (bytes: number | undefined) => void } => {
    const { copy, formatters } = ctx;
    const meta = document.createElement("div");
    meta.className = "meta";
    const mediaDetails: string[] = [];
    let displayedBytes = source.bytes;

    const formatSize = (sourceBytes: number): string =>
      !sourceBytes
        ? copy.sizeUnknown
        : sourceBytes < 1024
          ? `${formatters.number.format(sourceBytes)} B`
          : sourceBytes < 1024 * 1024
            ? `${formatters.number.format(Math.round(sourceBytes / 1024))} KB`
            : `${formatters.number.format(sourceBytes / (1024 * 1024))} MB`;

    const updateMeta = () => {
      const sourceBytes = displayedBytes || 0;
      const kindBadge = document.createElement("span");
      kindBadge.className = "kind-badge";
      const kindLabel = document.createElement("span");
      kindLabel.className = "kind-label";
      kindLabel.textContent = copy.kinds[source.kind];
      kindBadge.append(createSourceKindIcon(source.kind), kindLabel);
      const detailText = document.createElement("span");
      detailText.className = "meta-details";
      const size = document.createElement("span");
      size.className = "source-size";
      size.dataset.sizeWeight =
        sourceBytes >= 10 * 1024 * 1024
          ? "bold"
          : sourceBytes >= 1024 * 1024
            ? "medium"
            : "regular";
      size.textContent = formatSize(sourceBytes);
      if (source.responsive?.selected) {
        const current = document.createElement("span");
        current.className = "current-source";
        current.textContent = copy.current;
        current.setAttribute("aria-current", "true");
        detailText.append(current, document.createTextNode(" · "));
      }
      detailText.append(size);
      if (source.responsive?.descriptor)
        detailText.append(document.createTextNode(` · ${source.responsive.descriptor}`));
      if (mediaDetails.length)
        detailText.append(document.createTextNode(` · ${mediaDetails.join(" · ")}`));
      const detectedAt = formatSourcePanelCopy(
        copy.detectedAtTemplate,
        SOURCE_PANEL_COPY_VALUE_SLOT,
        formatters.date.format(new Date(source.detectedAt as number)),
      );
      meta.title = detectedAt;
      meta.replaceChildren(kindBadge, detailText);
    };

    if (preview instanceof HTMLImageElement) {
      preview.addEventListener(
        "error",
        () => {
          const fallback = document.createElement("div");
          fallback.className = "preview-fallback";
          fallback.textContent = "▧";
          fallback.setAttribute("aria-label", copy.previewUnavailable);
          preview.replaceWith(fallback);
        },
        { once: true },
      );
      preview.addEventListener("load", () => {
        mediaDetails.splice(
          0,
          mediaDetails.length,
          `${preview.naturalWidth}×${preview.naturalHeight}`,
        );
        updateMeta();
      });
    } else if (preview instanceof HTMLVideoElement) {
      preview.addEventListener("loadedmetadata", () => {
        const duration = Number.isFinite(preview.duration)
          ? `${Math.round(preview.duration)}s`
          : "";
        const dimensions = preview.videoWidth ? `${preview.videoWidth}×${preview.videoHeight}` : "";
        mediaDetails.splice(0, mediaDetails.length, ...[duration, dimensions].filter(Boolean));
        updateMeta();
      });
    }
    updateMeta();

    return {
      meta,
      updateBytes: (bytes: number | undefined) => {
        displayedBytes = bytes;
        updateMeta();
      },
    };
  };

  const buildTextBlock = (
    source: PageSource,
    preview: HTMLElement,
  ): { text: HTMLElement; updateBytes: (bytes: number | undefined) => void } => {
    const text = document.createElement("div");
    text.className = "source-text";
    const display = sourceDisplay(source);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = display.name;
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = display.url;
    url.title = source.url;
    const { meta, updateBytes } = buildMetaBlock(source, preview);
    text.append(name, meta, url);
    return { text, updateBytes };
  };

  // Media kinds get the rich hover tooltip instead of a title attribute, so
  // the plain instruction text would be redundant on them.
  const buildSourceLink = (source: PageSource, hasRichTooltip: boolean): HTMLAnchorElement => {
    const { copy } = ctx;
    const sourceLink = document.createElement("a");
    sourceLink.className = "source-link";
    sourceLink.href = source.url;
    sourceLink.target = "_blank";
    const instructions = formatSourcePanelCopy(
      copy.sourceInstructionsTemplate,
      SOURCE_PANEL_COPY_URL_SLOT,
      source.url,
    );
    sourceLink.setAttribute("aria-label", instructions);
    if (!hasRichTooltip) sourceLink.title = instructions;
    return sourceLink;
  };

  // Save plus the "more" menu. Returns the handles the row's teardown needs:
  // an open menu and a running locate highlight both outlive a re-render.
  const buildActions = (
    source: PageSource,
  ): { actions: HTMLElement; closeMenu: () => void; clearLocateHighlight: () => void } => {
    const { copy, panelOptions } = ctx;
    const actions = document.createElement("div");
    actions.className = "actions";
    const more = document.createElement("details");
    more.className = "row-more";
    const moreButton = document.createElement("summary");
    moreButton.setAttribute("aria-label", copy.moreActions);
    moreButton.setAttribute("aria-haspopup", "menu");
    moreButton.setAttribute("aria-expanded", "false");
    moreButton.title = copy.moreActions;
    setButtonIcon(moreButton, "more");
    const actionMenu = document.createElement("div");
    actionMenu.className = "action-menu";
    actionMenu.setAttribute("role", "menu");
    actionMenu.hidden = true;
    const closeMenu = () => ctx.setPanelMenuOpen(more, moreButton, actionMenu, false);

    const locate = document.createElement("button");
    locate.type = "button";
    locate.setAttribute("role", "menuitem");
    const locateHighlightOwner = {};
    let locateHighlightTimer = 0;
    locate.textContent = copy.locate;
    locate.addEventListener("click", () => {
      closeMenu();
      source.element.scrollIntoView?.({
        behavior: preferredScrollBehavior(),
        block: "center",
      });
      if (source.element instanceof HTMLElement) {
        const target = source.element;
        window.clearTimeout(locateHighlightTimer);
        acquireHighlight(target, locateHighlightOwner);
        locateHighlightTimer = window.setTimeout(
          () => releaseHighlight(target, locateHighlightOwner),
          1600,
        );
      }
    });

    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-action";
    save.textContent = copy.save;
    // The intent fires on press, before the click: the background needs waking
    // while the pointer is still down.
    save.addEventListener("pointerdown", (event) => {
      if (event.button === 0) panelOptions.onSaveIntent?.();
    });
    save.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") panelOptions.onSaveIntent?.();
    });
    save.addEventListener("click", () => ctx.panelSendDownload(currentSourceRecord(source)));

    actionMenu.append(locate);
    if (panelOptions.onCreateRule) {
      const createRule = document.createElement("button");
      createRule.type = "button";
      createRule.setAttribute("role", "menuitem");
      createRule.textContent = copy.createAutomaticRule;
      createRule.addEventListener("click", () => {
        closeMenu();
        void panelOptions.onCreateRule?.(source);
      });
      actionMenu.append(createRule);
    }
    if (source.kind === "stream" || source.kind === "video") {
      actionMenu.append(buildCopyCommandAction(source));
    }
    more.append(moreButton, actionMenu);
    ctx.wirePanelMenu(more, moreButton, actionMenu);
    moreButton.addEventListener("click", (event) => {
      event.preventDefault();
      ctx.setPanelMenuOpen(more, moreButton, actionMenu, !more.open);
    });
    actions.append(save, more);

    return {
      actions,
      closeMenu,
      clearLocateHighlight: () => {
        window.clearTimeout(locateHighlightTimer);
        if (source.element instanceof HTMLElement)
          releaseHighlight(source.element, locateHighlightOwner);
      },
    };
  };

  // Copies the URL for a downloader like yt-dlp: streams cannot be saved
  // through the downloads API, so the panel hands over the address instead.
  const buildCopyCommandAction = (source: PageSource): HTMLButtonElement => {
    const { copy } = ctx;
    const copyCommand = document.createElement("button");
    copyCommand.type = "button";
    copyCommand.setAttribute("role", "menuitem");
    copyCommand.textContent = copy.copyYtDlp;
    copyCommand.title = copy.copyYtDlpHelp;
    copyCommand.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(source.url)
        .then(() => {
          copyCommand.textContent = copy.copied;
          ctx.announce(copy.copied);
          window.setTimeout(() => (copyCommand.textContent = copy.copyYtDlp), 1200);
        })
        .catch(() => {
          copyCommand.textContent = copy.copyFailed;
          ctx.announce(copy.copyFailed);
        });
    });
    return copyCommand;
  };

  // The hover/focus preview: outline the element on the page, play the media,
  // and float the rich tooltip beside the row. Hover and focus are one state,
  // so leaving either only tears down when neither is left.
  const wireRowPreviewSync = (
    source: PageSource,
    row: HTMLElement,
    preview: HTMLElement,
    sourceLink: HTMLAnchorElement,
    hasRichTooltip: boolean,
  ): { deactivatePreview: () => void } => {
    const { host, shadow } = ctx;
    const previewHighlightOwner = {};
    const highlight = (active: boolean) => {
      if (!(source.element instanceof HTMLElement)) return;
      const target = source.element;
      if (active) {
        acquireHighlight(target, previewHighlightOwner);
        if (preview instanceof HTMLVideoElement) void preview.play().catch(() => {});
      } else {
        releaseHighlight(target, previewHighlightOwner);
        if (preview instanceof HTMLVideoElement) preview.pause();
      }
    };
    let richTooltip: HTMLElement | null = null;
    let tooltipResizeObserver: ResizeObserver | null = null;
    let hovered = false;
    let focused = false;
    let previewActive = false;

    const showTooltip = () => {
      richTooltip = createSourceTooltip(source) as HTMLElement;
      const tooltipId = `source-tooltip-${source.detectedOrder}`;
      richTooltip.id = tooltipId;
      sourceLink.setAttribute("aria-describedby", tooltipId);
      shadow.append(richTooltip);
      const positionTooltip = () => {
        if (!richTooltip?.isConnected) return;
        const anchorBounds = row.getBoundingClientRect();
        const panelBounds = host.getBoundingClientRect();
        const tooltipBounds = richTooltip.getBoundingClientRect();
        const position = positionSourceTooltip(
          anchorBounds,
          panelBounds,
          tooltipBounds,
          sourcePanelViewport(),
          host.classList.contains("floating") ? "floating" : ctx.currentDock(),
        );
        richTooltip.dataset.side = position.side;
        richTooltip.style.left = `${position.left - panelBounds.left}px`;
        richTooltip.style.top = `${position.top - panelBounds.top}px`;
      };
      positionTooltip();
      if (typeof ResizeObserver === "function") {
        tooltipResizeObserver = new ResizeObserver(positionTooltip);
        tooltipResizeObserver.observe(richTooltip);
      }
      // Media reflows the tooltip once it knows its own size.
      const positionAfterLayout = () => window.requestAnimationFrame(positionTooltip);
      const media = richTooltip.querySelector<HTMLMediaElement>("video, audio");
      if (media) {
        media.addEventListener("loadedmetadata", positionAfterLayout, { once: true });
        void media.play().catch(() => {});
      } else {
        richTooltip.querySelector("img")?.addEventListener("load", positionAfterLayout, {
          once: true,
        });
      }
    };

    const hideTooltip = () => {
      tooltipResizeObserver?.disconnect();
      tooltipResizeObserver = null;
      richTooltip?.querySelector<HTMLMediaElement>("video, audio")?.pause();
      richTooltip?.remove();
      richTooltip = null;
      sourceLink.removeAttribute("aria-describedby");
    };

    const syncPreview = () => {
      const active = hovered || focused;
      if (active === previewActive) return;
      previewActive = active;
      highlight(active);
      if (!active) {
        hideTooltip();
        return;
      }
      if (!hasRichTooltip) return;
      showTooltip();
    };

    sourceLink.addEventListener("mouseenter", () => {
      hovered = true;
      syncPreview();
    });
    sourceLink.addEventListener("mouseleave", () => {
      hovered = false;
      syncPreview();
    });
    sourceLink.addEventListener("focus", () => {
      focused = true;
      syncPreview();
    });
    sourceLink.addEventListener("blur", () => {
      focused = false;
      syncPreview();
    });

    return {
      deactivatePreview: () => {
        hovered = false;
        focused = false;
        syncPreview();
      },
    };
  };

  // Alt+click (or Alt+Enter/Space) anywhere on the row saves it, as long as the
  // gesture did not land on a control that means something else.
  const wireRowSaveGestures = (source: PageSource, row: HTMLElement): void => {
    const { panelOptions } = ctx;
    const onControl = (event: Event): boolean =>
      event.target instanceof Element && Boolean(event.target.closest("button, summary"));
    row.addEventListener("click", (event) => {
      if (!event.altKey || event.button !== 0 || onControl(event)) return;
      event.preventDefault();
      event.stopPropagation();
      ctx.panelSendDownload(currentSourceRecord(source));
    });
    row.addEventListener("pointerdown", (event) => {
      if (event.altKey && event.button === 0 && !onControl(event)) {
        panelOptions.onSaveIntent?.();
      }
    });
    row.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "Enter" || event.key === " ") && !onControl(event)) {
        panelOptions.onSaveIntent?.();
      }
    });
  };

  const buildRow = (source: PageSource): CachedRow => {
    const row = document.createElement("li");
    row.className = "row";
    row.dataset.kind = source.kind;

    const { selection, selectionInput } = buildSelection(source);
    const preview = buildPreview(source);
    const hasRichTooltip = ["image", "video", "audio"].includes(source.kind);
    const sourceLink = buildSourceLink(source, hasRichTooltip);
    const { text, updateBytes } = buildTextBlock(source, preview);
    sourceLink.append(preview, text);

    const { actions, closeMenu, clearLocateHighlight } = buildActions(source);
    const { deactivatePreview } = wireRowPreviewSync(
      source,
      row,
      preview,
      sourceLink,
      hasRichTooltip,
    );
    wireRowSaveGestures(source, row);
    row.append(selection, sourceLink, actions);

    return {
      source,
      row,
      // A row leaving the list must not leave the page outlined or a menu open.
      deactivate: () => {
        deactivatePreview();
        closeMenu();
        clearLocateHighlight();
      },
      updateBytes,
      updateSelection: (selected: boolean, disabled: boolean) => {
        selectionInput.checked = selected;
        selectionInput.disabled = disabled;
        row.dataset.selected = String(selected);
      },
    };
  };

  // A cached row is reusable only if nothing it rendered from has changed;
  // bytes alone can be patched in place.
  const canReuseRow = (cached: CachedRow, source: PageSource): boolean =>
    cached.source.kind === source.kind &&
    cached.source.element === source.element &&
    cached.source.previewable === source.previewable &&
    cached.source.responsive?.descriptor === source.responsive?.descriptor &&
    cached.source.responsive?.selected === source.responsive?.selected;

  const renderHeader = () => {
    const { copy } = ctx;
    ctx.title.textContent = copy.title;
    const totalCount = formatSourcePanelCopy(
      copy.sourceCountTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      ctx.allSources.length,
    );
    ctx.sourceCount.textContent = String(ctx.allSources.length);
    ctx.sourceCount.title = totalCount;
    ctx.sourceCount.setAttribute("aria-label", totalCount);
  };

  // Rows for sources the page no longer has can never be reused.
  const evictStaleRows = () => {
    const presentUrls = new Set(ctx.allSources.map(({ url }) => url));
    ctx.rowCache.forEach((cached, url) => {
      if (presentUrls.has(url)) return;
      deactivateAndRemove(cached);
      ctx.rowCache.delete(url);
    });
  };

  const render = () => {
    const { rowCache, list, copy } = ctx;
    ctx.resetPreviewObservations();
    const sourceSort = isSourceSort(ctx.sort.value) ? ctx.sort.value : "relevance";
    const sources = sortPageSources(
      filterPageSources(ctx.allSources, ctx.filter.value, activeKind),
      sourceSort,
      relevanceCache,
    );
    const nextResultViewKey = `${activeKind}\0${sourceSort}\0${ctx.filter.value}`;
    if (nextResultViewKey !== resultViewKey) {
      resultViewKey = nextResultViewKey;
      renderedSourceStart = 0;
      renderedSourceEnd = SOURCE_RENDER_CHUNK_SIZE;
      list.scrollTop = 0;
    }
    visibleSourceCount = sources.length;
    if (renderedSourceStart >= visibleSourceCount) {
      renderedSourceStart = Math.max(0, visibleSourceCount - CONNECTED_ROW_LIMIT);
    }
    renderedSourceEnd = Math.min(
      visibleSourceCount,
      Math.max(renderedSourceEnd, renderedSourceStart + SOURCE_RENDER_CHUNK_SIZE),
    );
    // A row owns previews, menus, selection controls, and several listeners.
    // Keep batch/filter semantics on the complete list while bounding the DOM
    // work and retained nodes for a page with thousands of distinct URLs. The
    // scroll handler moves this window in either direction without changing
    // the complete selection/copy/filter result below.
    const renderedSources = sources.slice(renderedSourceStart, renderedSourceEnd);
    ctx.visibleSources = sources;
    ctx.updateSelectionUi();
    renderHeader();
    evictStaleRows();
    renderFacets();

    if (!sources.length) {
      renderEmptyState();
      return;
    }
    ctx.copyUrls.disabled = false;
    ctx.announce(
      formatSourcePanelCopy(copy.sourceCountTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, sources.length),
    );
    list.querySelectorAll(".empty").forEach((empty) => empty.remove());

    // Rows are moved into place rather than re-appended, so a row that did not
    // change keeps its DOM identity (and its focus, and its playing preview).
    let insertionPoint = list.firstElementChild as HTMLElement | null;
    const placeRow = (row: HTMLElement) => {
      if (insertionPoint === row) {
        insertionPoint = insertionPoint.nextElementSibling as HTMLElement | null;
        return;
      }
      list.insertBefore(row, insertionPoint);
    };

    renderedSources.forEach((source, sourceIndex) => {
      const resultIndex = renderedSourceStart + sourceIndex;
      const cached = rowCache.get(source.url);
      if (cached && canReuseRow(cached, source)) {
        if (cached.source.bytes !== source.bytes) cached.updateBytes(source.bytes);
        cached.source = source;
        cached.updateSelection(ctx.selectedSourceUrls.has(source.url), ctx.batchSaving);
        cached.row.setAttribute("aria-posinset", String(resultIndex + 1));
        cached.row.setAttribute("aria-setsize", String(sources.length));
        const preview = cached.row.querySelector<HTMLImageElement | HTMLMediaElement>("img, video");
        if (preview) ctx.observeExistingPreview(preview);
        placeRow(cached.row);
        return;
      }
      if (cached) {
        if (insertionPoint === cached.row) {
          insertionPoint = cached.row.nextElementSibling as HTMLElement | null;
        }
        deactivateAndRemove(cached);
      }
      const cachedRow = buildRow(source);
      cachedRow.row.setAttribute("aria-posinset", String(resultIndex + 1));
      cachedRow.row.setAttribute("aria-setsize", String(sources.length));
      rowCache.set(source.url, cachedRow);
      cachedRows.set(cachedRow.row, cachedRow);
      placeRow(cachedRow.row);
    });

    while (insertionPoint) {
      const stale = insertionPoint;
      insertionPoint = stale.nextElementSibling as HTMLElement | null;
      const cached = cachedRows.get(stale);
      if (cached) deactivateAndRemove(cached);
      else stale.remove();
    }
    evictDetachedRows();
  };
  const moveRenderedWindow = (nextStart: number, nextEnd: number, anchorIndex: number) => {
    const anchorRow = ctx.list.children.item(anchorIndex - renderedSourceStart);
    const anchorOffset = anchorRow?.getBoundingClientRect().top;
    const previousScrollTop = ctx.list.scrollTop;
    renderedSourceStart = nextStart;
    renderedSourceEnd = nextEnd;
    render();
    if (anchorOffset === undefined || !anchorRow?.isConnected) return;
    ctx.list.scrollTop = previousScrollTop + anchorRow.getBoundingClientRect().top - anchorOffset;
  };
  const renderNearListEdge = () => {
    const nearEnd =
      ctx.list.scrollTop + ctx.list.clientHeight >=
      ctx.list.scrollHeight - SOURCE_RENDER_LOAD_THRESHOLD_PX;
    if (nearEnd && renderedSourceEnd < visibleSourceCount) {
      const nextEnd = Math.min(visibleSourceCount, renderedSourceEnd + SOURCE_RENDER_CHUNK_SIZE);
      const nextStart = Math.max(renderedSourceStart, nextEnd - CONNECTED_ROW_LIMIT);
      moveRenderedWindow(nextStart, nextEnd, nextStart);
      return;
    }
    if (ctx.list.scrollTop > SOURCE_RENDER_LOAD_THRESHOLD_PX || renderedSourceStart === 0) return;
    const nextStart = Math.max(0, renderedSourceStart - SOURCE_RENDER_CHUNK_SIZE);
    const nextEnd = Math.min(visibleSourceCount, nextStart + CONNECTED_ROW_LIMIT);
    moveRenderedWindow(nextStart, nextEnd, renderedSourceStart);
  };
  ctx.list.addEventListener("scroll", renderNearListEdge, { passive: true });
  ctx.render = render;
  ctx.cleanupTasks.push(() => {
    ctx.list.removeEventListener("scroll", renderNearListEdge);
    ctx.rowCache.forEach(({ deactivate }) => deactivate());
  });
};
