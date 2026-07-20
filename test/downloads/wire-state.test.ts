import { describe, expect, test } from "vitest";

import { fromWireDownloadState, toWireDownloadState } from "../../src/downloads/wire-state.ts";

describe("download wire-state marshalling", () => {
  test("converts live download state into a clone-safe wire snapshot", () => {
    const path = { finalize: () => "images/photo.png", toString: () => "images/photo.png" };
    const snapshot = toWireDownloadState({
      path,
      route: { finalize: () => "routed/photo.png", toString: () => "routed/photo.png" },
      routeIsFolder: false,
      scratch: { historyEntryId: "h1", hasExtension: [".png"] as RegExpMatchArray },
      info: {
        url: "https://x/photo.png",
        referrerUrl: "https://gallery.example/photo/1",
        frameUrl: "https://x/gallery",
        mediaType: "image",
        mime: "image/png",
        mimeExtension: "png",
        resolvedFilename: "photo.png",
        contentFetchDisabled: true,
        now: new Date("2026-01-02T03:04:05.000Z"),
        currentTab: { id: 7, title: "Photo", incognito: false },
        contentPromise: Promise.resolve(null),
      },
    });

    expect(snapshot).toEqual({
      path: "images/photo.png",
      route: "routed/photo.png",
      routeIsFolder: false,
      info: {
        url: "https://x/photo.png",
        referrerUrl: "https://gallery.example/photo/1",
        frameUrl: "https://x/gallery",
        mediaType: "image",
        mime: "image/png",
        mimeExtension: "png",
        resolvedFilename: "photo.png",
        contentFetchDisabled: true,
        now: "2026-01-02T03:04:05.000Z",
        currentTab: { id: 7, title: "Photo", incognito: false },
      },
    });
    expect(structuredClone(snapshot)).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test("serializes every clone-safe field and preserves explicit nulls", () => {
    const state = {
      path: {} as never,
      route: {} as never,
      routeIsFolder: true,
      scratch: {},
      info: {
        sourceKind: "video" as const,
        gesture: "middle-click" as const,
        suggestedFilename: null,
        menuIndex: "2",
        comment: null,
        modifiers: ["Shift"],
        preview: false,
        contentFetchDisabled: false,
        counter: 3,
        now: new Date("invalid"),
        currentTab: null,
      },
    };
    expect(toWireDownloadState(state)).toEqual({
      routeIsFolder: true,
      info: {
        sourceKind: "video",
        gesture: "middle-click",
        suggestedFilename: null,
        menuIndex: "2",
        comment: null,
        modifiers: ["Shift"],
        preview: false,
        contentFetchDisabled: false,
        counter: 3,
        currentTab: null,
      },
    });

    for (const counter of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        toWireDownloadState({
          path: {} as never,
          scratch: {},
          info: {
            counter,
            currentTab: {
              id: undefined,
              title: undefined,
              url: "https://x/",
              incognito: undefined,
            },
          },
        }),
      ).toEqual({ info: { currentTab: { url: "https://x/" } } });
    }
    for (const id of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        toWireDownloadState({
          path: {} as never,
          scratch: {},
          info: { currentTab: { id, title: "Page" } },
        }),
      ).toEqual({ info: { currentTab: { title: "Page" } } });
    }
    expect(toWireDownloadState({ path: {} as never, scratch: {}, info: {} })).toEqual({ info: {} });
  });

  test("hydrates valid dates and tabs while dropping malformed legacy values", () => {
    expect(
      fromWireDownloadState({
        info: {
          now: "2026-01-02T03:04:05.000Z",
          currentTab: { id: 4, title: "Page", url: "https://x/", incognito: false },
        },
      }),
    ).toEqual({
      info: {
        now: new Date("2026-01-02T03:04:05.000Z"),
        currentTab: { id: 4, title: "Page", url: "https://x/", incognito: false },
      },
    });
    expect(fromWireDownloadState({ info: { now: "invalid", currentTab: null } })).toEqual({
      info: { currentTab: null },
    });
    expect(
      fromWireDownloadState({
        info: {
          currentTab: { id: undefined, title: undefined, url: undefined, incognito: undefined },
        },
      }),
    ).toEqual({ info: { currentTab: {} } });
    for (const id of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(fromWireDownloadState({ info: { currentTab: { id, title: "Page" } } })).toEqual({
        info: { currentTab: { title: "Page" } },
      });
    }
    expect(fromWireDownloadState({ info: {} })).toEqual({ info: {} });
  });
});
