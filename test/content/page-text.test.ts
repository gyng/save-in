// @vitest-environment jsdom
import { capturePageText } from "../../src/content/page-text.ts";
import {
  MAX_PAGE_TEXT_LENGTH,
  MAX_PAGE_TEXT_SELECTORS,
} from "../../src/shared/page-text-capture.ts";

describe("page text capture for pagetext: rules", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  test("reads trimmed, whitespace-collapsed text for each selector that finds some", () => {
    document.body.innerHTML = `
      <header><a class="author">  example
        <b>author</b> </a></header>
      <h1 class="title">A   title</h1>
      <p class="empty">   </p>`;

    expect(capturePageText(document, ["header .author", ".title", ".empty", ".absent"])).toEqual([
      ["header .author", "example author"],
      [".title", "A title"],
    ]);
  });

  test("takes the first matching element that has text", () => {
    document.body.innerHTML =
      '<span class="name"> </span><span class="name">second</span><span class="name">third</span>';

    expect(capturePageText(document, [".name"])).toEqual([[".name", "second"]]);
  });

  test("gives up on a selector after its first sixteen elements", () => {
    document.body.innerHTML = `${'<i class="name"></i>'.repeat(16)}<i class="name">late</i>`;
    expect(capturePageText(document, [".name"])).toEqual([]);

    document.body.innerHTML = `${'<i class="name"></i>'.repeat(15)}<i class="name">in time</i>`;
    expect(capturePageText(document, [".name"])).toEqual([[".name", "in time"]]);
  });

  test("uses a meta element's content, which has no text of its own", () => {
    document.head.innerHTML =
      '<meta property="og:title" content="  Example   Author  "><meta name="empty" content=" ">';

    expect(capturePageText(document, ['meta[property="og:title"]', 'meta[name="empty"]'])).toEqual([
      ['meta[property="og:title"]', "Example Author"],
    ]);
  });

  test("bounds the text it keeps and the text it examines", () => {
    document.body.innerHTML = '<p class="long"></p><p class="padded"></p>';
    const long = document.querySelector(".long");
    const padded = document.querySelector(".padded");
    if (!long || !padded) throw new Error("fixture missing");
    long.textContent = "x".repeat(MAX_PAGE_TEXT_LENGTH * 20);
    // Text that starts beyond the examined prefix is not searched for.
    padded.textContent = `${" ".repeat(MAX_PAGE_TEXT_LENGTH * 8)}late`;

    expect(capturePageText(document, [".long", ".padded"])).toEqual([
      [".long", "x".repeat(MAX_PAGE_TEXT_LENGTH)],
    ]);
  });

  test("an invalid selector captures nothing and does not stop the others", () => {
    document.body.innerHTML = '<p class="name">kept</p>';

    expect(capturePageText(document, ["p:not(", ".name", "::"])).toEqual([[".name", "kept"]]);
  });

  test("reads a repeated selector once", () => {
    document.body.innerHTML = '<p class="name">kept</p>';
    const spy = vi.spyOn(document, "querySelectorAll");

    expect(capturePageText(document, [".name", ".name"])).toEqual([[".name", "kept"]]);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  test.each([
    ["nothing", undefined],
    ["a bare selector", ".name"],
    ["a non-string selector", [".name", 7]],
    ["an empty selector", [""]],
    ["an oversized selector", ["x".repeat(513)]],
    [
      "more selectors than the bound",
      Array.from({ length: MAX_PAGE_TEXT_SELECTORS + 1 }, () => ".name"),
    ],
  ])("reads nothing for a request that is %s", (_label, selectors) => {
    document.body.innerHTML = '<p class="name">kept</p>';
    const spy = vi.spyOn(document, "querySelectorAll");

    expect(capturePageText(document, selectors)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("reads only the tree it is given, never another frame's document", () => {
    document.body.innerHTML =
      '<section id="scope"><p class="name">inside</p></section><iframe></iframe>';
    const frame = document.querySelector("iframe")?.contentDocument;
    if (frame) frame.body.innerHTML = '<p class="framed">framed</p>';
    const scope = document.querySelector("#scope");
    if (!scope) throw new Error("fixture missing");

    expect(capturePageText(document, [".framed"])).toEqual([]);
    expect(capturePageText(scope, [".name"])).toEqual([[".name", "inside"]]);
  });
});
