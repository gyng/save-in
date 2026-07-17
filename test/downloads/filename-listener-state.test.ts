import {
  createDeferredRouteRecovery,
  enqueueDeferredRoute,
  enqueueFilename,
  filenameQueue,
  FINAL_FILENAME_MAP_VERSION as VERSION,
  removeDeferredRoute,
  removeFilename,
  type DeferredRouteRecovery,
  type FinalFilenameMap,
} from "../../src/downloads/filename-listener.ts";
import { Path } from "../../src/routing/path.ts";

describe("persisted final-filename queues", () => {
  test("normalizes malformed queue entries before updating them", () => {
    const stored = {
      version: VERSION,
      names: {
        valid: ["first.jpg", 7, null, "second.jpg"],
        invalid: { filename: "old.jpg" },
      },
    } as unknown as FinalFilenameMap;

    expect(enqueueFilename(stored, "valid", "third.jpg")).toEqual({
      version: VERSION,
      names: { valid: ["first.jpg", "second.jpg", "third.jpg"] },
    });
    expect(removeFilename(stored, "valid", "first.jpg")).toEqual({
      version: VERSION,
      names: { valid: "second.jpg" },
    });
  });

  test("accepts the scalar entry shape and rejects values that are not names", () => {
    expect(filenameQueue("single.jpg")).toEqual(["single.jpg"]);
    expect(filenameQueue(["one.jpg", false, "two.jpg"])).toEqual(["one.jpg", "two.jpg"]);
    expect(filenameQueue({ filename: "nope.jpg" })).toEqual([]);
    // An empty name could never be suggested, and a queue headed by one reads
    // to the recovery as having found nothing while still holding the entry.
    expect(filenameQueue("")).toEqual([]);
    expect(filenameQueue(["", "two.jpg"])).toEqual(["two.jpg"]);
  });

  test("creates, queues, and removes filename entries", () => {
    const map = (names: Record<string, string | string[]>) => ({ version: VERSION, names });

    expect(enqueueFilename(null, "url", "one.jpg")).toEqual(map({ url: "one.jpg" }));
    expect(enqueueFilename(map({ url: "one.jpg" }), "url", "two.jpg")).toEqual(
      map({ url: ["one.jpg", "two.jpg"] }),
    );
    expect(removeFilename(map({ url: ["one.jpg", "two.jpg"] }), "url")).toEqual(
      map({ url: "two.jpg" }),
    );
    expect(removeFilename(map({ url: ["one.jpg", "two.jpg", "three.jpg"] }), "url")).toEqual(
      map({ url: ["two.jpg", "three.jpg"] }),
    );
    expect(removeFilename(map({ url: "one.jpg" }), "url", "missing.jpg")).toEqual(
      map({ url: "one.jpg" }),
    );
    expect(removeFilename(map({ url: "one.jpg" }), "url", "one.jpg")).toEqual(map({}));
    expect(enqueueFilename([], "url", "one.jpg")).toEqual(map({ url: "one.jpg" }));
  });

  test("reads a map this version did not stamp as empty", () => {
    // The stamp is what lets the restart recovery honour a name it finds: those
    // names were resolved by this build's rules. A map from another build was
    // resolved by rules this one no longer knows, so it is read as empty rather
    // than repaired — its names could route a save somewhere today's rules
    // never named.
    const foreign = { version: VERSION + 1, names: { url: "old.jpg" } };
    expect(enqueueFilename(foreign, "url", "new.jpg")).toEqual({
      version: VERSION,
      names: { url: "new.jpg" },
    });
    expect(removeFilename(foreign, "url")).toEqual({ version: VERSION, names: {} });

    // Same for a map written before the stamp existed, and for a stamped map
    // whose names a build wrote as something other than a record.
    expect(enqueueFilename({ url: "old.jpg" }, "url", "new.jpg")).toEqual({
      version: VERSION,
      names: { url: "new.jpg" },
    });
    expect(removeFilename({ version: VERSION, names: "gone" }, "url")).toEqual({
      version: VERSION,
      names: {},
    });
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
