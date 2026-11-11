// @vitest-environment jsdom
import { contextImageFromEvent } from "../../src/content/context-image.ts";

const contextEventOn = (element: Element): MouseEvent => {
  const event = new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 20 });
  Object.defineProperty(event, "target", { value: element });
  Object.defineProperty(event, "composedPath", { value: () => [element, document, window] });
  return event;
};

const stackAtPoint = (...selectors: string[]) => {
  const elementsFromPoint = vi.fn(() =>
    selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing fixture element ${selector}`);
      return element;
    }),
  );
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: elementsFromPoint,
  });
  return elementsFromPoint;
};

const element = (selector: string): Element => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`missing fixture element ${selector}`);
  return found;
};

describe("context image extraction (#237)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  test("reads the image the right-click landed on, loaded or not", () => {
    document.body.innerHTML = '<img src="/art.png">';

    expect(contextImageFromEvent(contextEventOn(element("img")))).toEqual({
      src: "http://localhost/art.png",
    });
  });

  test("prefers the candidate the browser selected from a responsive image", () => {
    document.body.innerHTML = '<img src="/small.png">';
    const image = element("img");
    Object.defineProperty(image, "currentSrc", { value: "http://localhost/large.png" });

    expect(contextImageFromEvent(contextEventOn(image))?.src).toBe("http://localhost/large.png");
  });

  test("looks through empty overlay elements to the image beneath", () => {
    document.body.innerHTML =
      '<div id="wrap"><img src="/art.png"><div id="shield"><span id="inner"></span></div></div>';
    const stack = stackAtPoint("#inner", "#shield", "img", "#wrap");

    expect(contextImageFromEvent(contextEventOn(element("#inner")))).toEqual({
      src: "http://localhost/art.png",
    });
    expect(stack).toHaveBeenCalledWith(10, 20);
  });

  test.each([
    ["text", '<p id="top">Caption</p>'],
    ["a video", '<video id="top"></video>'],
    ["a canvas", '<canvas id="top"></canvas>'],
    ["a custom element", '<x-widget id="top"></x-widget>'],
    ["the Page Sources panel", '<aside id="save-in-source-panel"><i id="top"></i></aside>'],
  ])("does not reach past %s to a backdrop image", (_label, top) => {
    document.body.innerHTML = `<img src="/backdrop.png">${top}`;
    stackAtPoint("body > :not(img)", "img");

    expect(contextImageFromEvent(contextEventOn(element("#top")))).toBeNull();
  });

  test("does not reach past an open shadow host to a backdrop image", () => {
    document.body.innerHTML = '<img src="/backdrop.png"><div id="top"></div>';
    element("#top").attachShadow({ mode: "open" }).innerHTML = "<button>Play</button>";
    stackAtPoint("#top", "img");

    expect(contextImageFromEvent(contextEventOn(element("#top")))).toBeNull();
  });

  test("reports nothing when no image is under the pointer", () => {
    document.body.innerHTML = '<div id="top"></div>';
    stackAtPoint("#top");

    expect(contextImageFromEvent(contextEventOn(element("#top")))).toBeNull();
  });

  test("stops scanning a deep stack", () => {
    document.body.innerHTML = `${'<div class="layer"></div>'.repeat(16)}<img src="/deep.png">`;
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [...document.querySelectorAll(".layer"), element("img")],
    });

    expect(contextImageFromEvent(contextEventOn(element(".layer")))).toBeNull();
  });

  test("ignores an image without a fetchable address", () => {
    document.body.innerHTML = '<img src="data:image/gif;base64,AAAA"><img id="empty">';

    expect(contextImageFromEvent(contextEventOn(element("img")))).toBeNull();
    expect(contextImageFromEvent(contextEventOn(element("#empty")))).toBeNull();
  });

  test("tolerates a host without point lookup or an element target", () => {
    document.body.innerHTML = '<div id="top"></div>';

    expect(contextImageFromEvent(contextEventOn(element("#top")))).toBeNull();
    const detached = new MouseEvent("contextmenu");
    Object.defineProperty(detached, "target", { value: window });
    expect(contextImageFromEvent(detached)).toBeNull();
  });
});
