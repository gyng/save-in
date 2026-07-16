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
      // Without this DNR matches case-insensitively, so the rule would cover
      // more than the exact URL the overlap check reserves.
      isUrlFilterCaseSensitive: true,
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

// The pool hands out the lowest free ID, so a rule whose removal was rejected
// can outlive its operation under a different ID and keep covering its URL with
// the old Referer. The next install must clear it in the same atomic update.
test("sweeps a rule left behind by a rejected cleanup on the next install", async () => {
  const leakedId = REFERER_SESSION_RULE_ID + 1;
  // Only the leaked operation's cleanup fails: a removal carries no addRules.
  updateSessionRules().mockImplementation(async (update) => {
    if (!update.addRules && update.removeRuleIds?.includes(leakedId)) {
      throw new Error("worker stopped");
    }
  });

  // Hold the lowest ID so the leaking operation is forced onto a different one.
  let releaseHolder!: () => void;
  const holderPending = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });
  const holder = RefererRules.withRequestReferer(
    "https://cdn.example/holder.jpg",
    "https://gallery.example/view",
    async () => {
      await holderPending;
      return "holder";
    },
  );
  await Promise.resolve();

  // Takes leakedId, and leaks it when its cleanup rejects.
  await RefererRules.withRequestReferer(
    "https://cdn.example/file.jpg",
    "https://gallery.example/view",
    async () => "leaker",
  );
  releaseHolder();
  await holder;

  updateSessionRules().mockClear();
  updateSessionRules().mockResolvedValue();

  // Same URL, different Referer: it takes the now-lowest free ID, so its own
  // removeRuleIds would not cover the leaked rule still carrying the old value.
  await RefererRules.withRequestReferer(
    "https://cdn.example/file.jpg",
    "https://other.example/view",
    async () => "second",
  );

  const install = updateSessionRules().mock.calls[0]![0]!;
  expect(install.addRules?.[0]?.id).toBe(REFERER_SESSION_RULE_ID);
  expect(install.removeRuleIds).toContain(leakedId);

  // The sweep is not repeated once it has succeeded.
  updateSessionRules().mockClear();
  await RefererRules.withRequestReferer(
    "https://cdn.example/third.jpg",
    "https://gallery.example/view",
    async () => "third",
  );
  expect(updateSessionRules().mock.calls[0]![0]!.removeRuleIds).toEqual([REFERER_SESSION_RULE_ID]);
});

// The pool hands out the lowest free ID, so a leaked ID is the first one
// reissued: the next operation installs its own rule under it. A concurrent
// operation that snapshotted the same leaked ID must not sweep it, or its
// update deletes the live rule and that request goes out with no Referer.
test("a stale sweep leaves a rule a concurrent operation reinstalled alone", async () => {
  const leakedId = REFERER_SESSION_RULE_ID;
  // Only a cleanup rejects: a removal carries no addRules.
  updateSessionRules().mockImplementation(async (update) => {
    if (!update.addRules && update.removeRuleIds?.includes(leakedId)) {
      throw new Error("worker stopped");
    }
  });
  await RefererRules.withRequestReferer(
    "https://cdn.example/leak.jpg",
    "https://gallery.example/view",
    async () => "leaker",
  );

  // Model the session rule store, so the assertion is what the browser would
  // actually be left holding once it applies the updates in the issued order.
  const rules = new Map<number, chrome.declarativeNetRequest.Rule>();
  updateSessionRules().mockImplementation(async (update) => {
    for (const id of update.removeRuleIds ?? []) rules.delete(id);
    for (const rule of update.addRules ?? []) rules.set(rule.id, rule);
  });

  let releaseReuser!: () => void;
  const reuserPending = new Promise<void>((resolve) => {
    releaseReuser = resolve;
  });
  let rulesWhileReuserRan: chrome.declarativeNetRequest.Rule[] = [];
  // Takes the leaked ID back and reinstalls its own rule under it.
  const reuser = RefererRules.withRequestReferer(
    "https://cdn.example/reuser.jpg",
    "https://reuser.example/view",
    async () => {
      rulesWhileReuserRan = [...rules.values()];
      await reuserPending;
      return "reuser";
    },
  );
  // A distinct URL, so it runs concurrently on the next pool ID while holding
  // the same snapshot of the leaked ID.
  await RefererRules.withRequestReferer(
    "https://cdn.example/sweeper.jpg",
    "https://sweeper.example/view",
    async () => "sweeper",
  );
  releaseReuser();
  await expect(reuser).resolves.toBe("reuser");

  const protectingReuser = rulesWhileReuserRan.find((rule) =>
    new RegExp(rule.condition.regexFilter!).test("https://cdn.example/reuser.jpg"),
  );
  expect(protectingReuser?.action.requestHeaders?.[0]?.value).toBe("https://reuser.example/view");
});

// Skipping a stale ID another operation holds assumes that operation has
// replaced the leaked rule under it. While its install is still in flight it
// has not, and if that install is rejected it never will: nothing was added and
// nothing removed. The leak stays live, and the concurrent operation that
// deferred to it has already installed its own rule — so one URL ends up
// covered by two rules with different Referers, and the DNR tie decides which
// one the request carries.
test("sweeps a leaked rule when the operation holding its ID fails to install", async () => {
  const leakedId = REFERER_SESSION_RULE_ID;
  const leakedUrl = "https://cdn.example/contested.jpg";
  const rules = new Map<number, chrome.declarativeNetRequest.Rule>();
  let rejectReinstall: (() => void) | undefined;
  let failInstallsUnderLeakedId = false;
  updateSessionRules().mockImplementation(async (update) => {
    // The cleanup that leaks the rule: a removal carries no addRules.
    if (!update.addRules && update.removeRuleIds?.includes(leakedId)) {
      throw new Error("worker stopped");
    }
    if (failInstallsUnderLeakedId && update.addRules?.some((rule) => rule.id === leakedId)) {
      // Hold the install in flight so the concurrent operation below decides
      // whether to sweep while this ID is still held and still carries a leak.
      await new Promise<void>((resolve) => {
        rejectReinstall = resolve;
      });
      throw new Error("rule store busy");
    }
    for (const id of update.removeRuleIds ?? []) rules.delete(id);
    for (const rule of update.addRules ?? []) rules.set(rule.id, rule);
  });

  // Leaks a live rule covering leakedUrl with its own Referer.
  await RefererRules.withRequestReferer(leakedUrl, "https://gallery.example/view", async () => "a");
  expect(rules.get(leakedId)).toBeDefined();

  // Inherits the leaked ID; its install hangs, then is rejected.
  failInstallsUnderLeakedId = true;
  const reinstaller = RefererRules.withRequestReferer(
    "https://cdn.example/reinstaller.jpg",
    "https://reinstaller.example/view",
    async () => "reinstaller",
  );
  await vi.waitFor(() => expect(rejectReinstall).toBeDefined());

  // Wants the leaked rule's URL under a different Referer, and runs while the
  // leaked ID is held by an install that is about to fail.
  let coveringLeakedUrl: chrome.declarativeNetRequest.Rule[] = [];
  const contender = RefererRules.withRequestReferer(leakedUrl, "https://other.example/view", () => {
    coveringLeakedUrl = [...rules.values()].filter((rule) =>
      new RegExp(rule.condition.regexFilter!).test(leakedUrl),
    );
    return Promise.resolve("contender");
  });
  rejectReinstall?.();
  await expect(reinstaller).resolves.toBe("reinstaller");
  await expect(contender).resolves.toBe("contender");

  const referers = new Set(coveringLeakedUrl.map((rule) => rule.action.requestHeaders?.[0]?.value));
  expect([...referers]).toEqual(["https://other.example/view"]);
});

test("degrades to an unprotected request when the first rule would be oversized", async () => {
  const longUrl = `https://cdn.example/${"a".repeat(2000)}.jpg`;
  updateSessionRules().mockClear();

  await expect(
    RefererRules.withRequestReferer(longUrl, "https://gallery.example/view", async () => "fetched"),
  ).resolves.toBe("fetched");

  // No rule is installed, but the operation still runs rather than throwing.
  expect(updateSessionRules()).not.toHaveBeenCalled();
});

test("degrades to an unprotected request when the first install is rejected", async () => {
  updateSessionRules().mockRejectedValueOnce(new Error("regex program too large"));

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

test("two Referers cannot concurrently extend onto the same redirect URL", async () => {
  let started = 0;
  let releaseBoth!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  const extendShared = async (protection?: RefererProtection): Promise<boolean | undefined> => {
    started += 1;
    if (started === 2) releaseBoth();
    await bothStarted;
    return protection?.extend("https://redirect.example/shared.jpg");
  };

  const results = await Promise.all([
    RefererRules.withRequestReferer(
      "https://cdn.example/a.jpg",
      "https://gallery.example/a",
      extendShared,
    ),
    RefererRules.withRequestReferer(
      "https://cdn.example/b.jpg",
      "https://gallery.example/b",
      extendShared,
    ),
  ]);

  expect(results.filter(Boolean)).toHaveLength(1);
  const coveringRules = updateSessionRules().mock.calls.filter(([update]) =>
    update.addRules?.some((rule) =>
      new RegExp(rule.condition.regexFilter!).test("https://redirect.example/shared.jpg"),
    ),
  );
  expect(coveringRules).toHaveLength(1);
});

test("concurrent extensions on one operation install the cumulative URL set", async () => {
  const firstRedirect = "https://redirect.example/first.jpg";
  const secondRedirect = "https://redirect.example/second.jpg";

  await RefererRules.withRequestReferer(
    "https://cdn.example/original.jpg",
    "https://gallery.example/view",
    async (protection) => {
      await expect(
        Promise.all([protection?.extend(firstRedirect), protection?.extend(secondRedirect)]),
      ).resolves.toEqual([true, true]);
    },
  );

  const finalInstall = updateSessionRules()
    .mock.calls.filter(([update]) => update.addRules)
    .at(-1)![0].addRules![0]!;
  const regex = new RegExp(finalInstall.condition.regexFilter!);
  expect(regex.test(firstRedirect)).toBe(true);
  expect(regex.test(secondRedirect)).toBe(true);
});

test("cleanup drains an unawaited extension queue without installing abandoned URLs", async () => {
  let releaseFirstExtension!: () => void;
  const firstExtensionPending = new Promise<void>((resolve) => {
    releaseFirstExtension = resolve;
  });
  updateSessionRules()
    .mockResolvedValueOnce()
    .mockImplementationOnce(() => firstExtensionPending);
  let firstResult: Promise<boolean> | undefined;
  let abandonedResult: Promise<boolean> | undefined;
  let secondQueued = false;

  const protectedWork = RefererRules.withRequestReferer(
    "https://cdn.example/original.jpg",
    "https://gallery.example/view",
    async (protection) => {
      if (!protection) return;
      firstResult = protection.extend("https://redirect.example/first.jpg");
      await vi.waitFor(() => expect(updateSessionRules()).toHaveBeenCalledTimes(2));
      abandonedResult = protection.extend("https://redirect.example/abandoned.jpg");
      secondQueued = true;
    },
  );

  await vi.waitFor(() => expect(secondQueued).toBe(true));
  releaseFirstExtension();
  await protectedWork;

  await expect(firstResult).resolves.toBe(true);
  await expect(abandonedResult).resolves.toBe(false);
  const installs = updateSessionRules().mock.calls.filter(([update]) => update.addRules);
  expect(installs).toHaveLength(2);
  expect(updateSessionRules()).toHaveBeenLastCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
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
