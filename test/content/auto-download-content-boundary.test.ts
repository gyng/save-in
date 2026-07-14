// @vitest-environment jsdom
const fixture = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>> }));

vi.mock("../../src/content/source-panel-model.ts", () => ({
  collectPageSourceCandidates: () => fixture.candidates,
}));

import { setupAutoDownloadDiscovery } from "../../src/content/auto-download.ts";

const rules = String.raw`
context: ^auto$
pageurl: ^http://localhost/
sourcekind: image
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
