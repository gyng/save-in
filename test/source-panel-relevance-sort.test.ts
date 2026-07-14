// @vitest-environment jsdom
import { sortPageSources, type PageSource } from "../src/content/source-panel-model.ts";

const source = (overrides: Partial<PageSource>): PageSource => ({
  url: "https://cdn.test/source.bin",
  kind: "link",
  element: document.createElement("a"),
  ...overrides,
});

describe("Page Sources relevance sorting", () => {
  test("prefers the selected media candidate in the main content", () => {
    document.body.innerHTML = `<main><picture><img id="hero"></picture></main>`;
    const hero = document.querySelector("#hero")!;
    const selected = source({
      url: "https://cdn.test/hero-large.jpg",
      kind: "image",
      element: hero,
      previewable: true,
      bytes: 200_000,
    });
    const unselectedFallback = source({
      url: "https://cdn.test/hero-thumbnail.jpg",
      kind: "image",
      element: hero,
      previewable: false,
      bytes: 2_000_000,
    });

    expect(sortPageSources([unselectedFallback, selected], "relevance")).toEqual([
      selected,
      unselectedFallback,
    ]);
  });

  test("ranks useful media above generic links and hidden low-value assets", () => {
    document.body.innerHTML = `<img id="pixel" hidden><a id="page"></a>`;
    const playlist = source({
      url: "https://video.test/master.m3u8",
      kind: "stream",
      element: document.body,
    });
    const page = source({
      url: "https://example.test/article",
      kind: "link",
      element: document.querySelector("#page")!,
      previewable: true,
    });
    const pixel = source({
      url: "https://analytics.test/tracking-pixel.gif",
      kind: "image",
      element: document.querySelector("#pixel")!,
      previewable: true,
      bytes: 43,
    });

    expect(sortPageSources([pixel, page, playlist], "relevance")).toEqual([playlist, page, pixel]);
  });

  test("uses size and then detection order as stable tie-breakers", () => {
    const element = document.createElement("img");
    const small = source({
      url: "https://cdn.test/a.jpg",
      kind: "image",
      element,
      bytes: 1_000,
      detectedAt: 3,
    });
    const largeOlder = source({
      url: "https://cdn.test/b.jpg",
      kind: "image",
      element,
      bytes: 10_000,
      detectedAt: 1,
    });
    const largeNewer = source({
      url: "https://cdn.test/c.jpg",
      kind: "image",
      element,
      bytes: 10_000,
      detectedAt: 2,
    });

    expect(sortPageSources([small, largeOlder, largeNewer], "relevance")).toEqual([
      largeNewer,
      largeOlder,
      small,
    ]);
  });

  test("handles malformed URLs, anchor media, missing sizes, and final URL ties", () => {
    const anchor = document.createElement("a");
    const malformed = source({ url: "not a url", kind: "image", element: anchor });
    const missingSize = source({ url: "https://cdn.test/z", kind: "image", element: anchor });
    const alphabetical = source({ url: "https://cdn.test/a", kind: "image", element: anchor });

    expect(sortPageSources([malformed, missingSize, alphabetical], "relevance")).toEqual([
      alphabetical,
      missingSize,
      malformed,
    ]);
    expect(sortPageSources([missingSize, alphabetical], "size-desc")).toEqual([
      missingSize,
      alphabetical,
    ]);
  });
});
