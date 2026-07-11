// option.ts/log.ts are import-side-effect-free (Task #2: the option seed is
// deferred out of module eval), so import the real `options` bag and `Log` and
// drive them directly — options via setOptions() below, Log.add via a spy. Only
// `chrome` still needs the untyped-global view: it is a genuine ambient global
// from @types/chrome, too strictly typed to assign a partial stub to.
import { options } from "../src/config/options-data.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import { Log } from "../src/background/log.ts";
import { RequestHeaders } from "../src/downloads/headers.ts";

const g: any = global;

const setOptions = (overrides: Partial<SaveInOptions> = {}) => {
  const mutableOptions = options as unknown as Record<string, unknown>;
  for (const key of Object.keys(mutableOptions)) delete mutableOptions[key];
  Object.assign(mutableOptions, overrides);
};

describe("matchesRefererFilter", () => {
  beforeEach(() => {
    setOptions({ setRefererHeaderFilter: "*://i.pximg.net/*" });
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
    options.setRefererHeaderFilter = "*://i.pximg.net/*\n*://example.org/downloads/*";
    expect(RequestHeaders.matchesRefererFilter("https://example.org/downloads/a")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://example.org/other/a")).toBe(false);
  });

  test("escapes regex metacharacters in patterns", () => {
    options.setRefererHeaderFilter = "*://a.b/c?d=e*";
    expect(RequestHeaders.matchesRefererFilter("https://a.b/c?d=e&f=g")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://axb/cxd=e")).toBe(false);
  });

  test("handles empty and whitespace-only filters", () => {
    options.setRefererHeaderFilter = "";
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    options.setRefererHeaderFilter = "\n  \n";
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
  });

  test("ignores patterns that are not match patterns", () => {
    options.setRefererHeaderFilter = "not-a-match-pattern";
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
    if (!re) throw new Error("Valid match pattern did not compile");
    expect(re.test("https://example.com/a")).toBe(true);
    expect(re.test("http://example.com/a")).toBe(false);
  });

  test("wildcard host matches any host", () => {
    const re = RequestHeaders.matchPatternToRegExp("*://*/download/*");
    if (!re) throw new Error("Valid match pattern did not compile");
    expect(re.test("https://anything.example/download/x")).toBe(true);
    expect(re.test("https://anything.example/other/x")).toBe(false);
  });

  test("*.host matches the host and its subdomains", () => {
    const re = RequestHeaders.matchPatternToRegExp("*://*.example.com/*");
    if (!re) throw new Error("Valid match pattern did not compile");
    expect(re.test("https://example.com/a")).toBe(true);
    expect(re.test("https://cdn.example.com/a")).toBe(true);
    expect(re.test("https://example.org/a")).toBe(false);
  });
});

// Both browsers set the Referer via a declarativeNetRequest session rule
// (Firefox and Chrome MV3 both support DNR modifyHeaders for it), so there is
// no blocking-webRequest path to test.
describe("prepareReferer (declarativeNetRequest path)", () => {
  const state = {
    info: {
      url: "https://i.pximg.net/img/foo.png",
      pageUrl: "https://www.pixiv.net/artworks/123",
    },
  };

  let originalChrome: unknown;

  beforeEach(() => {
    setOptions({ setRefererHeader: true, setRefererHeaderFilter: "*://i.pximg.net/*" });
    // Log is always defined now (real import); spy it so its calls are absorbed
    // (and assertable) instead of writing to the session log.
    vi.spyOn(Log, "add").mockImplementation(() => Promise.resolve());
    // Rule ids cycle; reset so each test's first rule uses the base id
    RequestHeaders.refererRuleOffset = 0;

    originalChrome = g.chrome;
    g.chrome = {
      declarativeNetRequest: {
        updateSessionRules: jest.fn(() => Promise.resolve()),
      },
    };
  });

  afterEach(() => {
    g.chrome = originalChrome;
    vi.restoreAllMocks();
    jest.useRealTimers();
  });

  test("creates a session rule setting Referer to the page URL", async () => {
    jest.useFakeTimers();
    const originalId = global.browser.runtime.id;
    Object.defineProperty(global.browser.runtime, "id", { value: "save-in", configurable: true });
    await RequestHeaders.prepareReferer(state);

    const { calls } = g.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(1);
    const [rules] = calls[0];
    expect(rules.removeRuleIds).toEqual([RequestHeaders.DNR_REFERER_RULE_ID]);
    expect(rules.addRules[0].action.requestHeaders[0]).toEqual({
      header: "Referer",
      operation: "set",
      value: "https://www.pixiv.net/artworks/123",
    });
    // Scoped to the source host so a same-host signed-URL redirect still matches
    expect(rules.addRules[0].condition).toEqual({
      requestDomains: ["i.pximg.net"],
      initiatorDomains: ["save-in"],
    });
    Object.defineProperty(global.browser.runtime, "id", {
      value: originalId,
      configurable: true,
    });
  });

  test("removes the rule after a delay", async () => {
    jest.useFakeTimers();
    await RequestHeaders.prepareReferer(state);
    jest.runAllTimers();

    const { calls } = g.chrome.declarativeNetRequest.updateSessionRules.mock;
    expect(calls.length).toBe(2);
    expect(calls[1][0]).toEqual({
      removeRuleIds: [RequestHeaders.DNR_REFERER_RULE_ID],
    });
  });

  test("no-op when the option is disabled", async () => {
    options.setRefererHeader = false;
    await RequestHeaders.prepareReferer(state);
    expect(g.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  test("no-op when URL does not match the filter", async () => {
    await RequestHeaders.prepareReferer({
      info: { url: "https://example.com/a.png", pageUrl: "https://p.example/" },
    });
    expect(g.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  test("no-op without declarativeNetRequest support", async () => {
    g.chrome = {};
    await expect(RequestHeaders.prepareReferer(state)).resolves.toBeUndefined();
  });

  test("logs the session rule", async () => {
    jest.useFakeTimers();

    await RequestHeaders.prepareReferer(state);

    expect(Log.add).toHaveBeenCalledWith("referer session rule set", {
      id: RequestHeaders.DNR_REFERER_RULE_ID,
      url: state.info.url,
      referer: state.info.pageUrl,
    });
  });

  test("cycles rule ids so concurrent downloads don't clobber each other", async () => {
    await RequestHeaders.prepareReferer(state);
    await RequestHeaders.prepareReferer(state);

    const ids = g.chrome.declarativeNetRequest.updateSessionRules.mock.calls
      .map((c: any) => c[0].addRules && c[0].addRules[0].id)
      .filter((id: unknown): id is number => typeof id === "number");
    expect(ids[0]).toBe(RequestHeaders.DNR_REFERER_RULE_ID);
    expect(ids[1]).toBe(RequestHeaders.DNR_REFERER_RULE_ID + 1);
  });

  test("resolves even when the rule cannot be installed", async () => {
    // Not spied on — this stub is never inspected via .mock, only relied on
    // for its rejection, so a plain function suffices
    g.chrome.declarativeNetRequest.updateSessionRules = () =>
      Promise.reject(new Error("no permission"));

    await expect(RequestHeaders.prepareReferer(state)).resolves.toBeUndefined();
  });

  test("swallows failures when removing the rule later", async () => {
    jest.useFakeTimers();
    g.chrome.declarativeNetRequest.updateSessionRules = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new Error("already gone")));

    await RequestHeaders.prepareReferer(state);
    jest.runAllTimers();
    // let the removal rejection propagate to its .catch
    await Promise.resolve();
    await Promise.resolve();

    expect(g.chrome.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(2);
  });
});
