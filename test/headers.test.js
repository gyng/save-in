const Headers = require("../src/headers.js");

describe("matchesRefererFilter", () => {
  beforeEach(() => {
    global.options = {
      setRefererHeaderFilter: "*://i.pximg.net/*",
    };
  });

  test("matches URLs against a single match pattern", () => {
    expect(
      Headers.matchesRefererFilter("https://i.pximg.net/img/foo.png")
    ).toBe(true);
    expect(Headers.matchesRefererFilter("http://i.pximg.net/img.jpg")).toBe(
      true
    );
    expect(Headers.matchesRefererFilter("https://example.com/foo.png")).toBe(
      false
    );
  });

  test("does not match substrings outside the pattern", () => {
    expect(
      Headers.matchesRefererFilter("https://evil.com/?u=https://i.pximg.net/")
    ).toBe(false);
  });

  test("supports multiple newline-separated patterns", () => {
    global.options.setRefererHeaderFilter =
      "*://i.pximg.net/*\n*://example.org/downloads/*";
    expect(
      Headers.matchesRefererFilter("https://example.org/downloads/a")
    ).toBe(true);
    expect(Headers.matchesRefererFilter("https://example.org/other/a")).toBe(
      false
    );
  });

  test("escapes regex metacharacters in patterns", () => {
    global.options.setRefererHeaderFilter = "*://a.b/c?d=e*";
    expect(Headers.matchesRefererFilter("https://a.b/c?d=e&f=g")).toBe(true);
    expect(Headers.matchesRefererFilter("https://axb/cxd=e")).toBe(false);
  });

  test("handles empty and whitespace-only filters", () => {
    global.options.setRefererHeaderFilter = "";
    expect(Headers.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(
      false
    );
    global.options.setRefererHeaderFilter = "\n  \n";
    expect(Headers.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(
      false
    );
  });
});

describe("prepareReferer (MV3 declarativeNetRequest path)", () => {
  const state = {
    info: {
      url: "https://i.pximg.net/img/foo.png",
      pageUrl: "https://www.pixiv.net/artworks/123",
    },
  };

  let originalWebRequest;
  let originalChrome;

  beforeEach(() => {
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "*://i.pximg.net/*",
    };
    global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
    global.CURRENT_BROWSER = "FIREFOX";
    Headers.usingBlockingWebRequest = false;

    // Simulate MV3: no blocking webRequest, DNR available
    originalWebRequest = global.browser.webRequest;
    global.browser.webRequest = undefined;

    originalChrome = global.chrome;
    global.chrome = {
      declarativeNetRequest: {
        updateSessionRules: jest.fn(() => Promise.resolve()),
      },
    };
  });

  afterEach(() => {
    global.browser.webRequest = originalWebRequest;
    global.chrome = originalChrome;
    jest.useRealTimers();
  });

  test("creates a session rule setting Referer to the page URL", async () => {
    jest.useFakeTimers();
    await Headers.prepareReferer(state);

    const { calls } =
      global.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(1);
    const [rules] = calls[0];
    expect(rules.removeRuleIds).toEqual([Headers.DNR_REFERER_RULE_ID]);
    expect(rules.addRules[0].action.requestHeaders[0]).toEqual({
      header: "Referer",
      operation: "set",
      value: "https://www.pixiv.net/artworks/123",
    });
    expect(rules.addRules[0].condition.urlFilter).toBe(
      "https://i.pximg.net/img/foo.png"
    );
  });

  test("removes the rule after a delay", async () => {
    jest.useFakeTimers();
    await Headers.prepareReferer(state);
    jest.runAllTimers();

    const { calls } =
      global.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(2);
    expect(calls[1][0]).toEqual({
      removeRuleIds: [Headers.DNR_REFERER_RULE_ID],
    });
  });

  test("no-op when the option is disabled", async () => {
    global.options.setRefererHeader = false;
    await Headers.prepareReferer(state);
    expect(
      global.chrome.declarativeNetRequest.updateSessionRules
    ).not.toHaveBeenCalled();
  });

  test("no-op when URL does not match the filter", async () => {
    await Headers.prepareReferer({
      info: { url: "https://example.com/a.png", pageUrl: "https://p.example/" },
    });
    expect(
      global.chrome.declarativeNetRequest.updateSessionRules
    ).not.toHaveBeenCalled();
  });

  test("no-op when a blocking webRequest listener is registered (Firefox)", async () => {
    global.browser.webRequest = {
      onBeforeSendHeaders: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    };
    Headers.addRequestListener();
    expect(Headers.usingBlockingWebRequest).toBe(true);

    await Headers.prepareReferer(state);
    expect(
      global.chrome.declarativeNetRequest.updateSessionRules
    ).not.toHaveBeenCalled();
  });

  test("falls back to DNR when blocking registration is rejected (Chrome MV3)", async () => {
    // Chrome MV3 exposes webRequest but throws on the "blocking" option
    global.browser.webRequest = {
      onBeforeSendHeaders: {
        addListener: jest.fn(() => {
          throw new Error("blocking requires webRequestBlocking");
        }),
        removeListener: jest.fn(),
      },
    };
    Headers.addRequestListener();
    expect(Headers.usingBlockingWebRequest).toBe(false);

    jest.useFakeTimers();
    await Headers.prepareReferer(state);
    expect(
      global.chrome.declarativeNetRequest.updateSessionRules
    ).toHaveBeenCalled();
  });

  test("no-op without declarativeNetRequest support", async () => {
    global.chrome = {};
    await expect(Headers.prepareReferer(state)).resolves.toBeUndefined();
  });
});

describe("addRequestListener", () => {
  let originalWebRequest;

  beforeEach(() => {
    global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
    global.CURRENT_BROWSER = "FIREFOX";
    originalWebRequest = global.browser.webRequest;
    global.browser.webRequest = {
      onBeforeSendHeaders: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    };
  });

  afterEach(() => {
    global.browser.webRequest = originalWebRequest;
  });

  test("returns early when webRequest is unavailable (MV3)", () => {
    global.options = { setRefererHeader: true };
    global.browser.webRequest = undefined;
    expect(() => Headers.addRequestListener()).not.toThrow();
  });

  test("drops empty filter lines instead of registering invalid patterns (#222)", () => {
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "*://i.pximg.net/*\n\n  \n",
    };

    Headers.addRequestListener();

    const { calls } =
      global.browser.webRequest.onBeforeSendHeaders.addListener.mock;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ urls: ["*://i.pximg.net/*"] });
  });

  test("does not register at all for an empty filter (#222)", () => {
    global.options = { setRefererHeader: true, setRefererHeaderFilter: "\n" };

    Headers.addRequestListener();

    expect(
      global.browser.webRequest.onBeforeSendHeaders.addListener
    ).not.toHaveBeenCalled();
  });

  test("an invalid pattern must not break startup (#222)", () => {
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "not-a-match-pattern",
    };
    global.browser.webRequest.onBeforeSendHeaders.addListener.mockImplementation(
      () => {
        throw new Error("Invalid match pattern");
      }
    );

    expect(() => Headers.addRequestListener()).not.toThrow();
  });
});
