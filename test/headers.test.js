const RequestHeaders = (await import("../src/headers.js")).default;

describe("matchesRefererFilter", () => {
  beforeEach(() => {
    global.options = {
      setRefererHeaderFilter: "*://i.pximg.net/*",
    };
  });

  test("matches URLs against a single match pattern", () => {
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/img/foo.png")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("http://i.pximg.net/img.jpg")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://example.com/foo.png")).toBe(false);
  });

  test("does not match substrings outside the pattern", () => {
    expect(RequestHeaders.matchesRefererFilter("https://evil.com/?u=https://i.pximg.net/")).toBe(
      false,
    );
  });

  test("supports multiple newline-separated patterns", () => {
    global.options.setRefererHeaderFilter = "*://i.pximg.net/*\n*://example.org/downloads/*";
    expect(RequestHeaders.matchesRefererFilter("https://example.org/downloads/a")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://example.org/other/a")).toBe(false);
  });

  test("escapes regex metacharacters in patterns", () => {
    global.options.setRefererHeaderFilter = "*://a.b/c?d=e*";
    expect(RequestHeaders.matchesRefererFilter("https://a.b/c?d=e&f=g")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://axb/cxd=e")).toBe(false);
  });

  test("handles empty and whitespace-only filters", () => {
    global.options.setRefererHeaderFilter = "";
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    global.options.setRefererHeaderFilter = "\n  \n";
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
  });

  test("ignores patterns that are not match patterns", () => {
    global.options.setRefererHeaderFilter = "not-a-match-pattern";
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
  });

  test("treats patterns whose compilation throws as non-matching", () => {
    const original = RequestHeaders.matchPatternToRegExp;
    RequestHeaders.matchPatternToRegExp = () => {
      throw new Error("boom");
    };
    try {
      expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    } finally {
      RequestHeaders.matchPatternToRegExp = original;
    }
  });
});

describe("matchPatternToRegExp", () => {
  test("returns null for gibberish and unsupported schemes", () => {
    expect(RequestHeaders.matchPatternToRegExp("not-a-match-pattern")).toBe(null);
    expect(RequestHeaders.matchPatternToRegExp("gopher://weird/*")).toBe(null);
  });

  test("keeps explicit schemes", () => {
    const re = RequestHeaders.matchPatternToRegExp("https://example.com/*");
    expect(re.test("https://example.com/a")).toBe(true);
    expect(re.test("http://example.com/a")).toBe(false);
  });

  test("wildcard host matches any host", () => {
    const re = RequestHeaders.matchPatternToRegExp("*://*/download/*");
    expect(re.test("https://anything.example/download/x")).toBe(true);
    expect(re.test("https://anything.example/other/x")).toBe(false);
  });

  test("*.host matches the host and its subdomains", () => {
    const re = RequestHeaders.matchPatternToRegExp("*://*.example.com/*");
    expect(re.test("https://example.com/a")).toBe(true);
    expect(re.test("https://cdn.example.com/a")).toBe(true);
    expect(re.test("https://example.org/a")).toBe(false);
  });
});

describe("refererListener", () => {
  afterEach(() => {
    delete global.globalChromeState;
  });

  test("leaves requests with an existing Referer alone", () => {
    const details = { requestHeaders: [{ name: "Referer", value: "https://already/" }] };
    expect(RequestHeaders.refererListener(details)).toEqual({});
    expect(details.requestHeaders).toHaveLength(1);
  });

  test("does nothing without download state", () => {
    global.globalChromeState = null;
    expect(RequestHeaders.refererListener({ requestHeaders: [] })).toEqual({});

    global.globalChromeState = {};
    expect(RequestHeaders.refererListener({ requestHeaders: [] })).toEqual({});
  });

  test("does nothing without a page URL", () => {
    global.globalChromeState = { info: {} };
    expect(RequestHeaders.refererListener({ requestHeaders: [] })).toEqual({});
  });

  test("appends the page URL as Referer", () => {
    global.globalChromeState = {
      info: { pageUrl: "https://www.pixiv.net/artworks/123" },
    };
    const details = { requestHeaders: [{ name: "Accept", value: "*/*" }] };
    expect(RequestHeaders.refererListener(details)).toEqual({
      requestHeaders: [
        { name: "Accept", value: "*/*" },
        { name: "Referer", value: "https://www.pixiv.net/artworks/123" },
      ],
    });
  });
});

describe("refererListener: redirect & concurrency (requestId keying)", () => {
  afterEach(() => {
    RequestHeaders.refererStates.clear();
    delete global.globalChromeState;
    delete global.Download;
  });

  const refererOf = (details) => {
    RequestHeaders.refererListener(details);
    const h = details.requestHeaders.find((x) => x.name === "Referer");
    return h && h.value;
  };

  test("a redirected leg (same requestId, new URL) keeps the first leg's referer", () => {
    global.Download = {
      pendingStates: new Map([["https://cdn/a.jpg", { info: { pageUrl: "https://pixiv/1" } }]]),
    };
    // first leg matches by URL and binds the state to the requestId
    expect(refererOf({ requestId: "r1", url: "https://cdn/a.jpg", requestHeaders: [] })).toBe(
      "https://pixiv/1",
    );
    // redirect target isn't in pendingStates, but the requestId resolves it
    expect(refererOf({ requestId: "r1", url: "https://signed/xyz?t=1", requestHeaders: [] })).toBe(
      "https://pixiv/1",
    );
  });

  test("concurrent downloads never cross over on their redirect legs", () => {
    global.Download = {
      pendingStates: new Map([
        ["https://cdn/a.jpg", { info: { pageUrl: "https://pixiv/A" } }],
        ["https://cdn/b.jpg", { info: { pageUrl: "https://pixiv/B" } }],
      ]),
    };
    refererOf({ requestId: "ra", url: "https://cdn/a.jpg", requestHeaders: [] });
    refererOf({ requestId: "rb", url: "https://cdn/b.jpg", requestHeaders: [] });
    expect(refererOf({ requestId: "ra", url: "https://x/a2", requestHeaders: [] })).toBe(
      "https://pixiv/A",
    );
    expect(refererOf({ requestId: "rb", url: "https://x/b2", requestHeaders: [] })).toBe(
      "https://pixiv/B",
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
    RequestHeaders.usingBlockingWebRequest = false;
    // Rule ids cycle; reset so each test's first rule uses the base id
    RequestHeaders.refererRuleOffset = 0;

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
    delete global.Log;
    jest.useRealTimers();
  });

  test("creates a session rule setting Referer to the page URL", async () => {
    jest.useFakeTimers();
    await RequestHeaders.prepareReferer(state);

    const { calls } = global.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(1);
    const [rules] = calls[0];
    expect(rules.removeRuleIds).toEqual([RequestHeaders.DNR_REFERER_RULE_ID]);
    expect(rules.addRules[0].action.requestHeaders[0]).toEqual({
      header: "Referer",
      operation: "set",
      value: "https://www.pixiv.net/artworks/123",
    });
    // Scoped to the source host so a same-host signed-URL redirect still matches
    expect(rules.addRules[0].condition).toEqual({ requestDomains: ["i.pximg.net"] });
  });

  test("removes the rule after a delay", async () => {
    jest.useFakeTimers();
    await RequestHeaders.prepareReferer(state);
    jest.runAllTimers();

    const { calls } = global.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(2);
    expect(calls[1][0]).toEqual({
      removeRuleIds: [RequestHeaders.DNR_REFERER_RULE_ID],
    });
  });

  test("no-op when the option is disabled", async () => {
    global.options.setRefererHeader = false;
    await RequestHeaders.prepareReferer(state);
    expect(global.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  test("no-op when URL does not match the filter", async () => {
    await RequestHeaders.prepareReferer({
      info: { url: "https://example.com/a.png", pageUrl: "https://p.example/" },
    });
    expect(global.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  test("no-op when a blocking webRequest listener is registered (Firefox)", async () => {
    global.browser.webRequest = {
      onBeforeSendHeaders: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    };
    RequestHeaders.addRequestListener();
    expect(RequestHeaders.usingBlockingWebRequest).toBe(true);

    await RequestHeaders.prepareReferer(state);
    expect(global.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
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
    RequestHeaders.addRequestListener();
    expect(RequestHeaders.usingBlockingWebRequest).toBe(false);

    jest.useFakeTimers();
    await RequestHeaders.prepareReferer(state);
    expect(global.chrome.declarativeNetRequest.updateSessionRules).toHaveBeenCalled();
  });

  test("no-op without declarativeNetRequest support", async () => {
    global.chrome = {};
    await expect(RequestHeaders.prepareReferer(state)).resolves.toBeUndefined();
  });

  test("logs the session rule when a Log global is present", async () => {
    global.Log = { add: jest.fn() };
    jest.useFakeTimers();

    await RequestHeaders.prepareReferer(state);

    expect(global.Log.add).toHaveBeenCalledWith("referer session rule set", {
      id: RequestHeaders.DNR_REFERER_RULE_ID,
      url: state.info.url,
      referer: state.info.pageUrl,
    });
  });

  test("cycles rule ids so concurrent downloads don't clobber each other", async () => {
    await RequestHeaders.prepareReferer(state);
    await RequestHeaders.prepareReferer(state);

    const ids = global.chrome.declarativeNetRequest.updateSessionRules.mock.calls
      .map((c) => c[0].addRules && c[0].addRules[0].id)
      .filter((id) => id != null);
    expect(ids[0]).toBe(RequestHeaders.DNR_REFERER_RULE_ID);
    expect(ids[1]).toBe(RequestHeaders.DNR_REFERER_RULE_ID + 1);
  });

  test("resolves even when the rule cannot be installed", async () => {
    global.chrome.declarativeNetRequest.updateSessionRules = jest.fn(() =>
      Promise.reject(new Error("no permission")),
    );

    await expect(RequestHeaders.prepareReferer(state)).resolves.toBeUndefined();
  });

  test("swallows failures when removing the rule later", async () => {
    jest.useFakeTimers();
    global.chrome.declarativeNetRequest.updateSessionRules = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error("already gone")));

    await RequestHeaders.prepareReferer(state);
    jest.runAllTimers();
    // let the removal rejection propagate to its .catch
    await Promise.resolve();
    await Promise.resolve();

    expect(global.chrome.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(2);
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
    expect(() => RequestHeaders.addRequestListener()).not.toThrow();
  });

  test("drops empty filter lines instead of registering invalid patterns (#222)", () => {
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "*://i.pximg.net/*\n\n  \n",
    };

    RequestHeaders.addRequestListener();

    const { calls } = global.browser.webRequest.onBeforeSendHeaders.addListener.mock;
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ urls: ["*://i.pximg.net/*"] });
  });

  test("does not register at all for an empty filter (#222)", () => {
    global.options = { setRefererHeader: true, setRefererHeaderFilter: "\n" };

    RequestHeaders.addRequestListener();

    expect(global.browser.webRequest.onBeforeSendHeaders.addListener).not.toHaveBeenCalled();
  });

  test("an invalid pattern must not break startup (#222)", () => {
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "not-a-match-pattern",
    };
    global.browser.webRequest.onBeforeSendHeaders.addListener.mockImplementation(() => {
      throw new Error("Invalid match pattern");
    });

    expect(() => RequestHeaders.addRequestListener()).not.toThrow();
  });

  test("only removes the listener when the option is disabled", () => {
    global.options = { setRefererHeader: false };
    RequestHeaders.usingBlockingWebRequest = true;

    RequestHeaders.addRequestListener();

    expect(global.browser.webRequest.onBeforeSendHeaders.removeListener).toHaveBeenCalled();
    expect(global.browser.webRequest.onBeforeSendHeaders.addListener).not.toHaveBeenCalled();
    expect(RequestHeaders.usingBlockingWebRequest).toBe(false);
  });

  test("treats a missing filter as empty (no registration)", () => {
    global.options = { setRefererHeader: true };

    RequestHeaders.addRequestListener();

    expect(global.browser.webRequest.onBeforeSendHeaders.addListener).not.toHaveBeenCalled();
  });

  test("asks Chrome for extraHeaders", () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options = {
      setRefererHeader: true,
      setRefererHeaderFilter: "*://i.pximg.net/*",
    };

    RequestHeaders.addRequestListener();

    const { calls } = global.browser.webRequest.onBeforeSendHeaders.addListener.mock;
    expect(calls[0][2]).toEqual(["blocking", "requestHeaders", "extraHeaders"]);
  });
});
