const { localizeString, localizeDocument } = (await import("../src/options/l10n.js")).default;

describe("l10n", () => {
  beforeEach(() => {
    global.chrome.i18n = {
      getMessage: vi.fn((key) => ({ greeting: "Hello", name: "save-in" })[key] || ""),
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("replaces placeholders in strings", () => {
    expect(localizeString("__MSG_greeting__, __MSG_name__!")).toBe("Hello, save-in!");
  });

  test("keeps unknown placeholders verbatim", () => {
    expect(localizeString("__MSG_missing__")).toBe("__MSG_missing__");
  });

  test("localizes document text nodes and attributes", () => {
    document.body.innerHTML =
      '<p id="t">__MSG_greeting__</p><input id="i" placeholder="__MSG_name__"><span id="plain">untouched</span>';

    localizeDocument();

    expect(document.getElementById("t").textContent).toBe("Hello");
    expect(document.getElementById("i").getAttribute("placeholder")).toBe("save-in");
    expect(document.getElementById("plain").textContent).toBe("untouched");
  });
});
