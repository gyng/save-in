// @vitest-environment jsdom
import {
  collectPageSources,
  createSourceTooltip,
  filterPageSources,
  formatSourceBytes,
  positionSourceTooltip,
  sortPageSources,
  urlsFromSrcset,
  ytDlpCommand,
} from "../src/content/source-panel-model.ts";

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
        ({ url }) => url,
      ),
    ).toEqual([
      "http://localhost/selected.jpg",
      "http://localhost/fallback.jpg",
      "http://localhost/large.jpg",
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
  expect(filterPageSources(sources, "master", "all")).toEqual([sources[1]!]);
  expect(filterPageSources(sources, "", "image")).toEqual([sources[0]!]);
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
});
