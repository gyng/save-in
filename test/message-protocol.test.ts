import { describe, expect, test } from "vitest";

import { MESSAGE_TYPES } from "../src/shared/constants.ts";
import {
  isExternalMessage,
  isInternalMessage,
  isStringKeyedRecord,
  isWireDownloadState,
  toWireDownloadState,
} from "../src/shared/message-protocol.ts";

describe("message protocol runtime validation", () => {
  test("accepts valid internal and external message bodies", () => {
    expect(
      isInternalMessage({ type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: "images" } }),
    ).toBe(true);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: false }, expected: { prompt: true } },
      }),
    ).toBe(true);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: {
          pageUrl: "https://example.test/gallery/",
          sourceUrl: "https://cdn.test/image.png",
          sourceKind: "image",
        },
      }),
    ).toBe(true);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.VALIDATE,
        body: {
          filenamePatterns: "pagetitle: report\ninto: reports",
          info: {
            frameUrl: "https://frame.test/",
            linkText: "Report",
            mediaType: "image",
            selectionText: "selected",
            resolvedFilename: "report.pdf",
            mimeExtension: "pdf",
            modifiers: ["Shift"],
            preview: true,
            counter: 2,
            now: new Date("2026-01-02T03:04:05.000Z"),
            context: "media",
            menuIndex: "2",
            currentTab: { title: "Quarterly report", incognito: false },
          },
        },
      }),
    ).toBe(true);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: {
          url: "https://x/image.png",
          info: { pageUrl: "https://x/", suggestedFilename: "image.png" },
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { target: "activeTab", comment: "gesturefy", version: 1 },
      }),
    ).toBe(true);
  });

  test.each([
    { type: MESSAGE_TYPES.PING, body: {} },
    { type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: 1 } },
    { type: MESSAGE_TYPES.CHECK_ROUTES, body: { state: { info: null } } },
    { type: MESSAGE_TYPES.VALIDATE, body: [] },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { filename: 42 } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { pageUrl: null } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { mediaType: 42 } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { resolvedFilename: {} } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { mimeExtension: false } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { suggestedFilename: 42 } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { modifiers: ["Shift", 1] } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { preview: "yes" } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { counter: Number.NaN } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { now: "today" } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { currentTab: { title: 42 } } } },
    { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: [] } },
    { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: {}, expected: [] } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { url: 1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { info: "not an object" } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: Number.NaN } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { target: "currentTab" } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { target: 1 } },
    {
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: "https://x/", sourceUrl: "https://x/a.png", sourceKind: "script" },
    },
    {
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: "https://x/", sourceUrl: 1, sourceKind: "image" },
    },
  ])("rejects malformed internal message %#", (message) => {
    expect(isInternalMessage(message)).toBe(false);
  });

  test("rejects malformed external bodies even when their type is recognized", () => {
    expect(isExternalMessage({ type: MESSAGE_TYPES.VALIDATE, body: { paths: false } })).toBe(false);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { url: "https://x/image.png", info: { pageUrl: 42 } },
      }),
    ).toBe(false);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: {
          pageUrl: "https://example.test/",
          sourceUrl: "https://cdn.test/image.png",
          sourceKind: "image",
        },
      }),
    ).toBe(false);
  });

  test("recognizes only non-array records as imported configuration", () => {
    expect(isStringKeyedRecord({ paths: "images" })).toBe(true);
    expect(isStringKeyedRecord([])).toBe(false);
    expect(isStringKeyedRecord(null)).toBe(false);
  });

  test("never throws for adversarial structured-clone values", () => {
    const values = [undefined, null, true, 0, "PING", [], new Date(), /x/, new Map(), new Set()];
    for (const value of values) {
      expect(() => isInternalMessage(value)).not.toThrow();
      expect(() => isExternalMessage(value)).not.toThrow();
    }
  });

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

  test("rejects malformed persisted download state", () => {
    expect(isWireDownloadState({ info: { contentFetchDisabled: "yes" } })).toBe(false);
    expect(isWireDownloadState({ info: { mime: 42 } })).toBe(false);
    expect(isWireDownloadState({ info: { referrerUrl: false } })).toBe(false);
    expect(isWireDownloadState({ info: { mimeExtension: 42 } })).toBe(false);
  });
});
