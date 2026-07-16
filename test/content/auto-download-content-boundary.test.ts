// @vitest-environment jsdom
const fixture = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>> }));

vi.mock("../../src/content/source-panel-model.ts", () => ({
  collectPageSourceCandidates: () => fixture.candidates,
}));

import { setupAutoDownloadDiscovery } from "../../src/content/auto-download.ts";
import type { AutomaticRoutingCandidate } from "../../src/automation/automatic-routing.ts";

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

test("keeps only media-kind candidates and drops stream, document, and plain links", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/photo.jpg", kind: "image", previewable: true },
    { url: "https://cdn.test/clip.mp4", kind: "video", previewable: true },
    { url: "https://cdn.test/song.mp3", kind: "audio", previewable: true },
    { url: "https://cdn.test/playlist.m3u8", kind: "stream", previewable: true },
    { url: "https://cdn.test/paper.pdf", kind: "document", previewable: true },
    { url: "https://cdn.test/page.html", kind: "link", previewable: true },
  ];
  const send = vi.fn(async (_candidate: AutomaticRoutingCandidate) => "started" as const);
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

test("applies the per-page limit after the media-kind filter", async () => {
  fixture.candidates = [
    { url: "https://cdn.test/skip.pdf", kind: "document", previewable: true },
    { url: "https://cdn.test/first.jpg", kind: "image", previewable: true },
    { url: "https://cdn.test/second.mp4", kind: "video", previewable: true },
  ];
  const send = vi.fn(async (_candidate: AutomaticRoutingCandidate) => "started" as const);
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
