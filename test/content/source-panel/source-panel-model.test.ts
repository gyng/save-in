// @vitest-environment jsdom
import {
  collectBackgroundElements,
  collectBackgroundSourceCandidates,
  collectPageSourceCandidates,
  createPageSourcePayloadBudget,
  collectPageSources,
  collectResourceHintSources,
  candidatesFromSrcset,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  isPerformanceResourceTiming,
  mergeResourceTimings,
  isSourceSort,
  mergePageSourcesByUrl,
  positionDraggedSourcePanel,
  positionSourceTooltip,
  resourceTimingByUrl,
  SOURCE_PANEL_RESOURCE_TIMING_LIMIT,
  sortPageSources,
  type SourcePanelResourceTiming,
  urlsFromCss,
  urlsFromSrcset,
} from "../../../src/content/source-panel-model.ts";

test("bounds retained resource timing entries to the newest observations", () => {
  const entries = Array.from(
    { length: SOURCE_PANEL_RESOURCE_TIMING_LIMIT + 1 },
    (_, index) =>
      ({
        name: `https://cdn.test/resource-${index}.js`,
        encodedBodySize: index,
      }) as PerformanceResourceTiming,
  );
  const timingFixture = entries[0];
  if (!timingFixture) throw new Error("resource timing fixture is empty");
  const refreshed: PerformanceResourceTiming = {
    ...timingFixture,
    name: "https://cdn.test/resource-0.js",
    encodedBodySize: 999_999,
    serverTiming: [
      { name: "page-controlled-detail", description: "", duration: 0, toJSON: () => ({}) },
    ],
  };
  entries.push(refreshed);

  const timing = resourceTimingByUrl(entries);

  expect(timing.size).toBe(SOURCE_PANEL_RESOURCE_TIMING_LIMIT);
  expect(timing.get("https://cdn.test/resource-0.js")?.encodedBodySize).toBe(999_999);
  expect(timing.get("https://cdn.test/resource-0.js")).not.toBe(refreshed);
  expect(timing.get("https://cdn.test/resource-0.js")).not.toHaveProperty("serverTiming");
  expect(timing.has("https://cdn.test/resource-1.js")).toBe(false);
  expect(
    timing.get(`https://cdn.test/resource-${SOURCE_PANEL_RESOURCE_TIMING_LIMIT}.js`)
      ?.encodedBodySize,
  ).toBe(SOURCE_PANEL_RESOURCE_TIMING_LIMIT);
});

test("bounds the timing map while a large observation batch is merged", () => {
  class PeakMap extends Map<string, SourcePanelResourceTiming> {
    peakSize = 0;
    override set(key: string, value: SourcePanelResourceTiming): this {
      super.set(key, value);
      this.peakSize = Math.max(this.peakSize, this.size);
      return this;
    }
  }
  const timing = new PeakMap();
  const entries = Array.from(
    { length: SOURCE_PANEL_RESOURCE_TIMING_LIMIT * 4 },
    (_, index) => ({ name: `https://cdn.test/burst-${index}.js` }) as PerformanceResourceTiming,
  );

  mergeResourceTimings(timing, entries);

  expect(timing.size).toBe(SOURCE_PANEL_RESOURCE_TIMING_LIMIT);
  expect(timing.peakSize).toBe(SOURCE_PANEL_RESOURCE_TIMING_LIMIT);
});

test("skips an obsolete timing prefix once the newest unique set is full", () => {
  const entries = Array.from(
    { length: SOURCE_PANEL_RESOURCE_TIMING_LIMIT + 1 },
    (_, index) => ({ name: `https://cdn.test/recent-${index}.js` }) as PerformanceResourceTiming,
  );
  Object.defineProperty(entries, 0, {
    get: () => {
      throw new Error("obsolete timing entry was inspected");
    },
  });

  const timing = resourceTimingByUrl(entries);

  expect(timing.size).toBe(SOURCE_PANEL_RESOURCE_TIMING_LIMIT);
  expect(timing.has("https://cdn.test/recent-0.js")).toBe(false);
  expect(timing.has(`https://cdn.test/recent-${SOURCE_PANEL_RESOURCE_TIMING_LIMIT}.js`)).toBe(true);
});

test("merges responsive metadata into an earlier plain source", () => {
  const element = document.createElement("img");
  const merged = mergePageSourcesByUrl([
    { url: "https://example.com/image.jpg", kind: "image", element },
    {
      url: "https://example.com/image.jpg",
      kind: "image",
      element,
      responsive: { selected: true, descriptor: "2x" },
    },
  ]);

  expect(merged[0]?.responsive).toEqual({ selected: true, descriptor: "2x" });
});

test("compacts repeated source origins during collection", () => {
  document.body.innerHTML = Array.from(
    { length: 1_000 },
    (_, index) => `<img id="image-${index}" src="shared.jpg">`,
  ).join("");

  const candidates = collectPageSourceCandidates(
    document,
    { includeLinks: false, includeBackgrounds: false, resourceHints: false },
    new Map(),
  );

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.url).toBe("http://localhost/shared.jpg");
  const merged = mergePageSourcesByUrl(candidates);
  expect(merged[0]?.originElements).toHaveLength(1_000);
  expect(new Set(merged[0]?.originElements).size).toBe(1_000);
});

test("resolves a repeated ordinary source once per collection", () => {
  document.body.innerHTML = Array.from({ length: 1_000 }, () => '<img src="shared.jpg">').join("");
  const excludeUrl = vi.fn((_url: string) => false);

  const candidates = collectPageSourceCandidates(
    document,
    { includeLinks: false, includeBackgrounds: false, resourceHints: false },
    new Map(),
    createPageSourcePayloadBudget([], undefined, excludeUrl),
  );

  expect(candidates).toHaveLength(1);
  expect(excludeUrl).toHaveBeenCalledOnce();
});

test("caches rejection of a repeated ordinary source", () => {
  document.body.innerHTML = Array.from({ length: 1_000 }, () => '<img src="shared.jpg">').join("");
  const excludeUrl = vi.fn((_url: string) => true);

  const candidates = collectPageSourceCandidates(
    document,
    { includeLinks: false, includeBackgrounds: false, resourceHints: false },
    new Map(),
    createPageSourcePayloadBudget([], undefined, excludeUrl),
  );

  expect(candidates).toHaveLength(0);
  expect(excludeUrl).toHaveBeenCalledOnce();
});

test("bounds the ordinary-source admission cache", () => {
  document.body.innerHTML = [
    '<img src="shared.jpg">',
    ...Array.from({ length: 512 }, (_, index) => `<img src="unique-${index}.jpg">`),
    '<img src="shared.jpg">',
  ].join("");
  const excludeUrl = vi.fn((_url: string) => false);

  const candidates = collectPageSourceCandidates(
    document,
    { includeLinks: false, includeBackgrounds: false, resourceHints: false },
    new Map(),
    createPageSourcePayloadBudget([], undefined, excludeUrl),
  );

  expect(candidates).toHaveLength(513);
  expect(excludeUrl).toHaveBeenCalledTimes(514);
  expect(
    excludeUrl.mock.calls.filter(([url]) => url === "http://localhost/shared.jpg"),
  ).toHaveLength(2);
});

test("can discard duplicate origins when routing does not need CSS evidence", () => {
  document.body.innerHTML = Array.from(
    { length: 1_000 },
    (_, index) => `<img id="image-${index}" src="shared.jpg">`,
  ).join("");

  const candidates = collectPageSourceCandidates(
    document,
    { includeLinks: false, includeBackgrounds: false, resourceHints: false },
    new Map(),
    createPageSourcePayloadBudget(),
    false,
  );

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.collectorOriginElements).toEqual([document.querySelector("img")]);
});

test("keeps unique duplicate origins in discovery order", () => {
  const first = document.createElement("img");
  const second = document.createElement("img");
  const shared = { url: "https://example.com/shared.jpg", kind: "image" as const };

  const merged = mergePageSourcesByUrl([
    { ...shared, element: first },
    { ...shared, element: second },
    { ...shared, element: first },
  ]);

  expect(merged[0]?.originElements).toEqual([first, second]);
});

test("reuses static relevance work while keeping byte scoring live", () => {
  const first = document.createElement("img");
  const second = document.createElement("img");
  const domMatches = vi.spyOn(Element.prototype, "matches");
  const domClosest = vi.spyOn(Element.prototype, "closest");
  const sources = [
    { url: "https://example.com/a.jpg", kind: "image" as const, element: first, bytes: 1 },
    { url: "https://example.com/b.jpg", kind: "image" as const, element: second, bytes: 1024 },
  ];
  const cache = new WeakMap();

  expect(sortPageSources(sources, "relevance", cache)[0]?.url).toBe("https://example.com/b.jpg");
  const firstReadCount = domMatches.mock.calls.length + domClosest.mock.calls.length;
  sources[0]!.bytes = 1024 * 1024;
  sources[1]!.bytes = 1;
  expect(sortPageSources(sources, "relevance", cache)[0]?.url).toBe("https://example.com/a.jpg");

  expect(domMatches.mock.calls.length + domClosest.mock.calls.length).toBe(firstReadCount);
});

test("accepts legacy and resource timing entries but rejects unrelated performance entries", () => {
  expect(isPerformanceResourceTiming({ entryType: "" } as PerformanceEntry)).toBe(true);
  expect(isPerformanceResourceTiming({ entryType: "resource" } as PerformanceEntry)).toBe(true);
  expect(isPerformanceResourceTiming({ entryType: "navigation" } as PerformanceEntry)).toBe(false);
});

test("shares a bounded inline-payload budget across incremental source scans", () => {
  const budget = createPageSourcePayloadBudget([], 50);
  const first = document.createElement("img");
  first.src = `data:image/png,${"a".repeat(20)}`;
  const second = document.createElement("img");
  second.src = `data:image/png,${"b".repeat(20)}`;

  expect(
    collectPageSourceCandidates(
      first,
      { includeBackgrounds: false, resourceHints: false },
      new Map(),
      budget,
    ),
  ).toHaveLength(1);
  expect(
    collectPageSourceCandidates(
      second,
      { includeBackgrounds: false, resourceHints: false },
      new Map(),
      budget,
    ),
  ).toHaveLength(0);
});

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

  test("parses responsive source lists without splitting data-URL commas", () => {
    expect(
      urlsFromSrcset(
        "small.jpg 1x, data:image/png;base64,AAAA 2x, wide.jpg 1200w, fallback.jpg, next.jpg 3x",
      ),
    ).toEqual(["small.jpg", "data:image/png;base64,AAAA", "wide.jpg", "fallback.jpg", "next.jpg"]);
    expect(urlsFromSrcset(" , \t ")).toEqual([]);
    expect(urlsFromSrcset("first.jpg type(image, jpeg), second.jpg 2x")).toEqual([
      "first.jpg",
      "second.jpg",
    ]);
    expect(candidatesFromSrcset("small.jpg 1x, wide.jpg 1200w, fallback.jpg")).toEqual([
      { url: "small.jpg", descriptor: "1x" },
      { url: "wide.jpg", descriptor: "1200w" },
      { url: "fallback.jpg" },
    ]);
  });

  test("parses quoted and unquoted CSS image URLs", () => {
    expect(urlsFromCss(`url("double.png") url('single.png') url(plain.png)`)).toEqual([
      "double.png",
      "single.png",
      "plain.png",
    ]);
  });

  test("collects picture source candidates with their fallback image", () => {
    document.body.innerHTML = `
      <picture>
        <source media="(max-width: 600px)" srcset="mobile.jpg 1x, mobile@2x.jpg 2x">
        <source srcset="data:image/png;base64,AAAA 1x, desktop.jpg 2x">
        <img src="fallback.jpg" srcset="fallback@2x.jpg 2x">
      </picture>`;

    expect(
      collectPageSources(document, { includeBackgrounds: false, resourceHints: false }).map(
        ({ url }) => url,
      ),
    ).toEqual([
      "http://localhost/fallback.jpg",
      "http://localhost/fallback@2x.jpg",
      "http://localhost/mobile.jpg",
      "http://localhost/mobile@2x.jpg",
      "data:image/png;base64,AAAA",
      "http://localhost/desktop.jpg",
    ]);
  });

  test("keeps img src fallback when currentSrc selects a responsive candidate", () => {
    document.body.innerHTML = `<img src="fallback.jpg" srcset="selected.jpg 1x, large.jpg 2x">`;
    const image = document.querySelector("img")!;
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "http://localhost/selected.jpg",
    });

    expect(
      collectPageSources(document, { includeBackgrounds: false, resourceHints: false }).map(
        ({ url, responsive }) => [url, responsive],
      ),
    ).toEqual([
      ["http://localhost/selected.jpg", { descriptor: "1x", selected: true }],
      ["http://localhost/fallback.jpg", { selected: false }],
      ["http://localhost/large.jpg", { descriptor: "2x", selected: false }],
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

  test("classifies linked audio and streams and can omit all links", () => {
    document.body.innerHTML = `
      <a href="sound.flac">sound</a><a href="playlist.m3u8">playlist</a><a href="">same page</a>`;
    expect(
      collectPageSources(document, { includeBackgrounds: false, resourceHints: false }).map(
        ({ kind }) => kind,
      ),
    ).toEqual(["audio", "stream", "link"]);
    expect(
      collectPageSources(document, {
        includeLinks: false,
        includeBackgrounds: false,
        resourceHints: false,
      }),
    ).toEqual([]);
  });

  test("tags each source with the channel it was discovered through", () => {
    document.head.innerHTML = `<base href="https://example.com/page/">`;
    document.body.innerHTML = `
      <img src="hero.jpg">
      <a href="paper.pdf">paper</a>
      <div style="background-image:url('wall.png')"></div>`;
    const timingSpy = vi
      .spyOn(performance, "getEntriesByType")
      .mockReturnValue([{ name: "https://cdn.test/master.m3u8" } as PerformanceEntry]);

    const byUrl = new Map(collectPageSources().map(({ url, channel }) => [url, channel]));
    timingSpy.mockRestore();
    // Media embedded directly on the page (img/video/audio) carries no channel
    // — the pre-4.2 default that keeps old candidates and the Page Sources
    // panel's behavior unchanged.
    expect(byUrl.get("https://example.com/page/hero.jpg")).toBeUndefined();
    expect(byUrl.get("https://example.com/page/paper.pdf")).toBe("anchor");
    expect(byUrl.get("https://example.com/page/wall.png")).toBe("background");
    expect(byUrl.get("https://cdn.test/master.m3u8")).toBe("resource-hint");
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

  test("maps resource timing sizes and rejects unsafe manifest and background URLs", () => {
    const entries = [
      {
        name: "https://cdn.test/master.m3u8",
        encodedBodySize: 0,
        transferSize: 2048,
      } as PerformanceResourceTiming,
      {
        name: "https://cdn.test/empty.mpd",
        encodedBodySize: 0,
        transferSize: 0,
      } as PerformanceResourceTiming,
      {
        name: "https://cdn.test/invalid-primary.m3u8",
        encodedBodySize: -1,
        transferSize: 4096,
      } as PerformanceResourceTiming,
      {
        name: "https://cdn.test/fractional.mpd",
        encodedBodySize: 1.5,
        transferSize: 0,
      } as PerformanceResourceTiming,
      {
        name: "https://cdn.test/unsafe.mpd",
        encodedBodySize: Number.MAX_SAFE_INTEGER + 1,
        transferSize: 1024,
      } as PerformanceResourceTiming,
      { name: "javascript:unsafe.m3u8" } as PerformanceResourceTiming,
    ];
    const timing = resourceTimingByUrl(entries);
    expect(collectResourceHintSources(timing).map(({ bytes }) => bytes)).toEqual([
      2048,
      undefined,
      4096,
      undefined,
      1024,
    ]);

    const element = document.createElement("div");
    element.style.backgroundImage = `url("https://cdn.test/double.png"), url(https://cdn.test/plain.png), url("javascript:bad")`;
    document.body.append(element);
    expect(collectBackgroundElements(element)).toEqual([element]);
    expect(collectBackgroundSourceCandidates([element], timing).map(({ url }) => url)).toEqual([
      "https://cdn.test/double.png",
      "https://cdn.test/plain.png",
    ]);
  });

  test("collects a root media element and media source srcset candidates", () => {
    const video = document.createElement("video");
    video.innerHTML = `<span></span><source src="fallback.webm" srcset="small.webm 1x, large.webm 2x">`;
    expect(
      collectPageSourceCandidates(video, {
        includeLinks: false,
        includeBackgrounds: false,
        resourceHints: false,
      }).map(({ url }) => url),
    ).toEqual([
      "http://localhost/fallback.webm",
      "http://localhost/small.webm",
      "http://localhost/large.webm",
    ]);
  });

  test("uses reflected media properties and skips non-source picture siblings", () => {
    const picture = document.createElement("picture");
    const irrelevant = document.createElement("span");
    const emptySource = document.createElement("source");
    const image = document.createElement("img");
    Object.defineProperty(image, "src", {
      configurable: true,
      value: "https://cdn.test/image.jpg",
    });
    picture.append(irrelevant, emptySource, image);

    const video = document.createElement("video");
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://cdn.test/selected.mp4",
    });
    Object.defineProperty(video, "src", {
      configurable: true,
      value: "https://cdn.test/fallback.mp4",
    });
    const source = document.createElement("source");
    Object.defineProperty(source, "src", {
      configurable: true,
      value: "https://cdn.test/source.mp4",
    });
    video.append(source);

    const root = document.createElement("div");
    root.append(picture, video);
    expect(
      collectPageSourceCandidates(root, {
        includeLinks: false,
        includeBackgrounds: false,
        resourceHints: false,
      }).map(({ url }) => url),
    ).toEqual([
      "https://cdn.test/image.jpg",
      "https://cdn.test/selected.mp4",
      "https://cdn.test/fallback.mp4",
      "https://cdn.test/source.mp4",
    ]);
  });

  test("avoids computed-style work for anonymous elements", () => {
    document.body.innerHTML = `${"<span></span>".repeat(500)}<div class="poster"></div>`;
    const computed = vi.spyOn(window, "getComputedStyle");
    collectPageSources();
    expect(computed.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

test("formats available Resource Timing sizes compactly", () => {
  expect(formatSourceBytes()).toBe("size unknown");
  expect(formatSourceBytes(-1)).toBe("size unknown");
  expect(formatSourceBytes(1.5)).toBe("size unknown");
  expect(formatSourceBytes(Number.POSITIVE_INFINITY)).toBe("size unknown");
  expect(formatSourceBytes(Number.MAX_SAFE_INTEGER + 1)).toBe("size unknown");
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
  expect(filterPageSources(sources, "master", "all")).toEqual([sources[1]!]);
  expect(filterPageSources(sources, "", "image")).toEqual([sources[0]!]);
});

test("validates persisted source sort values", () => {
  expect(isSourceSort("relevance")).toBe(true);
  expect(isSourceSort("unknown")).toBe(false);
  expect(isSourceSort(3)).toBe(false);
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
  const video = createSourceTooltip({
    url: "https://x.test/video.mp4",
    kind: "video",
    element,
  })!.querySelector("video")!;
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video.playsInline).toBe(true);
  expect(createSourceTooltip({ url: "https://x.test/page", kind: "link", element })).toBeNull();
});

test.each([
  ["right", { left: 900, top: 0, right: 1200, bottom: 800 }, "left", 592, 125],
  ["left", { left: 0, top: 0, right: 300, bottom: 800 }, "right", 308, 125],
  ["bottom", { left: 0, top: 600, right: 1200, bottom: 800 }, "top", 450, 392],
  ["top", { left: 0, top: 0, right: 1200, bottom: 200 }, "bottom", 450, 208],
] as const)("places source tooltips outside a %s-docked panel", (dock, panel, side, left, top) => {
  expect(
    positionSourceTooltip(
      { left: 300, top: 200, right: 900, bottom: 250 },
      panel,
      { width: 300, height: 200 },
      { width: 1200, height: 800 },
      dock,
    ),
  ).toEqual({ left, top, side });
});

test("chooses usable floating-panel space and clamps the tooltip to the viewport", () => {
  expect(
    positionSourceTooltip(
      { left: 710, top: 200, right: 1090, bottom: 250 },
      { left: 700, top: 100, right: 1100, bottom: 600 },
      { width: 300, height: 200 },
      { width: 1200, height: 800 },
      "floating",
    ),
  ).toEqual({ left: 392, top: 125, side: "left" });
  expect(
    positionSourceTooltip(
      { left: 185, top: 50, right: 295, bottom: 90 },
      { left: 180, top: 0, right: 300, bottom: 200 },
      { width: 200, height: 100 },
      { width: 300, height: 200 },
      "right",
    ).left,
  ).toBe(8);
  expect(
    positionSourceTooltip(
      { left: 185, top: 50, right: 295, bottom: 90 },
      { left: 180, top: 40, right: 400, bottom: 240 },
      { width: 200, height: 100 },
      { left: 100, top: 50, width: 300, height: 200 },
      "right",
    ),
  ).toMatchObject({ left: 108, top: 58, side: "left" });
});

test("moves a floating panel by pointer delta and clamps it to the viewport", () => {
  const panel = { left: 100, top: 80, width: 320, height: 400 };
  const viewport = { width: 1200, height: 800 };

  expect(
    positionDraggedSourcePanel(panel, { x: 120, y: 100 }, { x: 160, y: 130 }, viewport),
  ).toEqual({ left: 140, top: 110 });
  expect(
    positionDraggedSourcePanel(panel, { x: 120, y: 100 }, { x: -500, y: 900 }, viewport),
  ).toEqual({ left: 8, top: 392 });
  expect(
    positionDraggedSourcePanel(
      panel,
      { x: 120, y: 100 },
      { x: -500, y: 900 },
      { left: 20, top: 30, width: 600, height: 500 },
    ),
  ).toEqual({ left: 28, top: 122 });
});
