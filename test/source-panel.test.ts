import {
  collectPageSources,
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
    expect(imageFacet?.textContent).toBe("Image (1)");
    imageFacet!.click();
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
});
