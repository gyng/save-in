import {
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  sortPageSources,
  resourceTimingByUrl,
  ytDlpCommand,
  type PageSource,
  type PageSourceKind,
  type SourcePanelOptions,
  type SourceSort,
} from "./source-panel-model.ts";

export {
  collectPageSources,
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  sortPageSources,
  resourceTimingByUrl,
  ytDlpCommand,
  type PageSource,
  type PageSourceKind,
  type SourcePanelOptions,
  type SourceSort,
} from "./source-panel-model.ts";

const PANEL_HOST_ID = "save-in-source-panel";
const panelCleanups = new WeakMap<Element, () => void>();
const panelCloseTimers = new WeakMap<Element, number>();

const cancelPanelRemoval = (host: Element) => {
  const timer = panelCloseTimers.get(host);
  if (timer !== undefined) window.clearTimeout(timer);
  panelCloseTimers.delete(host);
};

const schedulePanelRemoval = (host: Element) => {
  cancelPanelRemoval(host);
  panelCloseTimers.set(
    host,
    window.setTimeout(() => {
      panelCloseTimers.delete(host);
      panelCleanups.get(host)?.();
      panelCleanups.delete(host);
      host.remove();
    }, 90),
  );
};
const ICON_PATHS = {
  copy: ["M8 8h10v10H8z", "M5 15H3V3h12v2"],
  dock: ["M3 4h18v16H3z", "M15 4v16"],
  popout: ["M13 4h7v7", "M20 4 10 14", "M17 13v7H4V7h7"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  check: ["m5 12 4 4L19 6"],
  error: ["M12 8v5", "M12 17h.01", "M4 20h16L12 4z"],
} as const;

const setButtonIcon = (button: HTMLButtonElement, icon: keyof typeof ICON_PATHS) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  ICON_PATHS[icon].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  button.replaceChildren(svg);
};

export const toggleSourcePanel = (
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = document.getElementById(PANEL_HOST_ID);
  if (existing) {
    if (existing.classList.contains("closing")) {
      cancelPanelRemoval(existing);
      existing.classList.remove("closing");
      options.onOpenChange?.(true);
      return true;
    }
    existing.classList.add("closing");
    schedulePanelRemoval(existing);
    options.onOpenChange?.(false);
    return false;
  }
  if (options.enabled === false) return false;

  const host = document.createElement("aside");
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;position:fixed;z-index:2147483647;isolation:isolate;inset:0 0 0 auto;width:min(360px,92vw);font:13px system-ui;color:#1f2328;animation:si-in 110ms ease-out both}
    :host(.closing){pointer-events:none;animation:si-out 90ms ease-in both}@keyframes si-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}@keyframes si-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(8px)}}
    :host(.dock-left){inset:0 auto 0 0}:host(.dock-bottom){inset:auto 0 0;width:100vw;height:min(42vh,520px)}:host(.dock-top){inset:0 0 auto;width:100vw;height:min(42vh,520px)}
    :host(.floating){inset:80px auto auto 80px;width:min(520px,calc(100vw - 32px));height:min(70vh,620px)}
    .panel{height:100vh;box-sizing:border-box;background:#fff;box-shadow:-8px 0 28px #0003;display:flex;flex-direction:column}
    :host(.dock-bottom) .panel,:host(.dock-top) .panel,:host(.floating) .panel{height:100%}:host(.floating) .panel{border:1px solid #b1b1b3;border-radius:6px;box-shadow:0 10px 36px #0005;overflow:hidden}:host(.floating) .resize{display:none}.resize{position:absolute;inset:0 auto 0 -4px;width:8px;cursor:ew-resize}:host(.dock-left) .resize{inset:0 -4px 0 auto}:host(.dock-bottom) .resize{inset:-4px 0 auto;width:auto;height:8px;cursor:ns-resize}:host(.dock-top) .resize{inset:auto 0 -4px;width:auto;height:8px;cursor:ns-resize}header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 3px}:host(.floating) header{cursor:grab;user-select:none}:host(.floating) header:active{cursor:grabbing}h2{font-size:16px;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.header-actions{display:flex;align-items:center;gap:2px;flex:none}button,input,select{font:inherit}button{cursor:pointer}.header-button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:4px;background:none;line-height:1}.header-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.header-button:hover{border-color:#b1b1b3;background:#f0f0f4}
    .toolbar{display:grid;grid-template-columns:1fr auto;gap:6px;padding:4px 10px 6px}.toolbar input,.toolbar select{min-width:0;padding:5px 7px;border:1px solid #b1b1b3;border-radius:4px}.facets{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 6px;border-bottom:1px solid #d7d7db}.facet{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;padding:2px 6px;border:1px solid #b1b1b3;border-radius:99px;background:#fff}.facet-count{min-width:15px;padding:0 3px;border-radius:99px;background:#e7e7ea;color:#555;font-size:10px;line-height:15px;text-align:center}.facet[aria-pressed=true]{color:#fff;background:#0060df;border-color:#0060df}.facet[aria-pressed=true] .facet-count{background:#fff3;color:#fff}
    .list{overflow:auto;padding:0 7px 8px}.row{padding:2px 0;border-bottom:1px solid #eee}.source-link{display:grid;grid-template-columns:30px minmax(0,1fr);gap:7px;align-items:center;min-height:38px;padding:3px 5px;border-radius:4px;color:inherit;text-decoration:none}.source-link:hover,.source-link:focus-visible{background:#f0f6ff;outline:none}.source-text{min-width:0}
    img,video,.preview-fallback{width:30px;height:30px;object-fit:contain;background:#eee;border-radius:3px}.preview-fallback,.audio{display:grid;place-items:center;color:#737373;font-size:17px}.name,.url{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name{font-weight:600;color:#0060df}.url{font-size:11px;color:#737373}.meta{display:flex;gap:6px;margin-top:1px;font-size:10px;color:#555;text-transform:uppercase}.media-tooltip{position:fixed;z-index:2;display:grid;place-items:center;box-sizing:border-box;max-width:min(360px,45vw);max-height:min(280px,55vh);padding:6px;border:1px solid #b1b1b3;border-radius:6px;background:#fff;box-shadow:0 10px 32px #0005;pointer-events:none}.media-tooltip img,.media-tooltip video{width:auto;height:auto;max-width:340px;max-height:260px;object-fit:contain;background:#111}.media-tooltip audio{width:min(300px,40vw);pointer-events:none}
    .actions{display:flex;flex-wrap:wrap;gap:4px;margin:1px 5px 3px 42px}.actions button{min-height:26px;padding:3px 7px;border:1px solid #b1b1b3;border-radius:3px;background:#fff}.actions button:last-child{border-color:#0060df;color:#0060df}.empty{padding:24px 12px;color:#737373;text-align:center}
    @media (prefers-color-scheme:dark){:host{color:#f9f9fa}.panel,.media-tooltip{background:#2a2a2e}.toolbar,.row{border-color:#4a4a4f}.toolbar input,.toolbar select,.actions button{color:#f9f9fa;background:#38383d;border-color:#737373}.header-button{color:#f9f9fa}.header-button:hover{background:#38383d}.url{color:#b1b1b3}.kind{color:#d7d7db}}@media(prefers-reduced-motion:reduce){:host,:host(.closing){animation:none}}
  `;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Page sources");
  const resize = document.createElement("div");
  resize.className = "resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "Resize Page Sources");
  resize.addEventListener("pointerdown", (event) => {
    resize.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = host.getBoundingClientRect().width;
    const startHeight = host.getBoundingClientRect().height;
    const move = (moveEvent: PointerEvent) => {
      const dock = host.dataset.dock || "right";
      if (dock === "right" || dock === "left") {
        const delta = dock === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        host.style.width = `${Math.min(window.innerWidth * 0.92, Math.max(280, startWidth + delta))}px`;
      } else {
        const delta = dock === "bottom" ? startY - moveEvent.clientY : moveEvent.clientY - startY;
        host.style.height = `${Math.min(window.innerHeight * 0.85, Math.max(220, startHeight + delta))}px`;
      }
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", () => resize.removeEventListener("pointermove", move), {
      once: true,
    });
  });
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  const dockButton = document.createElement("button");
  const popoutButton = document.createElement("button");
  title.textContent = "Page sources";
  close.className = "header-button close";
  setButtonIcon(close, "close");
  close.title = "Close";
  close.setAttribute("aria-label", "Close Page Sources");
  const docks = ["right", "bottom", "left", "top"] as const;
  let dockIndex = 0;
  const updateDock = () => {
    const dock = docks[dockIndex];
    host.dataset.dock = dock;
    host.classList.remove("dock-left", "dock-bottom", "dock-top");
    if (dock !== "right") host.classList.add(`dock-${dock}`);
    host.style.width = "";
    host.style.height = "";
    dockButton.title = `Dock: ${dock[0].toUpperCase()} — change to the next position`;
  };
  dockButton.className = "header-button dock";
  setButtonIcon(dockButton, "dock");
  dockButton.setAttribute("aria-label", "Change panel dock position");
  const updatePopoutButton = (floating: boolean) => {
    popoutButton.setAttribute("aria-pressed", String(floating));
    popoutButton.setAttribute(
      "aria-label",
      floating ? "Dock Page Sources" : "Pop out Page Sources",
    );
    popoutButton.title = floating ? "Dock Page Sources" : "Pop out into a draggable panel";
  };
  dockButton.addEventListener("click", () => {
    host.classList.remove("floating");
    updatePopoutButton(false);
    dockIndex = (dockIndex + 1) % docks.length;
    updateDock();
  });
  popoutButton.className = "header-button popout";
  setButtonIcon(popoutButton, "popout");
  updatePopoutButton(false);
  popoutButton.addEventListener("click", () => {
    const floating = host.classList.toggle("floating");
    updatePopoutButton(floating);
    if (floating) {
      host.classList.remove("dock-left", "dock-bottom", "dock-top");
      host.style.width = "";
      host.style.height = "";
    } else {
      host.style.left = "";
      host.style.top = "";
      updateDock();
    }
  });
  updateDock();
  const closePanel = () => {
    previousFocus?.focus();
    host.classList.add("closing");
    schedulePanelRemoval(host);
    options.onOpenChange?.(false);
  };
  close.addEventListener("click", closePanel);
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const copyUrls = document.createElement("button");
  copyUrls.className = "header-button copy-urls";
  setButtonIcon(copyUrls, "copy");
  copyUrls.title = "Copy URLs in the current filter";
  copyUrls.setAttribute("aria-label", "Copy filtered source URLs");
  headerActions.append(copyUrls, dockButton, popoutButton, close);
  header.append(title, headerActions);
  header.addEventListener("pointerdown", (event) => {
    if (!host.classList.contains("floating") || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    header.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = host.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const left = Math.min(
        window.innerWidth - rect.width - 8,
        Math.max(8, rect.left + moveEvent.clientX - startX),
      );
      const top = Math.min(
        window.innerHeight - rect.height - 8,
        Math.max(8, rect.top + moveEvent.clientY - startY),
      );
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", () => header.removeEventListener("pointermove", move), {
      once: true,
    });
  });
  const list = document.createElement("div");
  list.className = "list";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = "Filter sources";
  filter.setAttribute("aria-label", "Filter page sources");
  const sort = document.createElement("select");
  sort.setAttribute("aria-label", "Sort sources");
  [
    ["detected-desc", "Newest"],
    ["detected-asc", "Oldest"],
    ["size-desc", "Largest"],
    ["name-asc", "Name"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sort.append(option);
  });
  toolbar.append(filter, sort);
  const facets = document.createElement("div");
  facets.className = "facets";
  let activeKind: "all" | PageSourceKind = "all";
  const firstSeen = new Map<string, { at: number; order: number }>();
  const highlightedElements = new WeakSet<Element>();
  const timingByUrl = resourceTimingByUrl();
  let detectionSequence = 0;
  let sourceCandidates: PageSource[] = [];
  let allSources: PageSource[] = [];
  let visibleSources: PageSource[] = [];
  let resourceHintSources: PageSource[] = [];
  const rowCache = new Map<string, { source: PageSource; row: HTMLElement }>();
  const pendingPreviewSources = new WeakMap<Element, string>();
  const previewObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (
                !entry.isIntersecting ||
                (!(entry.target instanceof HTMLImageElement) &&
                  !(entry.target instanceof HTMLMediaElement))
              )
                return;
              const source = pendingPreviewSources.get(entry.target);
              if (source) {
                entry.target.src = source;
                pendingPreviewSources.delete(entry.target);
              }
              observer.unobserve(entry.target);
            });
          },
          { root: list, rootMargin: "200px" },
        )
      : null;
  const queuePreview = (preview: HTMLImageElement | HTMLMediaElement, source: string) => {
    if (!previewObserver) {
      preview.src = source;
      return;
    }
    pendingPreviewSources.set(preview, source);
    previewObserver.observe(preview);
  };
  const commitSources = () => {
    const seen = new Set<string>();
    allSources = [sourceCandidates, resourceHintSources]
      .flat()
      .filter(({ url }) => !seen.has(url) && Boolean(seen.add(url)));
    const presentUrls = new Set(allSources.map(({ url }) => url));
    firstSeen.forEach((_value, url) => {
      if (!presentUrls.has(url)) firstSeen.delete(url);
    });
    allSources.forEach((source) => {
      if (!firstSeen.has(source.url)) {
        firstSeen.set(source.url, { at: Date.now(), order: ++detectionSequence });
      }
      const detection = firstSeen.get(source.url)!;
      source.detectedAt = detection.at;
      source.detectedOrder = detection.order;
    });
    render();
  };
  const refreshSources = () => {
    sourceCandidates = collectPageSourceCandidates(
      document,
      { ...options, resourceHints: false },
      timingByUrl,
    );
    resourceHintSources =
      options.resourceHints === false ? [] : collectResourceHintSources(timingByUrl, document.body);
    commitSources();
  };
  const removeSourcesUnder = (root: Element) => {
    sourceCandidates = sourceCandidates.filter(
      ({ element }) => element !== root && !root.contains(element),
    );
  };
  const reconcileRoot = (changedRoot: Element) => {
    const root =
      changedRoot.matches("source") && changedRoot.closest("video, audio")
        ? changedRoot.closest("video, audio")!
        : changedRoot;
    removeSourcesUnder(root);
    sourceCandidates.push(
      ...collectPageSourceCandidates(root, { ...options, resourceHints: false }, timingByUrl),
    );
  };
  const render = () => {
    previewObserver?.disconnect();
    const sources = sortPageSources(
      filterPageSources(allSources, filter.value, activeKind),
      sort.value as SourceSort,
    );
    visibleSources = sources;
    title.textContent = "Page sources";
    facets.replaceChildren();
    const presentUrls = new Set(allSources.map(({ url }) => url));
    rowCache.forEach(({ row }, url) => {
      if (presentUrls.has(url)) return;
      row.remove();
      rowCache.delete(url);
    });
    const searchedSources = filterPageSources(allSources, filter.value, "all");
    (["all", "image", "video", "audio", "document", "stream", "link"] as const).forEach(
      (kindName) => {
        const count =
          kindName === "all"
            ? searchedSources.length
            : searchedSources.filter(({ kind }) => kind === kindName).length;
        const facet = document.createElement("button");
        facet.className = "facet";
        const label =
          kindName === "all"
            ? "All"
            : kindName === "stream"
              ? "Playlist"
              : `${kindName[0].toUpperCase()}${kindName.slice(1)}`;
        const facetCount = document.createElement("span");
        facetCount.className = "facet-count";
        facetCount.textContent = String(count);
        facet.append(document.createTextNode(label), facetCount);
        facet.setAttribute("aria-pressed", String(activeKind === kindName));
        facet.addEventListener("click", () => {
          activeKind = kindName;
          render();
        });
        facets.append(facet);
      },
    );
    if (!sources.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = allSources.length
        ? `No ${activeKind === "all" ? "sources" : activeKind} match${filter.value ? ` “${filter.value}”` : " this facet"}.`
        : "No page media or streaming-video playlists detected yet.";
      list.append(empty);
      copyUrls.disabled = true;
      return;
    }
    copyUrls.disabled = false;
    list.querySelector(":scope > .empty")?.remove();
    let rowIndex = 0;
    const placeRow = (row: HTMLElement) => {
      const current = list.children[rowIndex] || null;
      if (current !== row) list.insertBefore(row, current);
      rowIndex += 1;
    };
    sources.forEach((source) => {
      const cached = rowCache.get(source.url);
      if (
        cached &&
        cached.source.kind === source.kind &&
        cached.source.element === source.element &&
        cached.source.bytes === source.bytes
      ) {
        const preview = cached.row.querySelector<HTMLImageElement | HTMLMediaElement>("img, video");
        if (previewObserver && preview && !preview.hasAttribute("src")) {
          previewObserver.observe(preview);
        }
        placeRow(cached.row);
        return;
      }
      cached?.row.remove();
      const row = document.createElement("div");
      row.className = "row";
      const preview =
        options.previews === false || !["image", "video"].includes(source.kind)
          ? document.createElement("div")
          : document.createElement(source.kind === "image" ? "img" : "video");
      if (preview instanceof HTMLImageElement) {
        preview.loading = "lazy";
        queuePreview(preview, source.url);
      } else if (preview instanceof HTMLVideoElement) {
        preview.preload = "metadata";
        preview.muted = true;
        queuePreview(preview, source.url);
      } else {
        preview.className = "audio";
        preview.textContent =
          source.kind === "stream"
            ? "≋"
            : source.kind === "document"
              ? "PDF"
              : source.kind === "link"
                ? "↗"
                : options.previews === false
                  ? source.kind === "image"
                    ? "▧"
                    : "▶"
                  : source.kind === "audio"
                    ? "♪"
                    : "•";
      }
      const sourceLink = document.createElement("a");
      const hasRichTooltip =
        options.previews !== false && ["image", "video", "audio"].includes(source.kind);
      sourceLink.className = "source-link";
      sourceLink.href = source.url;
      sourceLink.target = "_blank";
      sourceLink.setAttribute(
        "aria-label",
        `${source.url}. Right-click for Save In; Alt+click to save immediately.`,
      );
      if (!hasRichTooltip)
        sourceLink.title = `${source.url}\nRight-click for the Save In menu; Alt+click to save immediately.`;
      const text = document.createElement("div");
      text.className = "source-text";
      const name = document.createElement("span");
      const url = document.createElement("div");
      const meta = document.createElement("div");
      name.className = "name";
      try {
        const parsed = new URL(source.url);
        name.textContent = decodeURIComponent(
          parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname || source.kind,
        );
      } catch {
        name.textContent = source.kind;
      }
      url.className = "url";
      url.textContent = source.url;
      if (!hasRichTooltip) url.title = source.url;
      meta.className = "meta";
      const mediaDetails: string[] = [];
      const updateMeta = () => {
        const details = [source.kind, formatSourceBytes(source.bytes), ...mediaDetails];
        const detected = document.createElement("span");
        detected.className = "detected";
        detected.textContent = `#${source.detectedOrder}`;
        const detectedAt = `Detected at ${new Date(source.detectedAt || Date.now()).toLocaleTimeString()}`;
        detected.setAttribute("aria-label", detectedAt);
        if (!hasRichTooltip) detected.title = detectedAt;
        meta.replaceChildren(document.createTextNode(`${details.join(" · ")} · `), detected);
      };
      if (preview instanceof HTMLImageElement) {
        preview.addEventListener(
          "error",
          () => {
            const fallback = document.createElement("div");
            fallback.className = "preview-fallback";
            fallback.textContent = "▧";
            fallback.setAttribute("aria-label", "Preview unavailable");
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
          const dimensions = preview.videoWidth
            ? `${preview.videoWidth}×${preview.videoHeight}`
            : "";
          mediaDetails.splice(0, mediaDetails.length, ...[duration, dimensions].filter(Boolean));
          updateMeta();
        });
      }
      updateMeta();
      text.append(name, url, meta);
      sourceLink.append(preview, text);
      const actions = document.createElement("div");
      actions.className = "actions";
      const locate = document.createElement("button");
      locate.textContent = "Locate";
      locate.addEventListener("click", () => {
        source.element.scrollIntoView({ behavior: "smooth", block: "center" });
        if (source.element instanceof HTMLElement) {
          const target = source.element;
          highlightedElements.add(target);
          const previous = target.style.outline;
          target.style.outline = "3px solid #0a84ff";
          window.setTimeout(() => {
            target.style.outline = previous;
            window.setTimeout(() => highlightedElements.delete(target));
          }, 1600);
        }
      });
      const save = document.createElement("button");
      save.textContent = source.kind === "stream" ? "Save playlist" : "Save";
      save.addEventListener("pointerdown", (event) => {
        if (event.button === 0) options.onSaveIntent?.();
      });
      save.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") options.onSaveIntent?.();
      });
      save.addEventListener("click", () => sendDownload(source));
      actions.append(locate, save);
      if (source.kind === "stream") {
        const copy = document.createElement("button");
        copy.textContent = "Copy yt-dlp command";
        copy.title = "Copy a command for yt-dlp to download the complete video";
        copy.addEventListener("click", () => {
          void navigator.clipboard
            .writeText(ytDlpCommand(source.url))
            .then(() => {
              copy.textContent = "Copied";
              window.setTimeout(() => (copy.textContent = "Copy yt-dlp command"), 1200);
            })
            .catch(() => {
              copy.textContent = "Copy failed";
            });
        });
        actions.append(copy);
      }
      const highlight = (active: boolean) => {
        if (!(source.element instanceof HTMLElement)) return;
        const target = source.element;
        if (active) {
          highlightedElements.add(target);
          target.dataset.saveInPreviousOutline = target.style.outline;
          target.style.outline = "3px solid #0a84ff";
          if (preview instanceof HTMLVideoElement) void preview.play().catch(() => {});
        } else {
          target.style.outline = target.dataset.saveInPreviousOutline || "";
          delete target.dataset.saveInPreviousOutline;
          if (preview instanceof HTMLVideoElement) preview.pause();
          window.setTimeout(() => highlightedElements.delete(target));
        }
      };
      let richTooltip: HTMLElement | null = null;
      let hovered = false;
      let focused = false;
      let previewActive = false;
      const syncPreview = () => {
        const active = hovered || focused;
        if (active === previewActive) return;
        previewActive = active;
        highlight(active);
        if (!active) {
          richTooltip?.querySelector<HTMLMediaElement>("video, audio")?.pause();
          richTooltip?.remove();
          richTooltip = null;
          sourceLink.removeAttribute("aria-describedby");
          return;
        }
        if (!hasRichTooltip) return;
        richTooltip = createSourceTooltip(source);
        if (!richTooltip) return;
        const tooltipId = `source-tooltip-${source.detectedOrder}`;
        richTooltip.id = tooltipId;
        sourceLink.setAttribute("aria-describedby", tooltipId);
        shadow.append(richTooltip);
        const positionTooltip = () => {
          if (!richTooltip?.isConnected) return;
          const bounds = row.getBoundingClientRect();
          const tooltipBounds = richTooltip.getBoundingClientRect();
          const left =
            bounds.left >= tooltipBounds.width + 12
              ? bounds.left - tooltipBounds.width - 8
              : bounds.right + 8;
          richTooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltipBounds.width - 8, left))}px`;
          richTooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltipBounds.height - 8, bounds.top))}px`;
        };
        positionTooltip();
        const media = richTooltip.querySelector<HTMLMediaElement>("video, audio");
        if (media) {
          media.addEventListener("loadedmetadata", positionTooltip, { once: true });
          void media.play().catch(() => {});
        } else {
          richTooltip.querySelector("img")?.addEventListener("load", positionTooltip, {
            once: true,
          });
        }
      };
      row.addEventListener("mouseenter", () => {
        hovered = true;
        syncPreview();
      });
      row.addEventListener("mouseleave", () => {
        hovered = false;
        syncPreview();
      });
      row.addEventListener("focusin", () => {
        focused = true;
        syncPreview();
      });
      row.addEventListener("focusout", (event) => {
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        focused = false;
        syncPreview();
      });
      row.addEventListener("click", (event) => {
        if (
          !event.altKey ||
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        sendDownload(source);
      });
      row.addEventListener("pointerdown", (event) => {
        if (
          event.altKey &&
          event.button === 0 &&
          !(event.target instanceof Element && event.target.closest("button"))
        ) {
          options.onSaveIntent?.();
        }
      });
      row.addEventListener("keydown", (event) => {
        if (
          event.altKey &&
          (event.key === "Enter" || event.key === " ") &&
          !(event.target instanceof Element && event.target.closest("button"))
        ) {
          options.onSaveIntent?.();
        }
      });
      if (!hasRichTooltip)
        row.title = "Alt+click to save; right-click the source title for Save In";
      row.append(sourceLink, actions);
      rowCache.set(source.url, { source, row });
      placeRow(row);
    });
    while (list.children.length > rowIndex) list.lastElementChild?.remove();
  };
  let filterTimer = 0;
  filter.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(render, 80);
  });
  sort.addEventListener("change", render);
  copyUrls.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(visibleSources.map(({ url }) => url).join("\n"))
      .then(() => {
        setButtonIcon(copyUrls, "check");
        copyUrls.title = `Copied ${visibleSources.length} URLs`;
        window.setTimeout(() => {
          setButtonIcon(copyUrls, "copy");
          copyUrls.title = "Copy URLs in the current filter";
        }, 1200);
      })
      .catch(() => {
        setButtonIcon(copyUrls, "error");
        copyUrls.title = "Copy failed";
      });
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  panel.append(resize, header, toolbar, facets, list);
  shadow.append(style, panel);
  document.documentElement.append(host);
  options.onOpenChange?.(true);
  refreshSources();
  filter.focus();
  let refreshTimer = 0;
  const pendingRoots = new Set<Element>();
  const removedRoots = new Set<Element>();
  let fullRefreshPending = false;
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (fullRefreshPending) {
        fullRefreshPending = false;
        pendingRoots.clear();
        removedRoots.clear();
        refreshSources();
        return;
      }
      removedRoots.forEach(removeSourcesUnder);
      removedRoots.clear();
      pendingRoots.forEach((root) => {
        if (root.isConnected) reconcileRoot(root);
      });
      pendingRoots.clear();
      commitSources();
    }, 200);
  };
  const observer = new MutationObserver((mutations) => {
    if (!host.isConnected) {
      panelCleanups.get(host)?.();
      panelCleanups.delete(host);
      return;
    }
    if (
      mutations.every(
        ({ target }) =>
          target === host ||
          (target instanceof Element &&
            (highlightedElements.has(target) || target.closest(`#${PANEL_HOST_ID}`) === host)),
      )
    )
      return;
    mutations.forEach((mutation) => {
      if (!(mutation.target instanceof Element)) return;
      const affectsStylesheet =
        options.includeBackgrounds !== false &&
        (mutation.target.closest("style") ||
          mutation.target.matches('link[rel~="stylesheet"]') ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('style, link[rel~="stylesheet"]') ||
                Boolean(node.querySelector('style, link[rel~="stylesheet"]'))),
          ));
      if (affectsStylesheet) {
        fullRefreshPending = true;
        return;
      }
      if (mutation.type === "attributes") {
        pendingRoots.add(mutation.target);
        return;
      }
      mutation.removedNodes.forEach((node) => {
        if (node instanceof Element) removedRoots.add(node);
      });
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) pendingRoots.add(node);
      });
      if (mutation.target.matches("video, audio")) pendingRoots.add(mutation.target);
    });
    scheduleRefresh();
  });
  const resourceObserver =
    options.live !== false &&
    options.resourceHints !== false &&
    typeof PerformanceObserver === "function"
      ? new PerformanceObserver((entries) => {
          const observed = entries.getEntries() as PerformanceResourceTiming[];
          observed.forEach((entry) => timingByUrl.set(entry.name, entry));
          if (!observed.some(({ name }) => /\.(?:m3u8|mpd)(?:$|[?#])/i.test(name))) return;
          resourceHintSources = collectResourceHintSources(timingByUrl, document.body);
          commitSources();
        })
      : null;
  panelCleanups.set(host, () => {
    observer.disconnect();
    resourceObserver?.disconnect();
    previewObserver?.disconnect();
    window.clearTimeout(filterTimer);
    window.clearTimeout(refreshTimer);
  });
  if (options.live !== false) {
    const attributeFilter = ["src", "srcset", "style"];
    if (options.includeLinks !== false) attributeFilter.push("href");
    if (options.includeBackgrounds !== false) attributeFilter.push("class", "id");
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter,
    });
    try {
      resourceObserver?.observe({ entryTypes: ["resource"] });
    } catch {
      // Some older engines expose PerformanceObserver without resource entries.
    }
  }
  return true;
};

export const setSourcePanelOpen = (
  open: boolean,
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = document.getElementById(PANEL_HOST_ID);
  if (existing?.classList.contains("closing")) {
    return open ? toggleSourcePanel(sendDownload, options) : false;
  }
  if (open === Boolean(existing)) return open;
  return toggleSourcePanel(sendDownload, options);
};
