export type PageSourceKind = "image" | "video" | "audio" | "stream";
export type PageSource = { url: string; kind: PageSourceKind; element: Element };
export type SourcePanelOptions = {
  enabled?: boolean;
  includeBackgrounds?: boolean;
  live?: boolean;
  previews?: boolean;
  resourceHints?: boolean;
};

const urlsFromCss = (value: string): string[] =>
  [...value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g)].map(
    (match) => match[1] || match[2] || match[3],
  );

const absoluteUrl = (value: string): string | null => {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "ftp:", "data:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export const ytDlpCommand = (url: string): string => `yt-dlp "${url.replaceAll('"', '\\"')}"`;

export const filterPageSources = (
  sources: PageSource[],
  query: string,
  kind: "all" | PageSourceKind,
): PageSource[] => {
  const normalized = query.trim().toLocaleLowerCase();
  return sources.filter(
    (source) =>
      (kind === "all" || source.kind === kind) &&
      (!normalized || source.url.toLocaleLowerCase().includes(normalized)),
  );
};

export const collectPageSources = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
): PageSource[] => {
  const found: PageSource[] = [];
  const add = (value: string | null | undefined, kind: PageSourceKind, element: Element) => {
    const url = value && absoluteUrl(value);
    if (url) found.push({ url, kind, element });
  };

  root.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
    add(element.currentSrc || element.src, "image", element);
    element
      .getAttribute("srcset")
      ?.split(",")
      .forEach((candidate) => add(candidate.trim().split(/\s+/)[0], "image", element));
  });
  root.querySelectorAll<HTMLMediaElement>("video, audio").forEach((element) => {
    const kind = element instanceof HTMLVideoElement ? "video" : "audio";
    add(element.currentSrc || element.src, kind, element);
    element.querySelectorAll<HTMLSourceElement>("source").forEach((source) => {
      add(source.src, kind, element);
      source
        .getAttribute("srcset")
        ?.split(",")
        .forEach((candidate) => add(candidate.trim().split(/\s+/)[0], kind, element));
    });
  });
  if (options.includeBackgrounds !== false) {
    root.querySelectorAll<HTMLElement>("body, body *").forEach((element) => {
      urlsFromCss(getComputedStyle(element).backgroundImage).forEach((url) =>
        add(url, "image", element),
      );
    });
  }
  if (options.resourceHints !== false) {
    performance.getEntriesByType("resource").forEach((entry) => {
      if (/\.(?:m3u8|mpd)(?:$|[?#])/i.test(entry.name)) add(entry.name, "stream", document.body);
    });
  }

  const seen = new Set<string>();
  return found.filter(({ url }) => !seen.has(url) && Boolean(seen.add(url)));
};

const PANEL_HOST_ID = "save-in-source-panel";
const panelObservers = new WeakMap<Element, MutationObserver>();

export const toggleSourcePanel = (
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = document.getElementById(PANEL_HOST_ID);
  if (existing) {
    panelObservers.get(existing)?.disconnect();
    existing.remove();
    return false;
  }
  if (options.enabled === false) return false;

  const host = document.createElement("aside");
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;position:fixed;z-index:2147483647;inset:0 0 0 auto;width:min(420px,92vw);font:14px system-ui;color:#1f2328}
    .panel{height:100vh;box-sizing:border-box;background:#fff;box-shadow:-8px 0 28px #0003;display:flex;flex-direction:column}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px}h2{font-size:18px;margin:0}button,input,select{font:inherit}button{cursor:pointer}.close{border:0;background:none;font-size:20px;padding:4px 8px}
    .toolbar{display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 16px 12px;border-bottom:1px solid #d7d7db}.toolbar input,.toolbar select{min-width:0;padding:7px 9px;border:1px solid #b1b1b3;border-radius:4px}
    .list{overflow:auto;padding:4px 12px 16px}.row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;align-items:center;padding:10px 4px;border-bottom:1px solid #eee}
    img,video{width:48px;height:48px;object-fit:contain;background:#eee;border-radius:4px}.audio{font-size:24px;text-align:center}.name,.url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name{font-weight:600}.url{font-size:12px;color:#737373}.kind{display:inline-block;margin-top:3px;font-size:10px;color:#555;text-transform:uppercase}
    .actions{grid-column:2;display:flex;flex-wrap:wrap;gap:6px}.actions button{padding:5px 8px;border:1px solid #b1b1b3;border-radius:4px;background:#fff}.actions button:last-child{border-color:#0060df;color:#0060df}.empty{padding:32px 16px;color:#737373;text-align:center}
    @media (prefers-color-scheme:dark){:host{color:#f9f9fa}.panel{background:#2a2a2e}.toolbar,.row{border-color:#4a4a4f}.toolbar input,.toolbar select,.actions button{color:#f9f9fa;background:#38383d;border-color:#737373}.url{color:#b1b1b3}.kind{color:#d7d7db}}
  `;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Page sources");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  title.textContent = "Page sources";
  close.className = "close";
  close.textContent = "×";
  close.title = "Close";
  close.setAttribute("aria-label", "Close Page Sources");
  const closePanel = () => {
    panelObservers.get(host)?.disconnect();
    host.remove();
    previousFocus?.focus();
  };
  close.addEventListener("click", closePanel);
  header.append(title, close);
  const list = document.createElement("div");
  list.className = "list";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = "Filter sources";
  filter.setAttribute("aria-label", "Filter page sources");
  const type = document.createElement("select");
  type.setAttribute("aria-label", "Source type");
  [
    ["all", "All types"],
    ["image", "Images"],
    ["video", "Video"],
    ["audio", "Audio"],
    ["stream", "Streams"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  });
  toolbar.append(filter, type);
  const render = () => {
    const allSources = collectPageSources(document, options);
    const sources = filterPageSources(
      allSources,
      filter.value,
      type.value as "all" | PageSourceKind,
    );
    title.textContent = `Page sources (${sources.length}${sources.length === allSources.length ? "" : ` of ${allSources.length}`})`;
    list.replaceChildren();
    if (!sources.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No image, video, or audio sources found.";
      list.append(empty);
      return;
    }
    sources.forEach((source) => {
      const row = document.createElement("div");
      row.className = "row";
      const preview =
        options.previews === false || source.kind === "audio"
          ? document.createElement("div")
          : document.createElement(source.kind === "image" ? "img" : "video");
      if (preview instanceof HTMLImageElement) {
        preview.loading = "lazy";
        preview.src = source.url;
      } else if (preview instanceof HTMLVideoElement) {
        preview.preload = "metadata";
        preview.muted = true;
        preview.src = source.url;
      } else {
        preview.className = "audio";
        preview.textContent =
          source.kind === "stream"
            ? "≋"
            : options.previews === false
              ? source.kind === "image"
                ? "▧"
                : "▶"
              : "♪";
      }
      const text = document.createElement("div");
      const name = document.createElement("div");
      const url = document.createElement("div");
      const kind = document.createElement("div");
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
      url.title = source.url;
      kind.className = "kind";
      kind.textContent = source.kind;
      text.append(name, url, kind);
      const actions = document.createElement("div");
      actions.className = "actions";
      const locate = document.createElement("button");
      locate.textContent = "Locate";
      locate.addEventListener("click", () => {
        source.element.scrollIntoView({ behavior: "smooth", block: "center" });
        if (source.element instanceof HTMLElement) {
          const target = source.element;
          const previous = target.style.outline;
          target.style.outline = "3px solid #0a84ff";
          window.setTimeout(() => {
            target.style.outline = previous;
          }, 1600);
        }
      });
      const save = document.createElement("button");
      save.textContent = source.kind === "stream" ? "Save manifest" : "Save";
      save.addEventListener("click", () => sendDownload(source));
      actions.append(locate, save);
      if (source.kind === "stream") {
        const copy = document.createElement("button");
        copy.textContent = "Copy yt-dlp";
        copy.addEventListener("click", () => {
          void navigator.clipboard
            .writeText(ytDlpCommand(source.url))
            .then(() => {
              copy.textContent = "Copied";
              window.setTimeout(() => (copy.textContent = "Copy yt-dlp"), 1200);
            })
            .catch(() => {
              copy.textContent = "Copy failed";
            });
        });
        actions.append(copy);
      }
      row.append(preview, text, actions);
      list.append(row);
    });
  };
  filter.addEventListener("input", render);
  type.addEventListener("change", render);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  panel.append(header, toolbar, list);
  shadow.append(style, panel);
  document.documentElement.append(host);
  render();
  filter.focus();
  let timer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, 200);
  });
  panelObservers.set(host, observer);
  if (options.live !== false) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "style"],
    });
  }
  return true;
};
