export type PageSourceKind = "image" | "video" | "audio";
export type PageSource = { url: string; kind: PageSourceKind; element: Element };
export type SourcePanelOptions = {
  enabled?: boolean;
  includeBackgrounds?: boolean;
  live?: boolean;
  previews?: boolean;
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
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;position:fixed;z-index:2147483647;inset:0 0 0 auto;width:min(420px,92vw);font:14px system-ui;color:#1f2328}
    .panel{height:100vh;box-sizing:border-box;background:#fff;box-shadow:-8px 0 28px #0003;display:flex;flex-direction:column}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #d7d7db}h2{font-size:17px;margin:0}button{font:inherit;cursor:pointer}
    .list{overflow:auto;padding:8px}.row{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #eee}
    img,video{width:44px;height:44px;object-fit:contain;background:#eee}.audio{font-size:24px;text-align:center}.url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kind{font-size:11px;color:#737373;text-transform:uppercase}
    .actions{display:flex;gap:4px}.empty{padding:24px;color:#737373;text-align:center}
  `;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Page sources");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  title.textContent = "Page sources";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    panelObservers.get(host)?.disconnect();
    host.remove();
  });
  header.append(title, close);
  const list = document.createElement("div");
  list.className = "list";
  const render = () => {
    const sources = collectPageSources(document, options);
    title.textContent = `Page sources (${sources.length})`;
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
      if (preview instanceof HTMLImageElement || preview instanceof HTMLVideoElement)
        preview.src = source.url;
      else {
        preview.className = "audio";
        preview.textContent =
          options.previews === false ? (source.kind === "image" ? "▧" : "▶") : "♪";
      }
      const text = document.createElement("div");
      const url = document.createElement("div");
      const kind = document.createElement("div");
      url.className = "url";
      url.textContent = source.url;
      url.title = source.url;
      kind.className = "kind";
      kind.textContent = source.kind;
      text.append(url, kind);
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
      save.textContent = "Save";
      save.addEventListener("click", () => sendDownload(source));
      actions.append(locate, save);
      row.append(preview, text, actions);
      list.append(row);
    });
  };
  panel.append(header, list);
  shadow.append(style, panel);
  document.documentElement.append(host);
  render();
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
