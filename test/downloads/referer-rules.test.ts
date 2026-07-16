import * as RefererRules from "../../src/downloads/referer-rules.ts";
import {
  REFERER_RULE_POOL_SIZE,
  REFERER_SESSION_RULE_ID,
  REFERER_SESSION_RULE_IDS,
} from "../../src/downloads/referer-rules.ts";
import { BROWSERS, setCurrentBrowser } from "../../src/platform/chrome-detector.ts";
import type { RefererProtection } from "../../src/shared/protected-fetch.ts";

const updateSessionRules = () => vi.mocked(chrome.declarativeNetRequest.updateSessionRules);
const firefoxUpdateSessionRules = () => vi.mocked(browser.declarativeNetRequest.updateSessionRules);

beforeEach(() => {
  setCurrentBrowser(BROWSERS.CHROME);
  updateSessionRules().mockReset();
  updateSessionRules().mockResolvedValue();
  firefoxUpdateSessionRules().mockReset();
  firefoxUpdateSessionRules().mockResolvedValue();
});

afterEach(() => {
  setCurrentBrowser(BROWSERS.FIREFOX);
});

test("builds an exact extension-origin GET rule and strips the fragment", () => {
  const rule = RefererRules.buildRule(
    "https://i.pximg.net/img/a+b(1).jpg?size=large#preview",
    "https://www.pixiv.net/artworks/123",
  );

  expect(rule).toEqual({
    id: REFERER_SESSION_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Referer",
          operation: "set",
          value: "https://www.pixiv.net/artworks/123",
        },
      ],
    },
    condition: {
      regexFilter: expect.any(String),
      initiatorDomains: [chrome.runtime.id],
      requestMethods: ["get"],
      resourceTypes: ["xmlhttprequest"],
    },
  });
  const regex = new RegExp(rule.condition.regexFilter!);
  expect(regex.test("https://i.pximg.net/img/a+b(1).jpg?size=large")).toBe(true);
  expect(regex.test("https://i.pximg.net/img/axb1.jpg?size=large")).toBe(false);
  expect(regex.test("https://i.pximg.net/img/a+b(1).jpg?size=large&extra=1")).toBe(false);
});

test("can protect the HEAD and GET requests used by lazy metadata", () => {
  const rule = RefererRules.buildRule("https://cdn.example/file", "https://gallery.example/view", [
    "head",
    "get",
  ]);

  expect(rule.condition.requestMethods).toEqual(["head", "get"]);
});

test("installs the rule only around the protected operation", async () => {
  const operation = vi.fn(async () => "fetched");

  await expect(
    RefererRules.withRequestReferer(
      "https://i.pximg.net/file.jpg",
      "https://www.pixiv.net/artworks/123",
      operation,
    ),
  ).resolves.toBe("fetched");

  expect(operation).toHaveBeenCalledOnce();
  expect(updateSessionRules()).toHaveBeenNthCalledWith(1, {
    removeRuleIds: [REFERER_SESSION_RULE_ID],
    addRules: [
      expect.objectContaining({
        id: REFERER_SESSION_RULE_ID,
        action: expect.objectContaining({
          requestHeaders: [
            expect.objectContaining({ value: "https://www.pixiv.net/artworks/123" }),
          ],
        }),
      }),
    ],
  });
  expect(updateSessionRules()).toHaveBeenNthCalledWith(2, {
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("removes the rule after a failed operation", async () => {
  await expect(
    RefererRules.withRequestReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      () => Promise.reject(new Error("HTTP 403")),
    ),
  ).rejects.toThrow("HTTP 403");

  expect(updateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("does not fail a completed transfer when rule cleanup fails", async () => {
  updateSessionRules().mockResolvedValueOnce().mockRejectedValueOnce(new Error("worker stopped"));

  await expect(
    RefererRules.withRequestReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      async () => "fetched",
    ),
  ).resolves.toBe("fetched");
});

test("protects fetches to distinct URLs in parallel, each with its own pool rule", async () => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];

  const first = RefererRules.withRequestReferer(
    "https://cdn.example/a.jpg",
    "https://gallery.example/a",
    async () => {
      order.push("first-start");
      await firstPending;
      order.push("first-end");
    },
  );
  const second = RefererRules.withRequestReferer(
    "https://cdn.example/b.jpg",
    "https://gallery.example/b",
    async () => {
      order.push("second");
    },
  );

  // The second operation no longer waits for the first: it runs under its own
  // rule ID while the first still holds its slot.
  await vi.waitFor(() => expect(order).toEqual(["first-start", "second"]));
  const installs = updateSessionRules()
    .mock.calls.filter(([update]) => update.addRules)
    .map(([update]) => update.addRules![0]!);
  expect(installs).toHaveLength(2);
  expect(new Set(installs.map((rule) => rule.id)).size).toBe(2);
  expect(installs.map((rule) => rule.action.requestHeaders![0]!.value)).toEqual([
    "https://gallery.example/a",
    "https://gallery.example/b",
  ]);
  releaseFirst();
  await Promise.all([first, second]);

  expect(order).toEqual(["first-start", "second", "first-end"]);
  // Each operation removed exactly its own rule.
  const removals = updateSessionRules().mock.calls.filter(([update]) => !update.addRules);
  expect(removals.map(([update]) => update.removeRuleIds)).toEqual(
    expect.arrayContaining([[installs[0]!.id], [installs[1]!.id]]),
  );
});

test("serializes conflicting operations: same URL with a different Referer waits", async () => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];

  const first = RefererRules.withRequestReferer(
    "https://cdn.example/shared.jpg",
    "https://gallery.example/a",
    async () => {
      order.push("first-start");
      await firstPending;
      order.push("first-end");
    },
  );
  const second = RefererRules.withRequestReferer(
    "https://cdn.example/shared.jpg",
    "https://gallery.example/b",
    async () => {
      order.push("second");
    },
  );

  // One URL must never be covered by two rules carrying different Referers.
  await vi.waitFor(() => expect(order).toEqual(["first-start"]));
  expect(updateSessionRules()).toHaveBeenCalledTimes(1);
  releaseFirst();
  await Promise.all([first, second]);

  expect(order).toEqual(["first-start", "first-end", "second"]);
  expect(updateSessionRules()).toHaveBeenCalledTimes(4);
});

test("the same URL with the same Referer runs concurrently", async () => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];

  const first = RefererRules.withRequestReferer(
    "https://cdn.example/shared.jpg",
    "https://gallery.example/view",
    async () => {
      order.push("first-start");
      await firstPending;
    },
  );
  const second = RefererRules.withRequestReferer(
    "https://cdn.example/shared.jpg",
    "https://gallery.example/view",
    async () => {
      order.push("second");
    },
  );

  // Identical header values: whichever rule wins the DNR tie produces the
  // same request, so there is nothing to serialize.
  await vi.waitFor(() => expect(order).toEqual(["first-start", "second"]));
  releaseFirst();
  await Promise.all([first, second]);
});

test("pool exhaustion queues the next operation until a slot frees", async () => {
  const releases: Array<() => void> = [];
  const started: number[] = [];
  const operations = Array.from({ length: REFERER_RULE_POOL_SIZE + 1 }, (_, index) =>
    RefererRules.withRequestReferer(
      `https://cdn.example/${index}.jpg`,
      "https://gallery.example/view",
      () =>
        new Promise<void>((resolve) => {
          started.push(index);
          releases.push(resolve);
        }),
    ),
  );

  await vi.waitFor(() => expect(started).toHaveLength(REFERER_RULE_POOL_SIZE));
  const installedIds = updateSessionRules()
    .mock.calls.filter(([update]) => update.addRules)
    .map(([update]) => update.addRules![0]!.id);
  expect(new Set(installedIds).size).toBe(REFERER_RULE_POOL_SIZE);
  expect(installedIds.every((id) => REFERER_SESSION_RULE_IDS.includes(id))).toBe(true);
  expect(started).not.toContain(REFERER_RULE_POOL_SIZE);

  releases[0]!();
  await vi.waitFor(() => expect(started).toContain(REFERER_RULE_POOL_SIZE));
  // The freed slot's rule ID is reused by the queued operation.
  const lastInstall = updateSessionRules()
    .mock.calls.filter(([update]) => update.addRules)
    .at(-1)![0].addRules![0]!;
  expect(lastInstall.id).toBe(installedIds[0]);

  for (const release of releases.slice(1)) release();
  await Promise.all(operations);
});

test("a mid-flight extension toward another operation's URL degrades instead of waiting", async () => {
  let releaseHolder!: () => void;
  const holderPending = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  const holder = RefererRules.withRequestReferer(
    "https://cdn.example/held.jpg",
    "https://gallery.example/a",
    () => holderPending,
  );

  let firstAttempt: boolean | undefined;
  let secondAttempt: boolean | undefined;
  const extender = RefererRules.withRequestReferer(
    "https://cdn.example/other.jpg",
    "https://gallery.example/b",
    async (protection) => {
      // Waiting here while both operations hold slots could deadlock two
      // operations extending toward each other, so a conflict refuses.
      firstAttempt = await protection?.extend("https://cdn.example/held.jpg");
      releaseHolder();
      await holder;
      secondAttempt = await protection?.extend("https://cdn.example/held.jpg");
    },
  );
  await extender;

  expect(firstAttempt).toBe(false);
  expect(secondAttempt).toBe(true);
});

test("startup cleanup removes the whole pool's session rules", async () => {
  await RefererRules.cleanupStaleRefererRule();
  // A killed worker can strand any subset of the pool, so recovery clears the
  // entire ID range, not one reserved ID.
  expect(updateSessionRules()).toHaveBeenCalledWith({
    removeRuleIds: [...REFERER_SESSION_RULE_IDS],
  });
  expect(REFERER_SESSION_RULE_IDS).toHaveLength(REFERER_RULE_POOL_SIZE);
  expect(REFERER_SESSION_RULE_IDS[0]).toBe(REFERER_SESSION_RULE_ID);
});

test("worker reset drains protected work before removing the shared rule", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const protectedWork = RefererRules.withRequestReferer(
    "https://cdn.example/reset.jpg",
    "https://gallery.example/reset",
    () => pending,
  );
  let resetFinished = false;
  const reset = RefererRules.resetRefererRules().then(() => {
    resetFinished = true;
  });

  await vi.waitFor(() => expect(updateSessionRules()).toHaveBeenCalledOnce());
  expect(resetFinished).toBe(false);
  release();
  await Promise.all([protectedWork, reset]);

  expect(updateSessionRules()).toHaveBeenCalledTimes(3);
  expect(updateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [...REFERER_SESSION_RULE_IDS],
  });
});

test("worker reset is a no-op when referer rules are unavailable", async () => {
  setCurrentBrowser(BROWSERS.UNKNOWN);

  await RefererRules.resetRefererRules();

  expect(updateSessionRules()).not.toHaveBeenCalled();
  expect(firefoxUpdateSessionRules()).not.toHaveBeenCalled();
});

test("scopes Firefox rules to its moz-extension origin", async () => {
  setCurrentBrowser(BROWSERS.FIREFOX);
  const operation = vi.fn(async () => "native");

  await expect(
    RefererRules.withRequestReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      operation,
    ),
  ).resolves.toBe("native");
  expect(firefoxUpdateSessionRules()).toHaveBeenNthCalledWith(1, {
    removeRuleIds: [REFERER_SESSION_RULE_ID],
    addRules: [
      expect.objectContaining({
        condition: expect.objectContaining({ initiatorDomains: ["save-in-test"] }),
      }),
    ],
  });
  expect(firefoxUpdateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("runs directly and skips stale cleanup on an unsupported host", async () => {
  setCurrentBrowser(BROWSERS.UNKNOWN);
  const operation = vi.fn(async () => "direct");

  expect(RefererRules.canUseRefererRules()).toBe(false);
  await expect(
    RefererRules.withRequestReferer("https://cdn.example/a", "https://example/a", operation),
  ).resolves.toBe("direct");
  await RefererRules.cleanupStaleRefererRule();

  expect(operation).toHaveBeenCalledOnce();
  expect(updateSessionRules()).not.toHaveBeenCalled();
  expect(firefoxUpdateSessionRules()).not.toHaveBeenCalled();
});

test("rejects rules when the extension origin cannot be established", () => {
  const chromeId = chrome.runtime.id;
  Reflect.set(chrome.runtime, "id", "");
  expect(RefererRules.canUseRefererRules()).toBe(false);
  expect(() => RefererRules.buildRule("https://cdn.example/a", "https://example/a")).toThrow(
    "origin is unavailable",
  );
  Reflect.set(chrome.runtime, "id", chromeId);

  setCurrentBrowser(BROWSERS.FIREFOX);
  vi.mocked(browser.runtime.getURL).mockImplementation(() => {
    throw new Error("context invalidated");
  });
  expect(RefererRules.canUseRefererRules()).toBe(false);
  vi.mocked(browser.runtime.getURL).mockImplementation(
    (path) => `moz-extension://save-in-test/${path}`,
  );
});

test("rejects rules on unknown and incomplete extension hosts", () => {
  setCurrentBrowser(BROWSERS.UNKNOWN);
  expect(() => RefererRules.buildRule("https://cdn.example/a", "https://example/a")).toThrow(
    "origin is unavailable",
  );

  setCurrentBrowser(BROWSERS.CHROME);
  const chromeRuntime = chrome.runtime;
  Object.defineProperty(chrome, "runtime", { configurable: true, value: undefined });
  expect(() => RefererRules.buildRule("https://cdn.example/a", "https://example/a")).toThrow(
    "origin is unavailable",
  );
  Object.defineProperty(chrome, "runtime", { configurable: true, value: chromeRuntime });

  setCurrentBrowser(BROWSERS.FIREFOX);
  const firefoxRuntime = browser.runtime;
  Object.defineProperty(browser, "runtime", {
    configurable: true,
    value: { ...firefoxRuntime, getURL: undefined },
  });
  expect(RefererRules.canUseRefererRules()).toBe(false);
  Object.defineProperty(browser, "runtime", { configurable: true, value: firefoxRuntime });

  vi.mocked(browser.runtime.getURL).mockReturnValueOnce("data:text/plain,extension");
  expect(RefererRules.canUseRefererRules()).toBe(false);
});

test("extends the rule to a server-provided redirect target mid-operation", async () => {
  let extendResult: boolean | undefined;

  await RefererRules.withRequestReferer(
    "https://cdn.example/file.jpg#frag",
    "https://gallery.example/view",
    async (protection) => {
      extendResult = await protection?.extend("https://s3.example/bucket/file.jpg?sig=1#frag");
      return "fetched";
    },
    ["head", "get"],
  );

  expect(extendResult).toBe(true);
  // install, extend, remove — the removal must still come last.
  expect(updateSessionRules()).toHaveBeenCalledTimes(3);
  const extended = updateSessionRules().mock.calls[1]![0]!.addRules![0]!;
  expect(extended.id).toBe(REFERER_SESSION_RULE_ID);
  expect(extended.condition!.requestMethods).toEqual(["head", "get"]);
  expect(extended.condition!.initiatorDomains).toEqual([chrome.runtime.id]);
  const regex = new RegExp(extended.condition!.regexFilter!);
  expect(regex.test("https://cdn.example/file.jpg")).toBe(true);
  expect(regex.test("https://s3.example/bucket/file.jpg?sig=1")).toBe(true);
  expect(regex.test("https://s3.example/bucket/file.jpg?sig=1&extra=2")).toBe(false);
  expect(regex.test("https://s3.example/bucket/file.jpgx")).toBe(false);
  expect(updateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("refuses extensions that would weaken or oversize the rule", async () => {
  await RefererRules.withRequestReferer(
    "https://cdn.example/file.jpg",
    "https://gallery.example/view",
    async (protection) => {
      expect(await protection?.extend("https://cdn.example/file.jpg")).toBe(false);
      expect(await protection?.extend("data:text/plain,nope")).toBe(false);
      expect(await protection?.extend("not a url")).toBe(false);
      expect(await protection?.extend(`https://cdn.example/${"a".repeat(2000)}`)).toBe(false);
      // No refused candidate may touch the installed rule.
      expect(updateSessionRules()).toHaveBeenCalledTimes(1);

      expect(await protection?.extend("https://hop1.example/a")).toBe(true);
      expect(await protection?.extend("https://hop1.example/a")).toBe(false);
      expect(await protection?.extend("https://hop2.example/a")).toBe(true);
      expect(await protection?.extend("https://hop3.example/a")).toBe(true);
      expect(await protection?.extend("https://hop4.example/a")).toBe(false);
      expect(updateSessionRules()).toHaveBeenCalledTimes(4);
      return "done";
    },
  );
});

test("degrades to the previous rule when an extension update is rejected", async () => {
  updateSessionRules()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("regexFilter too costly"));
  let extendResult: boolean | undefined;

  await expect(
    RefererRules.withRequestReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      async (protection) => {
        extendResult = await protection?.extend("https://s3.example/file.jpg");
        return "fetched";
      },
    ),
  ).resolves.toBe("fetched");

  expect(extendResult).toBe(false);
  expect(updateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("a leaked extend cannot resurrect the removed rule", async () => {
  let leaked: RefererProtection | undefined;

  await RefererRules.withRequestReferer(
    "https://cdn.example/file.jpg",
    "https://gallery.example/view",
    async (protection) => {
      leaked = protection;
      return "done";
    },
  );

  const settledCalls = updateSessionRules().mock.calls.length;
  await expect(leaked?.extend("https://s3.example/file.jpg")).resolves.toBe(false);
  expect(updateSessionRules().mock.calls.length).toBe(settledCalls);
});

test("passes no protection when the rule cannot be used", async () => {
  setCurrentBrowser(BROWSERS.UNKNOWN);
  const operation = vi.fn(async (protection?: RefererProtection) => protection);

  await expect(
    RefererRules.withRequestReferer("https://cdn.example/a", "https://example/a", operation),
  ).resolves.toBeUndefined();
});

test("falls back safely if DNR disappears after protected work is queued", async () => {
  const dnr = chrome.declarativeNetRequest;
  const cleanup = RefererRules.cleanupStaleRefererRule();
  Object.defineProperty(chrome, "declarativeNetRequest", {
    configurable: true,
    value: undefined,
  });
  await expect(cleanup).resolves.toBeUndefined();
  Object.defineProperty(chrome, "declarativeNetRequest", { configurable: true, value: dnr });

  const operation = vi.fn(async () => "direct");
  const protectedWork = RefererRules.withRequestReferer(
    "https://cdn.example/a",
    "https://example/a",
    operation,
  );
  Object.defineProperty(chrome, "declarativeNetRequest", {
    configurable: true,
    value: undefined,
  });
  await expect(protectedWork).resolves.toBe("direct");
  Object.defineProperty(chrome, "declarativeNetRequest", { configurable: true, value: dnr });
  expect(operation).toHaveBeenCalledOnce();
});
