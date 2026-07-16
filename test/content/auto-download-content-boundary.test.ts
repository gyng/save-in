// @vitest-environment jsdom
const fixture = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>> }));

vi.mock("../../src/content/source-panel-model.ts", () => ({
  collectPageSourceCandidates: () => fixture.candidates,
}));

import {
  createAutoDownloadDedup,
  setupAutoDownloadDiscovery as rawSetupAutoDownloadDiscovery,
  type AutoDownloadDiscoveryOptions,
} from "../../src/content/auto-download.ts";
import type { AutomaticRoutingCandidate } from "../../src/automation/automatic-routing.ts";

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
  const send = vi.fn(async () => "started" as const);
  const controller = setupAutoDownloadDiscovery({ rules, live: false, maxPerPage: 10, send });
  await controller.idle();

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ sourceUrl: "https://cdn.test/visible.png" }),
  );
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
  const send = vi.fn(async () => "started" as const);
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
