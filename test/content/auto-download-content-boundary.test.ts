// @vitest-environment jsdom
const fixture = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>> }));

vi.mock("../../src/content/source-panel-model.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/content/source-panel-model.ts")>()),
  collectPageSourceCandidates: () => fixture.candidates,
}));

import {
  createAutoDownloadDedup,
  setupAutoDownloadDiscovery as rawSetupAutoDownloadDiscovery,
  type AutoDownloadDiscoveryOptions,
} from "../../src/content/auto-download.ts";
import type { AutomaticRoutingCandidate } from "../../src/automation/automatic-routing.ts";
import { matchAutomaticRoutingRule } from "../../src/automation/automatic-routing.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";

type DefaultedOption =
  | "includeLinks"
  | "includeDocuments"
  | "includeBackgrounds"
  | "resourceHints"
  | "includeDataUrls"
  | "isPageDisabled";

const setupAutoDownloadDiscovery = (
  options: Omit<AutoDownloadDiscoveryOptions, DefaultedOption> &
    Partial<Pick<AutoDownloadDiscoveryOptions, DefaultedOption>>,
) =>
  rawSetupAutoDownloadDiscovery({
    includeLinks: false,
    includeDocuments: false,
    includeBackgrounds: false,
    resourceHints: false,
    includeDataUrls: false,
    isPageDisabled: () => false,
    ...options,
  });

const rules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
sourceurl: cdn\.test
into: automatic/
`;

// No sourcekind matcher, so this rule isolates the scan's media-kind filter from
// rule matching: every candidate URL matches, and only the kind gate decides.
const anyMediaRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourceurl: cdn\.test
into: automatic/
`;

const cssRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
css: article img
css: img:not(.avatar)
into: automatic/
`;

beforeEach(() => {
  fixture.candidates = [];
});

test("filters non-previewable and malformed collector results at the discovery boundary", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/hidden.png", kind: "image", previewable: false },
    { url: "http://[", kind: "image", previewable: true },
    { url: "https://cdn.test/visible.png#preview", kind: "image", previewable: true },
  ];
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(async () =>
    Promise.resolve("started"),
  );
  const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 10, send });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ sourceUrl: "https://cdn.test/visible.png" }),
  );
  controller.stop();
});

test("resolves exclusions locally without consuming a save slot or background message", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/tracker.gif", kind: "image", previewable: true },
    { url: "https://cdn.test/photo.jpg", kind: "image", previewable: true },
  ];
  const exclusionRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourceurl: tracker\.gif$
exclude: true

context: ^auto$
pageurl: ^http://localhost/
sourceurl: cdn\.test
into: automatic/
`;
  const dedup = createAutoDownloadDedup();
  const onLimitReached = vi.fn();
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: exclusionRules,
    live: false,
    maxPerPage: 1,
    send,
    dedup,
    onLimitReached,
  });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ sourceUrl: "https://cdn.test/photo.jpg" }),
  );
  expect(dedup.seen.size).toBe(1);
  expect(dedup.excluded?.size).toBe(1);
  expect(onLimitReached).not.toHaveBeenCalled();

  controller.scan();
  await controller.idle();
  expect(send).toHaveBeenCalledOnce();
  controller.stop();
});

test("re-evaluates page-scoped exclusions after same-document navigation", async () => {
  fixture.candidates = [{ url: "https://cdn.test/photo.jpg", kind: "image", previewable: true }];
  const pageRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/$
sourceurl: photo\.jpg$
exclude: true

context: ^auto$
pageurl: ^http://localhost/other$
sourceurl: photo\.jpg$
into: automatic/
`;
  const dedup = createAutoDownloadDedup();
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: pageRules,
    live: false,
    maxPerPage: 10,
    send,
    dedup,
  });
  await controller.idle();
  expect(send).not.toHaveBeenCalled();

  history.pushState({}, "", "/other");
  controller.scan();
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  controller.stop();
  history.replaceState({}, "", "/");
});

test("bounds the page-local exclusion cache without churning stable entries", async () => {
  fixture.candidates = Array.from({ length: 1025 }, (_value, index) => ({
    url: `https://cdn.test/excluded-${index}.jpg`,
    kind: "image",
    previewable: true,
  }));
  const dedup = createAutoDownloadDedup();
  const controller = setupAutoDownloadDiscovery({
    rules: String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourceurl: excluded-
exclude: true
`,
    live: false,
    maxPerPage: 10,
    send: vi.fn(async () => "started" as const),
    dedup,
  });
  await controller.idle();

  expect(dedup.excluded?.size).toBe(1024);
  expect(dedup.excluded?.has("https://cdn.test/excluded-0.jpg")).toBe(true);
  expect(dedup.excluded?.has("https://cdn.test/excluded-1024.jpg")).toBe(false);

  controller.scan();
  await controller.idle();

  expect(dedup.excluded?.size).toBe(1024);
  expect(dedup.excluded?.has("https://cdn.test/excluded-0.jpg")).toBe(true);
  expect(dedup.excluded?.has("https://cdn.test/excluded-1024.jpg")).toBe(false);
  controller.stop();
});

test("attests selectors per origin and only queues a complete same-element CSS match", async () => {
  const article = document.createElement("article");
  const hero = document.createElement("img");
  article.append(hero);
  const avatar = document.createElement("img");
  avatar.className = "avatar";
  fixture.candidates = [
    { url: "https://cdn.test/avatar.png", kind: "image", element: avatar },
    { url: "https://cdn.test/hero.png", kind: "image", element: hero },
  ];
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(async () =>
    Promise.resolve("started"),
  );
  const controller = setupAutoDownloadDiscovery({
    rules: cssRules,
    live: false,
    maxPerPage: 10,
    send,
  });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceUrl: "https://cdn.test/hero.png",
      matchedCssSelectorsByOrigin: [["article img", "img:not(.avatar)"]],
    }),
  );
  controller.stop();
});

test("preserves rule order when duplicate URLs have different matching origins", async () => {
  const article = document.createElement("article");
  const articleImage = document.createElement("img");
  article.append(articleImage);
  const aside = document.createElement("aside");
  const avatar = document.createElement("img");
  avatar.className = "avatar";
  aside.append(avatar);
  fixture.candidates = [
    { url: "https://cdn.test/shared.png", kind: "image", element: articleImage },
    { url: "https://cdn.test/shared.png", kind: "image", element: avatar },
  ];
  const orderedRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
css: aside img.avatar
into: first/

context: ^auto$
pageurl: ^http://localhost/
css: article img
into: second/
`;
  const parsed = parseRulesCollecting(orderedRules);
  const destinations: Array<string | null | undefined> = [];
  const send = vi.fn(async (candidate: AutomaticRoutingCandidate) => {
    destinations.push(matchAutomaticRoutingRule(parsed.rules, candidate)?.destination);
    return "started" as const;
  });
  const controller = setupAutoDownloadDiscovery({
    rules: orderedRules,
    live: false,
    maxPerPage: 10,
    send,
  });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      matchedCssSelectorsByOrigin: [["aside img.avatar"], ["article img"]],
    }),
  );
  expect(destinations).toEqual(["first/"]);
  controller.stop();
});

test("does not lose a later matching rule when one origin matches more than 64 selectors", async () => {
  const image = document.createElement("img");
  image.className = Array.from({ length: 65 }, (_value, index) => `selector-${index}`).join(" ");
  fixture.candidates = [{ url: "https://cdn.test/dense.png", kind: "image", element: image }];
  const denseRules = Array.from({ length: 65 }, (_value, index) =>
    [
      "context: ^auto$",
      `pageurl: ${index === 64 ? "^http://localhost/$" : "^https://never\\.test/$"}`,
      `css: .selector-${index}`,
      `into: rule-${index}/`,
    ].join("\n"),
  ).join("\n\n");
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(async () =>
    Promise.resolve("started"),
  );
  const controller = setupAutoDownloadDiscovery({
    rules: denseRules,
    live: false,
    maxPerPage: 10,
    send,
  });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0].matchedCssSelectorsByOrigin).toContainEqual([".selector-64"]);
  controller.stop();
});

test("preserves rule order across duplicate URL variants with different source kinds", async () => {
  const image = document.createElement("img");
  image.className = "image-origin";
  const video = document.createElement("video");
  video.className = "video-origin";
  fixture.candidates = [
    { url: "https://cdn.test/shared.bin", kind: "image", element: image },
    { url: "https://cdn.test/shared.bin", kind: "video", element: video },
  ];
  const variantRules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourcekind: ^video$
css: .video-origin
into: first-video/

context: ^auto$
pageurl: ^http://localhost/
sourcekind: ^image$
css: .image-origin
into: second-image/
`;
  const parsed = parseRulesCollecting(variantRules);
  const destinations: Array<string | null | undefined> = [];
  const send = vi.fn(async (candidate: AutomaticRoutingCandidate) => {
    destinations.push(matchAutomaticRoutingRule(parsed.rules, candidate)?.destination);
    return "started" as const;
  });
  const controller = setupAutoDownloadDiscovery({
    rules: variantRules,
    live: false,
    maxPerPage: 10,
    send,
  });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ sourceKind: "video", sourceUrl: "https://cdn.test/shared.bin" }),
  );
  expect(destinations).toEqual(["first-video/"]);
  controller.stop();
});

test("keeps only media-kind candidates and drops stream, document, and plain links", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/photo.jpg", kind: "image", previewable: true },
    { url: "https://cdn.test/clip.mp4", kind: "video", previewable: true },
    { url: "https://cdn.test/song.mp3", kind: "audio", previewable: true },
    { url: "https://cdn.test/playlist.m3u8", kind: "stream", previewable: true },
    { url: "https://cdn.test/paper.pdf", kind: "document", previewable: true },
    { url: "https://cdn.test/page.html", kind: "link", previewable: true },
  ];
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(
    async () => "started",
  );
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 10,
    send,
  });
  await controller.idle();

  expect(send.mock.calls.map(([candidate]) => candidate.sourceUrl)).toEqual([
    "https://cdn.test/photo.jpg",
    "https://cdn.test/clip.mp4",
    "https://cdn.test/song.mp3",
  ]);
  controller.stop();
});

test.each([
  ["anchor", "stream", "includeDocuments", { includeDocuments: true }],
  ["anchor", "document", "includeDocuments", { includeDocuments: true }],
  ["anchor", "image", "includeLinks", { includeLinks: true }],
  ["anchor", "video", "includeLinks", { includeLinks: true }],
  ["anchor", "audio", "includeLinks", { includeLinks: true }],
  ["background", "image", "includeBackgrounds", { includeBackgrounds: true }],
  ["resource-hint", "stream", "resourceHints", { resourceHints: true }],
] as const)(
  "adopts a %s %s candidate only when %s is on",
  async (channel, kind, _optionName, enabling) => {
    fixture.candidates = [{ url: "https://cdn.test/candidate", kind, channel, previewable: true }];
    const send = vi.fn(async () => "started" as const);
    const off = setupAutoDownloadDiscovery({
      rules: anyMediaRules,
      live: false,
      maxPerPage: 10,
      send,
    });
    await off.idle();
    expect(send).not.toHaveBeenCalled();
    off.stop();

    const send2 = vi.fn(async () => "started" as const);
    const on = setupAutoDownloadDiscovery({
      rules: anyMediaRules,
      live: false,
      maxPerPage: 10,
      send: send2,
      ...enabling,
    });
    await on.idle();
    expect(send2).toHaveBeenCalledOnce();
    on.stop();
  },
);

test("a send force-skipped at teardown returns its dedup slot", async () => {
  fixture.candidates = [{ url: "https://cdn.test/inflight.png", kind: "image", previewable: true }];
  const dedup = createAutoDownloadDedup();
  let resolveSend!: (result: "skipped") => void;
  const send = vi.fn(
    () =>
      new Promise<"skipped">((resolve) => {
        resolveSend = resolve;
      }),
  );
  const controller = setupAutoDownloadDiscovery({
    rules,
    live: false,
    maxPerPage: 10,
    send,
    dedup,
  });
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(dedup.seen.size).toBe(1);

  // Teardown force-skips the in-flight delivery; the shifted candidate never
  // reached a download, so its slot must return like the still-queued ones,
  // or a disable-list-only remount's rescan would skip it forever.
  controller.stop();
  resolveSend("skipped");
  await vi.waitFor(() => expect(dedup.seen.size).toBe(0));
});

test("a plain link anchor is never adopted, even with every channel enabled", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/page.html", kind: "link", channel: "anchor", previewable: true },
  ];
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 10,
    includeLinks: true,
    includeDocuments: true,
    includeBackgrounds: true,
    resourceHints: true,
    send,
  });
  await controller.idle();
  expect(send).not.toHaveBeenCalled();
  controller.stop();
});

test("a .m3u8 anchor is not adopted merely because the manifests option is on", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/playlist.m3u8", kind: "stream", channel: "anchor", previewable: true },
  ];
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 10,
    resourceHints: true,
    send,
  });
  await controller.idle();
  expect(send).not.toHaveBeenCalled();
  controller.stop();
});

test("a resource-hint stream is not adopted merely because linked documents/streams is on", async () => {
  fixture.candidates = [
    {
      url: "https://cdn.test/playlist.m3u8",
      kind: "stream",
      channel: "resource-hint",
      previewable: true,
    },
  ];
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 10,
    includeDocuments: true,
    send,
  });
  await controller.idle();
  expect(send).not.toHaveBeenCalled();
  controller.stop();
});

test("an image anchor is not adopted merely because includeBackgrounds is on", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/linked.jpg", kind: "image", channel: "anchor", previewable: true },
  ];
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 10,
    includeBackgrounds: true,
    send,
  });
  await controller.idle();
  expect(send).not.toHaveBeenCalled();
  controller.stop();
});

test("applies the per-page limit to a background candidate like any other channel", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/skip.png", kind: "image", channel: "background", previewable: true },
    { url: "https://cdn.test/first.jpg", kind: "image", previewable: true },
  ];
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(
    async () => "started",
  );
  const onLimitReached = vi.fn();
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 1,
    includeBackgrounds: true,
    send,
    onLimitReached,
  });
  await controller.idle();

  expect(send.mock.calls.map(([candidate]) => candidate.sourceUrl)).toEqual([
    "https://cdn.test/skip.png",
  ]);
  expect(onLimitReached).toHaveBeenCalledOnce();
  controller.stop();
});

test("applies the per-page limit after the media-kind filter", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/skip.pdf", kind: "document", previewable: true },
    { url: "https://cdn.test/first.jpg", kind: "image", previewable: true },
    { url: "https://cdn.test/second.mp4", kind: "video", previewable: true },
  ];
  const send = vi.fn<(candidate: AutomaticRoutingCandidate) => Promise<"started">>(
    async () => "started",
  );
  const onLimitReached = vi.fn();
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 1,
    send,
    onLimitReached,
  });
  await controller.idle();

  // The dropped document must not consume the single per-page slot.
  expect(send.mock.calls.map(([candidate]) => candidate.sourceUrl)).toEqual([
    "https://cdn.test/first.jpg",
  ]);
  expect(onLimitReached).toHaveBeenCalledOnce();
  controller.stop();
});

test("teardown returns queued-but-unsent slots and re-arms the limit notice", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/inflight.png", kind: "image", previewable: true },
    { url: "https://cdn.test/queued.png", kind: "image", previewable: true },
    { url: "https://cdn.test/over.png", kind: "image", previewable: true },
  ];
  const dedup = createAutoDownloadDedup();
  // The first candidate is shifted and in flight (it stays consumed); the
  // second waits in the queue; the third trips the limit notice.
  const send = vi.fn(() => new Promise<never>(() => {}));
  const onLimitReached = vi.fn();
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 2,
    send,
    onLimitReached,
    dedup,
  });
  expect(onLimitReached).toHaveBeenCalledOnce();

  controller.stop();

  // The dedup outlives the instance across a remount: the queued candidate
  // must return its slot and the limit notice must be able to fire again.
  expect(dedup.seen).toEqual(new Set(["https://cdn.test/inflight.png"]));
  expect(dedup.limitNotified).toBe(false);
});

test("a dispatch-time drop re-arms the limit notice with the returned slot", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/sent.png", kind: "image", previewable: true },
    { url: "https://cdn.test/blocked.png", kind: "image", previewable: true },
    { url: "https://cdn.test/over.png", kind: "image", previewable: true },
  ];
  const dedup = createAutoDownloadDedup();
  let disabled = false;
  let release!: () => void;
  const gate = new Promise<"started">((resolve) => {
    release = () => resolve("started");
  });
  const send = vi.fn(() => gate);
  const onLimitReached = vi.fn();
  const controller = setupAutoDownloadDiscovery({
    rules: anyMediaRules,
    live: false,
    maxPerPage: 2,
    isPageDisabled: () => disabled,
    send,
    onLimitReached,
    dedup,
  });
  expect(onLimitReached).toHaveBeenCalledOnce();

  // The page moves onto the disable list while the first send is in flight;
  // the queued candidate is dropped at dispatch and returns its slot.
  disabled = true;
  release();
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(dedup.seen).toEqual(new Set(["https://cdn.test/sent.png"]));
  expect(dedup.limitNotified).toBe(false);
  controller.stop();
});

test("ignores an observer delivery that races with shutdown", () => {
  let notify!: MutationCallback;
  class FakeMutationObserver {
    constructor(callback: MutationCallback) {
      notify = callback;
    }
    observe = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({ rules, live: true, maxPerPage: 10, send });
  controller.stop();

  notify([{ type: "attributes", addedNodes: [] } as unknown as MutationRecord], {} as never);
  expect(send).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("bounds and coalesces adversarial live mutation roots", async () => {
  vi.useFakeTimers();
  let notify!: MutationCallback;
  class FakeMutationObserver {
    constructor(callback: MutationCallback) {
      notify = callback;
    }
    observe = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  const controller = setupAutoDownloadDiscovery({
    rules,
    live: true,
    maxPerPage: 100,
    send: vi.fn(async () => "started" as const),
  });

  const mutation = (addedNodes: Node[], target: Node = document.body): MutationRecord =>
    ({ type: "childList", target, addedNodes, removedNodes: [] }) as unknown as MutationRecord;
  const detached = document.createElement("img");
  notify([mutation([detached]), mutation([], document)], {} as MutationObserver);
  notify([mutation([detached])], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(200);

  const parent = document.createElement("div");
  const child = document.createElement("img");
  parent.append(child);
  document.body.append(parent);
  notify([mutation([parent, child])], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(200);
  notify([mutation([child, parent])], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(200);

  const picture = document.createElement("picture");
  const responsive = document.createElement("source");
  picture.append(responsive, document.createElement("img"));
  document.body.append(picture);
  const orphanSource = document.createElement("source");
  notify([mutation([responsive, orphanSource])], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(200);

  const style = document.createElement("style");
  document.head.append(style);
  notify([mutation([], style)], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(200);

  const roots = Array.from({ length: 66 }, () => document.createElement("div"));
  roots.forEach((root) => document.body.append(root));
  notify(
    [
      ...roots.slice(0, 64).map((root) => mutation([root])),
      mutation(roots.slice(64)),
      mutation([document.createElement("span")]),
    ],
    {} as MutationObserver,
  );
  await vi.advanceTimersByTimeAsync(200);

  controller.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
