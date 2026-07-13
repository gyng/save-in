import {
  ChromeRefererRules,
  REFERER_SESSION_RULE_ID,
} from "../src/downloads/chrome-referer-rules.ts";
import { BROWSERS, setCurrentBrowser } from "../src/platform/chrome-detector.ts";

const updateSessionRules = () => vi.mocked(chrome.declarativeNetRequest.updateSessionRules);

beforeEach(() => {
  setCurrentBrowser(BROWSERS.CHROME);
  updateSessionRules().mockReset();
  updateSessionRules().mockResolvedValue();
});

afterEach(() => {
  setCurrentBrowser(BROWSERS.FIREFOX);
});

test("builds an exact extension-origin GET rule and strips the fragment", () => {
  const rule = ChromeRefererRules.buildRule(
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

test("installs the rule only around the protected operation", async () => {
  const operation = vi.fn(async () => "fetched");

  await expect(
    ChromeRefererRules.withReferer(
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
    ChromeRefererRules.withReferer(
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
    ChromeRefererRules.withReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      async () => "fetched",
    ),
  ).resolves.toBe("fetched");
});

test("serializes protected fetches so the shared rule cannot change mid-request", async () => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];

  const first = ChromeRefererRules.withReferer(
    "https://cdn.example/a.jpg",
    "https://gallery.example/a",
    async () => {
      order.push("first-start");
      await firstPending;
      order.push("first-end");
    },
  );
  const second = ChromeRefererRules.withReferer(
    "https://cdn.example/b.jpg",
    "https://gallery.example/b",
    async () => {
      order.push("second");
    },
  );

  await vi.waitFor(() => expect(order).toEqual(["first-start"]));
  expect(updateSessionRules()).toHaveBeenCalledTimes(1);
  releaseFirst();
  await Promise.all([first, second]);

  expect(order).toEqual(["first-start", "first-end", "second"]);
  expect(updateSessionRules()).toHaveBeenCalledTimes(4);
});

test("startup cleanup removes the reserved session rule", async () => {
  await ChromeRefererRules.cleanupStaleRule();
  expect(updateSessionRules()).toHaveBeenCalledWith({
    removeRuleIds: [REFERER_SESSION_RULE_ID],
  });
});

test("does not touch DNR on Firefox", async () => {
  setCurrentBrowser(BROWSERS.FIREFOX);
  const operation = vi.fn(async () => "native");

  await expect(
    ChromeRefererRules.withReferer(
      "https://cdn.example/file.jpg",
      "https://gallery.example/view",
      operation,
    ),
  ).resolves.toBe("native");
  expect(updateSessionRules()).not.toHaveBeenCalled();
});
