import {
  collectPageSources,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  sortPageSources,
  toggleSourcePanel,
  ytDlpCommand,
} from "../src/content/source-panel.ts";

describe("page source collection", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  test("collects and deduplicates media, source candidates, and backgrounds", () => {
    document.head.innerHTML = `<base href="https://example.com/page/">`;
    document.body.innerHTML = `
      <img src="hero.jpg" srcset="hero.jpg 1x, hero@2x.jpg 2x">
      <video src="movie.mp4"><source src="fallback.webm"></video>
      <audio><source src="sound.ogg"></audio>
      <div id="background" style="background-image:url('wall.png')"></div>`;

    expect(collectPageSources().map(({ url, kind }) => [url, kind])).toEqual([
      ["https://example.com/page/hero.jpg", "image"],
      ["https://example.com/page/hero@2x.jpg", "image"],
      ["https://example.com/page/movie.mp4", "video"],
      ["https://example.com/page/fallback.webm", "video"],
      ["https://example.com/page/sound.ogg", "audio"],
      ["https://example.com/page/wall.png", "image"],
    ]);
  });

  test("rejects unsafe schemes", () => {
    document.body.innerHTML = `<img src="javascript:alert(1)">`;
    expect(collectPageSources()).toEqual([]);
  });

  test("classifies linked media, PDFs, and ordinary links", () => {
    document.body.innerHTML = `
      <a href="photo.webp">photo</a><a href="movie.mp4">movie</a>
      <a href="paper.pdf">paper</a><a href="page.html">page</a>`;
    expect(collectPageSources().map(({ kind }) => kind)).toEqual([
      "image",
      "video",
      "document",
      "link",
    ]);
  });

  test("can omit computed CSS background sources", () => {
    document.body.innerHTML = `<img src="visible.png"><div style="background-image:url(hidden.png)"></div>`;
    expect(
      collectPageSources(document, { includeBackgrounds: false }).map(({ url }) => url),
    ).toEqual(["http://localhost/visible.png"]);
  });

  test("discovers HLS and DASH manifests from resource timing", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://cdn.test/master.m3u8?token=x" } as PerformanceEntry,
      { name: "https://cdn.test/manifest.mpd" } as PerformanceEntry,
      { name: "https://cdn.test/player.js" } as PerformanceEntry,
    ]);
    expect(collectPageSources().map(({ url, kind }) => [url, kind])).toEqual([
      ["https://cdn.test/master.m3u8?token=x", "stream"],
      ["https://cdn.test/manifest.mpd", "stream"],
    ]);
  });

  test("avoids computed-style work for anonymous elements", () => {
    document.body.innerHTML = `${"<span></span>".repeat(500)}<div class="poster"></div>`;
    const computed = vi.spyOn(window, "getComputedStyle");
    collectPageSources();
    expect(computed.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

test("builds a quoted yt-dlp command for a manifest URL", () => {
  expect(ytDlpCommand('https://cdn.test/master.m3u8?name="demo"')).toBe(
    'yt-dlp "https://cdn.test/master.m3u8?name=\\"demo\\""',
  );
});

test("formats available Resource Timing sizes compactly", () => {
  expect(formatSourceBytes()).toBe("size unknown");
  expect(formatSourceBytes(900)).toBe("900 B");
  expect(formatSourceBytes(2048)).toBe("2 KB");
  expect(formatSourceBytes(1572864)).toBe("1.5 MB");
});

test("filters source results by URL and type", () => {
  const element = document.createElement("div");
  const sources = [
    { url: "https://x.test/photo.jpg", kind: "image" as const, element },
    { url: "https://x.test/master.m3u8", kind: "stream" as const, element },
  ];
  expect(filterPageSources(sources, "master", "all")).toEqual([sources[1]]);
  expect(filterPageSources(sources, "", "image")).toEqual([sources[0]]);
});

test("sorts by first-seen time, size, or name", () => {
  const element = document.createElement("div");
  const older = {
    url: "https://x.test/z",
    kind: "video" as const,
    element,
    detectedAt: 1,
    bytes: 5,
  };
  const newer = {
    url: "https://x.test/a",
    kind: "video" as const,
    element,
    detectedAt: 2,
    bytes: 10,
  };
  expect(sortPageSources([older, newer], "detected-desc")).toEqual([newer, older]);
  expect(sortPageSources([older, newer], "size-desc")).toEqual([newer, older]);
  expect(sortPageSources([older, newer], "name-asc")).toEqual([newer, older]);
});

test("builds larger image and autoplaying media tooltips", () => {
  const element = document.createElement("div");
  const imageTooltip = createSourceTooltip({
    url: "https://x.test/image.jpg",
    kind: "image",
    element,
  })!;
  expect(imageTooltip.getAttribute("role")).toBe("tooltip");
  expect(imageTooltip.querySelector("img")?.src).toBe("https://x.test/image.jpg");

  const audioTooltip = createSourceTooltip({
    url: "https://x.test/audio.mp3",
    kind: "audio",
    element,
  })!;
  const audio = audioTooltip.querySelector("audio")!;
  expect(audio.autoplay).toBe(true);
  expect(audio.controls).toBe(true);
  expect(createSourceTooltip({ url: "https://x.test/page", kind: "link", element })).toBeNull();
});

describe("Page Sources panel interactions", () => {
  afterEach(() => {
    document.getElementById("save-in-source-panel")?.remove();
    vi.restoreAllMocks();
  });

  test("copies only URLs in the active text and type filters", async () => {
    document.body.innerHTML = `
      <img src="cat.jpg"><img src="dog.jpg"><a href="cat.pdf">cat paper</a>`;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    expect(toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false })).toBe(true);
    const shadow = document.getElementById("save-in-source-panel")?.shadowRoot;
    const filter = shadow?.querySelector<HTMLInputElement>('input[type="search"]');
    filter!.value = "cat";
    filter!.dispatchEvent(new Event("input"));
    const imageFacet = [...shadow!.querySelectorAll<HTMLButtonElement>(".facet")].find((button) =>
      button.textContent?.startsWith("Image"),
    );
    expect(imageFacet?.childNodes[0]?.textContent).toBe("Image");
    expect(imageFacet?.querySelector(".facet-count")?.textContent).toBe("1");
    imageFacet!.click();
    expect(shadow!.querySelector("h2")?.textContent).toBe("Page sources");
    shadow!.querySelector<HTMLButtonElement>(".copy-urls")!.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("http://localhost/cat.jpg");
  });

  test("marks the panel closing before its short exit transition removes it", () => {
    vi.useFakeTimers();
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    expect(toggleSourcePanel(vi.fn())).toBe(false);
    const host = document.getElementById("save-in-source-panel");
    expect(host?.classList.contains("closing")).toBe(true);
    vi.advanceTimersByTime(90);
    expect(document.getElementById("save-in-source-panel")).toBeNull();
    vi.useRealTimers();
  });

  test("wraps facets and uses compact accessible header actions", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const styles = shadow.querySelector("style")!.textContent!;

    expect(styles).toMatch(/\.facets\{[^}]*flex-wrap:wrap/);
    expect(styles).not.toMatch(/\.facets\{[^}]*overflow:auto/);
    const actions = [...shadow.querySelectorAll<HTMLButtonElement>(".header-actions button")];
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy filtered source URLs",
      "Change panel dock position",
      "Pop out Page Sources",
      "Close Page Sources",
    ]);
    expect(
      actions.every((button) => button.textContent === "" && Boolean(button.querySelector("svg"))),
    ).toBe(true);
  });

  test("pops the drawer into a draggable floating panel", () => {
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const host = document.getElementById("save-in-source-panel")!;
    const popout = host.shadowRoot!.querySelector<HTMLButtonElement>(".popout")!;

    popout.click();

    expect(host.classList.contains("floating")).toBe(true);
    expect(popout.getAttribute("aria-pressed")).toBe("true");
    expect(popout.getAttribute("aria-label")).toBe("Dock Page Sources");
    expect(popout.title).toBe("Dock Page Sources");

    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 80,
      width: 320,
      height: 400,
      right: 420,
      bottom: 480,
      x: 100,
      y: 80,
      toJSON: () => ({}),
    });
    const header = host.shadowRoot!.querySelector("header")!;
    header.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 100 }),
    );
    header.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 160, clientY: 130 }),
    );

    expect(host.style.left).toBe("140px");
    expect(host.style.top).toBe("110px");

    popout.click();
    expect(popout.getAttribute("aria-label")).toBe("Pop out Page Sources");
    expect(popout.title).toBe("Pop out into a draggable panel");
  });

  test("shows compact detection order with the detection time in a tooltip", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const detected = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLElement>(".detected")!;

    expect(detected.textContent).toBe("#1");
    expect(detected.getAttribute("aria-label")).toMatch(/^Detected at /);
    expect(detected.title).toBe("");
  });

  test("uses the full compact result body as a link and replaces broken previews", () => {
    document.body.innerHTML = `<img src="missing.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const rowLink = shadow.querySelector<HTMLAnchorElement>(".source-link")!;
    const preview = rowLink.querySelector<HTMLImageElement>("img")!;

    expect(rowLink.href).toBe("http://localhost/missing.jpg");
    expect(rowLink.querySelector(".name")?.tagName).toBe("SPAN");
    preview.dispatchEvent(new Event("error"));

    expect(rowLink.querySelector("img")).toBeNull();
    expect(rowLink.querySelector(".preview-fallback")?.textContent).toBe("▧");
  });

  test("shows and removes a rich tooltip without competing native titles", () => {
    document.body.innerHTML = `<img src="large.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const sourceLink = row.querySelector<HTMLAnchorElement>(".source-link")!;

    expect(row.title).toBe("");
    expect(sourceLink.title).toBe("");
    row.dispatchEvent(new MouseEvent("mouseenter"));
    expect(shadow.querySelector<HTMLImageElement>(".media-tooltip img")?.src).toBe(
      "http://localhost/large.jpg",
    );
    expect(sourceLink.hasAttribute("aria-describedby")).toBe(true);
    row.dispatchEvent(new MouseEvent("mouseleave"));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(sourceLink.hasAttribute("aria-describedby")).toBe(false);
  });

  test("shows the same preview and page outline for keyboard focus", () => {
    document.body.innerHTML = `<img id="source" src="keyboard.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const source = document.querySelector<HTMLElement>("#source")!;
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const sourceLink = row.querySelector<HTMLAnchorElement>(".source-link")!;

    sourceLink.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(shadow.querySelector(".media-tooltip")).not.toBeNull();
    expect(source.style.outline).toContain("3px");
    sourceLink.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(shadow.querySelector(".media-tooltip")).toBeNull();
    expect(source.style.outline).toBe("");
  });

  test("describes streaming playlists without relying on manifest jargon", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "https://cdn.test/master.m3u8" } as PerformanceEntry,
    ]);
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const playlistFacet = [...shadow.querySelectorAll<HTMLButtonElement>(".facet")].find(
      (button) => button.childNodes[0]?.textContent === "Playlist",
    );

    expect(playlistFacet).toBeDefined();
    playlistFacet!.click();
    expect(shadow.querySelector(".meta")?.textContent).toContain("stream");
    expect(
      [...shadow.querySelectorAll(".actions button")].map((button) => button.textContent),
    ).toEqual(["Locate", "Save playlist", "Copy yt-dlp command"]);
  });
});
