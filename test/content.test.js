const ClickToSave = (await import("../src/content/content.js")).default;

describe("findSource", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.elementsFromPoint;
  });

  const event = (target) => ({ target, clientX: 10, clientY: 10 });

  test("finds media directly under the cursor", () => {
    document.body.innerHTML = '<img id="i" src="http://x.test/pic.png">';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), false)).toBe("http://x.test/pic.png");
  });

  test("finds media below an overlay via elementsFromPoint", () => {
    document.body.innerHTML = '<div id="overlay"></div><img id="i" src="http://x.test/pic.png">';
    const overlay = document.getElementById("overlay");
    const img = document.getElementById("i");
    document.elementsFromPoint = jest.fn(() => [overlay, img]);

    expect(ClickToSave.findSource(event(overlay), false)).toBe("http://x.test/pic.png");
  });

  test("falls back to the enclosing link when no media is found (#226)", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), true)).toBe("http://localhost/files/doc.pdf");
  });

  test("does not fall back to links when links are disabled", () => {
    document.body.innerHTML = '<a href="/files/doc.pdf"><span id="s">PDF</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), false)).toBeUndefined();
  });

  test("media wins over an enclosing link", () => {
    document.body.innerHTML = '<a href="/page.html"><img id="i" src="http://x.test/pic.png"></a>';
    const img = document.getElementById("i");

    expect(ClickToSave.findSource(event(img), true)).toBe("http://x.test/pic.png");
  });

  test("ignores non-downloadable link schemes", () => {
    document.body.innerHTML = '<a href="javascript:void(0)"><span id="s">x</span></a>';
    const span = document.getElementById("s");

    expect(ClickToSave.findSource(event(span), true)).toBeUndefined();
  });

  test("returns undefined for plain elements", () => {
    document.body.innerHTML = '<p id="p">text</p>';
    expect(ClickToSave.findSource(event(document.getElementById("p")), true)).toBeUndefined();
  });
});

describe("input helpers", () => {
  test("isKeyboardComboActive requires every combo key to be down", () => {
    expect(ClickToSave.isKeyboardComboActive([18], { 18: true })).toBe(true);
    expect(ClickToSave.isKeyboardComboActive([18, 17], { 18: true })).toBe(false);
    expect(ClickToSave.isKeyboardComboActive([18], {})).toBe(false);
  });

  test("isMouseButtonActive maps buttons bitmask to configured button", () => {
    expect(ClickToSave.isMouseButtonActive("LEFT_CLICK", 1)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("RIGHT_CLICK", 2)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("MIDDLE_CLICK", 4)).toBe(true);
    expect(ClickToSave.isMouseButtonActive("LEFT_CLICK", 2)).toBe(false);
  });
});
