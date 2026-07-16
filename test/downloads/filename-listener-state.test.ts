import {
  createDeferredRouteRecovery,
  enqueueDeferredRoute,
  enqueueFilename,
  filenameQueue,
  removeDeferredRoute,
  removeFilename,
  type DeferredRouteRecovery,
  type FinalFilenameMap,
} from "../../src/downloads/filename-listener.ts";
import { Path } from "../../src/routing/path.ts";

describe("persisted final-filename queues", () => {
  test("normalizes malformed legacy queue entries before updating them", () => {
    const stored = {
      valid: ["first.jpg", 7, null, "second.jpg"],
      invalid: { filename: "old.jpg" },
    } as unknown as FinalFilenameMap;

    expect(enqueueFilename(stored, "valid", "third.jpg")).toEqual({
      valid: ["first.jpg", "second.jpg", "third.jpg"],
    });
    expect(removeFilename(stored, "valid", "first.jpg")).toEqual({
      valid: "second.jpg",
    });
  });

  test("accepts the legacy scalar shape and rejects non-string values", () => {
    expect(filenameQueue("single.jpg")).toEqual(["single.jpg"]);
    expect(filenameQueue(["one.jpg", false, "two.jpg"])).toEqual(["one.jpg", "two.jpg"]);
    expect(filenameQueue({ filename: "nope.jpg" })).toEqual([]);
  });

  test("creates, queues, and removes filename entries from legacy storage", () => {
    expect(enqueueFilename(null, "url", "one.jpg")).toEqual({ url: "one.jpg" });
    expect(enqueueFilename({ url: "one.jpg" }, "url", "two.jpg")).toEqual({
      url: ["one.jpg", "two.jpg"],
    });
    expect(removeFilename({ url: ["one.jpg", "two.jpg"] }, "url")).toEqual({
      url: "two.jpg",
    });
    expect(removeFilename({ url: ["one.jpg", "two.jpg", "three.jpg"] }, "url")).toEqual({
      url: ["two.jpg", "three.jpg"],
    });
    expect(removeFilename({ url: "one.jpg" }, "url", "missing.jpg")).toEqual({
      url: "one.jpg",
    });
    expect(removeFilename({ url: "one.jpg" }, "url", "one.jpg")).toEqual({});
    expect(enqueueFilename([], "url", "one.jpg")).toEqual({ url: "one.jpg" });
  });
});

describe("persisted deferred-route queues", () => {
  const recovery = (id: string): DeferredRouteRecovery => ({
    version: 1,
    id,
    state: { path: "downloads", info: { url: "https://x.test/file" } },
  });

  test("captures optional recovery fields", () => {
    const full = createDeferredRouteRecovery({
      path: new Path("downloads"),
      info: { url: "https://x.test/file" },
      scratch: {
        pathTemplateRaw: "downloads/:filename:",
        routeTemplateRaw: "routed/:filename:",
        renameTemplate: { find: "a", flags: "g", replacement: "b" },
        mimeExtension: "jpg",
        historyEntryId: "history-1",
      },
    });
    expect(full).toMatchObject({
      pathTemplateRaw: "downloads/:filename:",
      routeTemplateRaw: "routed/:filename:",
      renameTemplate: { find: "a", flags: "g", replacement: "b" },
      mimeExtension: "jpg",
      historyEntryId: "history-1",
    });

    const minimal = createDeferredRouteRecovery({
      path: new Path(""),
      info: { url: "https://x.test/file" },
      scratch: {},
    });
    expect(minimal).not.toHaveProperty("pathTemplateRaw");
  });

  test("normalizes malformed entries while queueing recoveries", () => {
    expect(
      enqueueDeferredRoute(
        {
          invalidPrimitive: 7,
          invalidVersion: { ...recovery("bad"), version: 2 },
          invalidId: { ...recovery("bad"), id: 7 },
          invalidState: { ...recovery("bad"), state: null },
          emptyQueue: [],
          malformedRename: {
            ...recovery("bad-rename"),
            renameTemplate: { find: "a", flags: "g" },
          },
          valid: {
            ...recovery("one"),
            pathTemplateRaw: "path",
            routeTemplateRaw: "route",
            renameTemplate: { find: "a", flags: "g", replacement: "b" },
            mimeExtension: "jpg",
            historyEntryId: "history-1",
          },
        },
        "valid",
        recovery("two"),
      ),
    ).toEqual({
      // A malformed persisted rename transform is dropped, not fatal: the
      // recovery entry itself stays usable.
      malformedRename: expect.not.objectContaining({ renameTemplate: expect.anything() }),
      valid: [
        expect.objectContaining({
          id: "one",
          pathTemplateRaw: "path",
          renameTemplate: { find: "a", flags: "g", replacement: "b" },
          mimeExtension: "jpg",
        }),
        recovery("two"),
      ],
    });
    expect(enqueueDeferredRoute([], "url", recovery("one"))).toEqual({ url: recovery("one") });
  });

  test("removes the first, named, missing, and last recoveries", () => {
    const queued = { url: [recovery("one"), recovery("two")] };
    expect(removeDeferredRoute(queued, "url")).toEqual({ url: recovery("two") });
    expect(removeDeferredRoute(queued, "url", "two")).toEqual({ url: recovery("one") });
    expect(removeDeferredRoute(queued, "url", "missing")).toEqual(queued);
    expect(removeDeferredRoute({ url: recovery("one") }, "url", "one")).toEqual({});
  });
});
