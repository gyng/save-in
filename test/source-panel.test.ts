import {
  collectPageSources,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  setSourcePanelOpen,
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

  test("ignores malformed link URLs without aborting collection", () => {
    document.body.innerHTML = `<a href="http://[">broken</a><img src="valid.png">`;

    expect(collectPageSources().map(({ url }) => url)).toEqual(["http://localhost/valid.png"]);
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
      { name: "javascript:unsafe.m3u8" } as PerformanceEntry,
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
  expect(sortPageSources([older, newer], "detected-asc")).toEqual([older, newer]);
  expect(sortPageSources([older, newer], "size-desc")).toEqual([newer, older]);
  expect(sortPageSources([older, newer], "name-asc")).toEqual([newer, older]);
});

test("uses detection sequence when sources are found in the same millisecond", () => {
  const element = document.createElement("div");
  const first = {
    url: "https://x.test/first",
    kind: "image" as const,
    element,
    detectedAt: 100,
    detectedOrder: 1,
  };
  const second = {
    url: "https://x.test/second",
    kind: "image" as const,
    element,
    detectedAt: 100,
    detectedOrder: 2,
  };

  expect(sortPageSources([first, second], "detected-desc")).toEqual([second, first]);
  expect(sortPageSources([first, second], "detected-asc")).toEqual([first, second]);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("copies only URLs in the active text and type filters", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <img src="cat.jpg"><img src="dog.jpg"><a href="cat.pdf">cat paper</a>`;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    expect(toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false })).toBe(true);
    const shadow = document.getElementById("save-in-source-panel")?.shadowRoot;
    const filter = shadow?.querySelector<HTMLInputElement>('input[type="search"]');
    filter!.value = "cat";
    filter!.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
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

  test("cancels delayed removal when the panel is reopened during its exit transition", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const options = { includeBackgrounds: false, live: false, onOpenChange };
    toggleSourcePanel(vi.fn(), options);
    expect(toggleSourcePanel(vi.fn(), options)).toBe(false);

    expect(setSourcePanelOpen(true, vi.fn(), options)).toBe(true);
    vi.advanceTimersByTime(90);

    expect(document.getElementById("save-in-source-panel")).not.toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    vi.useRealTimers();
  });

  test("filters cached sources without rescanning the page on every keystroke", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img src="cat.jpg"><img src="dog.jpg">`;
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    resourceReads.mockClear();
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const filter = shadow.querySelector<HTMLInputElement>('input[type="search"]')!;
    const dogRow = [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
      row.textContent?.includes("dog.jpg"),
    );

    filter.value = "c";
    filter.dispatchEvent(new Event("input"));
    filter.value = "cat";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);

    expect(resourceReads).not.toHaveBeenCalled();
    expect(shadow.querySelectorAll(".row")).toHaveLength(1);

    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(80);
    expect(
      [...shadow.querySelectorAll<HTMLElement>(".row")].find((row) =>
        row.textContent?.includes("dog.jpg"),
      ),
    ).toBe(dogRow);
    vi.useRealTimers();
  });

  test("loads list previews only when they approach the panel viewport", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    class IntersectionObserverStub {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe = observe;
      disconnect = vi.fn();
      unobserve = unobserve;
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    document.body.innerHTML = `<a href="movie.mp4">movie</a>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const video = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLVideoElement>(".source-link video")!;

    expect(video.hasAttribute("src")).toBe(false);
    expect(observe).toHaveBeenCalledWith(video);
    intersectionCallback!(
      [{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry],
      { unobserve } as unknown as IntersectionObserver,
    );

    expect(video.src).toBe("http://localhost/movie.mp4");
  });

  test("ignores panel mutations and incrementally reconciles changed link targets", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<a id="dynamic" href="first.html">first</a><a href="stable.html">stable</a>`;
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const host = document.getElementById("save-in-source-panel")!;
    const stableRow = [...host.shadowRoot!.querySelectorAll<HTMLElement>(".row")].find((row) =>
      row.textContent?.includes("stable.html"),
    );
    resourceReads.mockClear();

    host.style.width = "400px";
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(resourceReads).not.toHaveBeenCalled();

    document.querySelector<HTMLAnchorElement>("#dynamic")!.href = "second.html";
    await Promise.resolve();
    vi.advanceTimersByTime(250);
    expect(resourceReads).not.toHaveBeenCalled();
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toContain("http://localhost/second.html");
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLElement>(".row")].find((row) =>
        row.textContent?.includes("stable.html"),
      ),
    ).toBe(stableRow);
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).not.toContain("http://localhost/first.html");
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toContain("http://localhost/stable.html");
    vi.useRealTimers();
  });

  test("incrementally adds and removes sources while retaining duplicate URL fallbacks", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<img id="first" src="shared.jpg"><img id="second" src="shared.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: true });
    const host = document.getElementById("save-in-source-panel")!;

    document.querySelector("#first")!.remove();
    const added = document.createElement("img");
    added.src = "new.jpg";
    document.body.append(added);
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).toEqual(expect.arrayContaining(["http://localhost/shared.jpg", "http://localhost/new.jpg"]));

    document.querySelector("#second")!.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    expect(
      [...host.shadowRoot!.querySelectorAll<HTMLAnchorElement>(".source-link")].map(
        ({ href }) => href,
      ),
    ).not.toContain("http://localhost/shared.jpg");
  });

  test("refreshes computed backgrounds after a class change", async () => {
    vi.useFakeTimers();
    document.head.innerHTML = `<style>.poster { background-image: url(poster.jpg) }</style>`;
    document.body.innerHTML = `<div id="dynamic-background"></div>`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: true, live: true, includeLinks: false });
    const host = document.getElementById("save-in-source-panel")!;

    document.querySelector("#dynamic-background")!.className = "poster";
    await Promise.resolve();
    vi.advanceTimersByTime(200);

    expect(host.shadowRoot!.querySelector<HTMLAnchorElement>(".source-link")!.href).toBe(
      "http://localhost/poster.jpg",
    );
  });

  test("refreshes when a new streaming resource is observed", () => {
    vi.useFakeTimers();
    let performanceCallback: PerformanceObserverCallback | undefined;
    const observe = vi.fn();
    class PerformanceObserverStub {
      constructor(callback: PerformanceObserverCallback) {
        performanceCallback = callback;
      }
      observe = observe;
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    vi.stubGlobal("PerformanceObserver", PerformanceObserverStub);
    const resourceReads = vi.spyOn(performance, "getEntriesByType");
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: true,
      resourceHints: true,
    });
    resourceReads.mockClear();

    performanceCallback!(
      { getEntries: () => [{ name: "https://cdn.test/new.m3u8" }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    vi.advanceTimersByTime(200);

    expect(observe).toHaveBeenCalledWith({ entryTypes: ["resource"] });
    expect(resourceReads).not.toHaveBeenCalled();
    expect(
      document
        .getElementById("save-in-source-panel")!
        .shadowRoot!.querySelector<HTMLAnchorElement>(".source-link")!.href,
    ).toBe("https://cdn.test/new.m3u8");
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

  test("warms the background only at Page Sources save-intent boundaries", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const onSaveIntent = vi.fn();
    toggleSourcePanel(vi.fn(), {
      includeBackgrounds: false,
      live: false,
      onSaveIntent,
    });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const row = shadow.querySelector<HTMLElement>(".row")!;
    const [locate, save] = [...row.querySelectorAll<HTMLButtonElement>(".actions button")];

    locate.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(onSaveIntent).not.toHaveBeenCalled();

    save.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    save.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, altKey: true }));
    row.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", altKey: true }));

    expect(onSaveIntent).toHaveBeenCalledTimes(4);
  });

  test("Alt-clicking the Save action triggers only its button download", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const save = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".actions button:last-child")!;

    save.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).toHaveBeenCalledOnce();
  });

  test("Alt-clicking non-save action buttons does not trigger a row download", () => {
    document.body.innerHTML = `<img src="cat.jpg">`;
    const sendDownload = vi.fn();
    toggleSourcePanel(sendDownload, { includeBackgrounds: false, live: false });
    const locate = document
      .getElementById("save-in-source-panel")!
      .shadowRoot!.querySelector<HTMLButtonElement>(".actions button")!;
    document.querySelector<HTMLImageElement>("img")!.scrollIntoView = vi.fn();

    locate.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, altKey: true }));

    expect(sendDownload).not.toHaveBeenCalled();
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

  test("newest and oldest visibly reverse sources detected in one render", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    document.body.innerHTML = `<img src="first.jpg"><img src="second.jpg">`;
    toggleSourcePanel(vi.fn(), { includeBackgrounds: false, live: false });
    const shadow = document.getElementById("save-in-source-panel")!.shadowRoot!;
    const names = () =>
      [...shadow.querySelectorAll<HTMLElement>(".source-link .name")].map(
        (name) => name.textContent,
      );

    expect(names()).toEqual(["second.jpg", "first.jpg"]);

    const sort = shadow.querySelector<HTMLSelectElement>('select[aria-label="Sort sources"]')!;
    sort.value = "detected-asc";
    sort.dispatchEvent(new Event("change"));

    expect(names()).toEqual(["first.jpg", "second.jpg"]);
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
