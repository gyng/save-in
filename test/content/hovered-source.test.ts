// @vitest-environment jsdom
import { hoveredElement, hoveredSourceFromDocument } from "../../src/content/hovered-source.ts";

const ClickToSave = (await import("../../src/content/content.ts")).default;

// jsdom tracks no pointer, so :hover never matches. Answer the query the way a
// browser does: every element under the pointer within that scope, outermost
// first.
const hover = (...chain: Element[]): void => {
  const answer = function (this: ParentNode, selector: string) {
    if (selector !== ":hover") throw new Error(`unexpected selector ${selector}`);
    return chain.filter((element) => element.getRootNode() === this);
  };
  vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(answer as never);
  vi.spyOn(ShadowRoot.prototype, "querySelectorAll").mockImplementation(answer as never);
};

const element = (selector: string, root: ParentNode = document): Element => {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`missing fixture element ${selector}`);
  return found;
};

describe("hovered source lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  test("reports nothing when the pointer is outside the page", () => {
    hover();
    expect(hoveredElement(document)).toBeNull();
    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toBeNull();
  });

  test("reports the media under the pointer", () => {
    document.body.innerHTML = '<div><video src="https://x.test/clip.mp4"></video></div>';
    hover(document.body, element("div"), element("video"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toEqual({
      media: { url: "https://x.test/clip.mp4", kind: "video" },
    });
  });

  test("reports a hovered image with its alt text", () => {
    document.body.innerHTML = '<img src="https://x.test/a.png" alt=" Misty forest ">';
    hover(document.body, element("img"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toEqual({
      media: { url: "https://x.test/a.png", kind: "image", alt: "Misty forest" },
    });
  });

  test("reports media from a resolver that names no element", () => {
    document.body.innerHTML = '<img src="https://x.test/a.png" alt="Misty forest">';
    hover(document.body, element("img"));

    expect(
      hoveredSourceFromDocument(document, (_event, allowLinks) =>
        allowLinks ? undefined : { url: "https://x.test/a.png", kind: "image" },
      ),
    ).toEqual({ media: { url: "https://x.test/a.png", kind: "image" } });
  });

  test("reports a linked image as both media and link", () => {
    document.body.innerHTML =
      '<a href="https://x.test/full.jpg"><img src="https://x.test/thumb.jpg"></a>';
    hover(document.body, element("a"), element("img"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toEqual({
      media: { url: "https://x.test/thumb.jpg", kind: "image" },
      linkUrl: "https://x.test/full.jpg",
    });
  });

  test("reports the enclosing link for hovered text", () => {
    document.body.innerHTML = '<a href="https://x.test/file.pdf"><span>file</span></a>';
    hover(document.body, element("a"), element("span"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toEqual({
      linkUrl: "https://x.test/file.pdf",
    });
  });

  test("reports nothing for plain content or an unusable address", () => {
    document.body.innerHTML = '<p>Text</p><a href="javascript:void 0">script</a>';
    hover(document.body, element("p"));
    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toBeNull();
    hover(document.body, element("a"));
    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toBeNull();
  });

  test("never guesses media from a position the pointer may not be at", () => {
    document.body.innerHTML = '<div id="empty"></div><img src="https://x.test/far.png">';
    const elementsFromPoint = vi.fn((x: number, y: number) =>
      x < 0 || y < 0 ? [] : [element("img")],
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: elementsFromPoint,
    });
    hover(document.body, element("#empty"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toBeNull();
    expect(elementsFromPoint).toHaveBeenCalledWith(-1, -1);
  });

  test("follows open shadow roots to the element under the pointer", () => {
    document.body.innerHTML = '<a href="https://x.test/page"><x-card></x-card></a>';
    const host = element("x-card");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<img src="https://x.test/shadow.png">';
    hover(document.body, element("a"), host, element("img", shadow));

    expect(hoveredElement(document)).toBe(element("img", shadow));
    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toEqual({
      media: { url: "https://x.test/shadow.png", kind: "image" },
      linkUrl: "https://x.test/page",
    });
  });

  test("stops at a bounded shadow depth", () => {
    let parent: ParentNode = document.body;
    const chain: Element[] = [];
    for (let depth = 0; depth < 10; depth += 1) {
      const host = document.createElement("x-nest");
      parent.append(host);
      chain.push(host);
      parent = host.attachShadow({ mode: "open" });
    }
    hover(...chain);

    expect(hoveredElement(document)).toBe(chain[7]);
  });

  test("refuses the Page Sources panel", () => {
    document.body.innerHTML =
      '<a href="https://x.test/page"><aside id="save-in-source-panel"></aside></a>';
    hover(document.body, element("a"), element("#save-in-source-panel"));

    expect(hoveredSourceFromDocument(document, ClickToSave.findSource)).toBeNull();
  });
});
