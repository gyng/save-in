import { collectPageSources } from "../src/content/source-panel.ts";

describe("page source collection", () => {
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
});
