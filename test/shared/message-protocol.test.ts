import { describe, expect, test } from "vitest";

import { MESSAGE_TYPES } from "../../src/shared/constants.ts";
import {
  getMessageType,
  isExternalMessage,
  isInternalMessage,
  isStringKeyedRecord,
  isWireDownloadState,
} from "../../src/shared/message-protocol.ts";

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
        type: MESSAGE_TYPES.CREATE_SOURCE_RULE,
        body: { sourceUrl: "https://cdn.test/image.png", sourceKind: "image" },
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
    // sourceChannel is optional (absent for embedded media) but must be a
    // known channel when a phase-B candidate (anchor/background/resource-hint)
    // supplies one.
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: {
          pageUrl: "https://example.test/gallery/",
          sourceUrl: "https://cdn.test/manifest.m3u8",
          sourceKind: "stream",
          sourceChannel: "resource-hint",
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
            now: "2026-01-02T03:04:05.000Z",
            context: "media",
            menuIndex: "2",
            currentTab: { title: "Quarterly report", incognito: false },
          },
        },
      }),
    ).toBe(true);
    expect(isExternalMessage({ type: MESSAGE_TYPES.GET_KEYWORDS })).toBe(true);
    expect(isExternalMessage({ type: MESSAGE_TYPES.GET_GRAMMARS })).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.GET_CONFIG })).toBe(true);
    expect(isExternalMessage({ type: MESSAGE_TYPES.GET_CONFIG })).toBe(false);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.VALIDATE,
        body: {
          filenamePatterns:
            "context: ^auto$\npagedomain: example\\.test\nsourcekind: image\ninto: Images",
          automaticCandidate: {
            pageUrl: "https://example.test/",
            sourceUrl: "https://cdn.test/a.png",
            sourceKind: "image",
            suggestedFilename: "a-final.png",
          },
        },
      }),
    ).toBe(true);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: {
          url: "https://x/image.png",
          info: {
            pageUrl: "https://x/",
            suggestedFilename: "image.png",
            mime: "image/png",
            mediaType: "image",
            sourceKind: "image",
          },
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
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { counter: -1 } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { counter: 1.5 } } },
    {
      type: MESSAGE_TYPES.VALIDATE,
      body: { info: { counter: Number.MAX_SAFE_INTEGER + 1 } },
    },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { now: "today" } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { currentTab: { title: 42 } } } },
    {
      type: MESSAGE_TYPES.VALIDATE,
      body: {
        automaticCandidate: {
          pageUrl: "https://x/",
          sourceUrl: "https://x/a",
          sourceKind: "image",
          suggestedFilename: 42,
        },
      },
    },
    {
      type: MESSAGE_TYPES.VALIDATE,
      body: {
        automaticCandidate: {
          pageUrl: "https://x/",
          sourceUrl: "https://x/a",
          sourceKind: "script",
        },
      },
    },
    { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: [] } },
    { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: {}, expected: [] } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { url: 1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { info: "not an object" } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: Number.NaN } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: 0 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: -1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: 1.5 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: Number.MAX_SAFE_INTEGER + 1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { target: "currentTab" } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { target: 1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { info: { sourceKind: "script" } } },
    {
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: "https://x/", sourceUrl: "https://x/a.png", sourceKind: "script" },
    },
    {
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: "https://x/", sourceUrl: 1, sourceKind: "image" },
    },
    {
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: {
        pageUrl: "https://x/",
        sourceUrl: "https://x/a.m3u8",
        sourceKind: "stream",
        sourceChannel: "embedded",
      },
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

  test("recognizes message types without accepting malformed discriminators", () => {
    expect(getMessageType({ type: MESSAGE_TYPES.PING })).toBe(MESSAGE_TYPES.PING);
    expect(getMessageType({ type: 1 })).toBeUndefined();
    const arrayMessage = Object.assign([], { type: MESSAGE_TYPES.PING });
    expect(getMessageType(arrayMessage)).toBeUndefined();
    expect(isInternalMessage(arrayMessage)).toBe(false);
    expect(isExternalMessage(arrayMessage)).toBe(false);
    expect(getMessageType(null)).toBeUndefined();
    expect(isInternalMessage({ type: "UNKNOWN" })).toBe(false);
    expect(isExternalMessage({ type: MESSAGE_TYPES.HISTORY_GET })).toBe(false);
  });

  test.each([
    MESSAGE_TYPES.WAKE_WARM,
    MESSAGE_TYPES.SOURCE_PANEL_READY,
    MESSAGE_TYPES.SOURCE_PANEL_COPY,
    MESSAGE_TYPES.DIAGNOSTICS_GET,
    MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES,
    MESSAGE_TYPES.HISTORY_GET,
    MESSAGE_TYPES.HISTORY_CLEAR,
    MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
    MESSAGE_TYPES.OPTIONS_LOADED,
    MESSAGE_TYPES.OPTIONS,
    MESSAGE_TYPES.OPTIONS_SCHEMA,
    MESSAGE_TYPES.GET_KEYWORDS,
    MESSAGE_TYPES.GET_GRAMMARS,
    MESSAGE_TYPES.PING,
    MESSAGE_TYPES.GET_SCHEMA,
    MESSAGE_TYPES.GET_CONFIG,
  ])("accepts bodyless %s messages only without a body", (type) => {
    expect(isInternalMessage({ type })).toBe(true);
    expect(isInternalMessage({ type, body: undefined })).toBe(true);
    expect(isInternalMessage({ type, body: null })).toBe(false);
  });

  test("validates optional and required internal message bodies", () => {
    expect(isInternalMessage({ type: MESSAGE_TYPES.PREVIEW_MENUS })).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} })).toBe(true);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.CHECK_ROUTES,
        body: { state: { info: {}, path: "images", route: "routed", routeIsFolder: true } },
      }),
    ).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.VALIDATE })).toBe(true);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.VALIDATE,
        body: { info: { now: "2026-07-15T12:30:00.000Z" } },
      }),
    ).toBe(true);
    expect(
      isInternalMessage({ type: MESSAGE_TYPES.VALIDATE, body: { info: { now: "not-a-date" } } }),
    ).toBe(false);
    expect(isInternalMessage({ type: MESSAGE_TYPES.APPLY_CONFIG, body: undefined })).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.DOWNLOAD })).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.DOWNLOAD, body: null })).toBe(false);
    expect(
      isInternalMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_STATE, body: { open: false } }),
    ).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_STATE })).toBe(true);
    expect(isInternalMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_STATE, body: {} })).toBe(false);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
        body: { senderId: "extension-id" },
      }),
    ).toBe(true);
    expect(
      isInternalMessage({
        type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
        body: { senderId: "" },
      }),
    ).toBe(false);
    expect(isInternalMessage({ type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR })).toBe(
      false,
    );
    expect(isInternalMessage({ type: MESSAGE_TYPES.HISTORY_CANCEL, body: null })).toBe(false);
  });

  test.each([
    { pageUrl: 1, sourceUrl: "https://x/a", sourceKind: "image" },
    { pageUrl: "https://x/", sourceUrl: 1, sourceKind: "image" },
    { pageUrl: "https://x/", sourceUrl: "https://x/a", sourceKind: "script" },
  ])("rejects malformed automatic validation candidates %#", (automaticCandidate) => {
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.VALIDATE,
        body: { automaticCandidate },
      }),
    ).toBe(false);
  });

  test("never throws for adversarial structured-clone values", () => {
    const values = [undefined, null, true, 0, "PING", [], new Date(), /x/, new Map(), new Set()];
    for (const value of values) {
      expect(() => isInternalMessage(value)).not.toThrow();
      expect(() => isExternalMessage(value)).not.toThrow();
    }
  });

  test("accepts complete persisted download state", () => {
    expect(
      isWireDownloadState({
        info: {
          sourceKind: "audio",
          suggestedFilename: null,
          menuIndex: null,
          comment: "menu",
          modifiers: ["Alt"],
          preview: true,
          contentFetchDisabled: false,
          counter: 1,
          now: "2026-01-01T00:00:00.000Z",
          currentTab: { id: 1, title: "Page", url: "https://x/", incognito: true },
        },
        path: "images",
        route: "route",
        routeIsFolder: false,
      }),
    ).toBe(true);
    expect(isWireDownloadState({ info: { currentTab: null } })).toBe(true);
  });

  test.each([
    null,
    { info: null },
    { info: { sourceKind: "script" } },
    { info: { suggestedFilename: 2 } },
    { info: { modifiers: "Alt" } },
    { info: { modifiers: [2] } },
    { info: { preview: "yes" } },
    { info: { counter: Number.NaN } },
    { info: { counter: -1 } },
    { info: { counter: 1.5 } },
    { info: { counter: Number.MAX_SAFE_INTEGER + 1 } },
    { info: { now: 2 } },
    { info: { currentTab: { id: Number.NaN } } },
    { info: { currentTab: { id: -1 } } },
    { info: { currentTab: { id: 1.5 } } },
    { info: { currentTab: { id: Number.MAX_SAFE_INTEGER + 1 } } },
    { info: { currentTab: { incognito: "yes" } } },
    { info: {}, path: 2 },
    { info: {}, route: 2 },
    { info: {}, routeIsFolder: "yes" },
  ])("rejects malformed wire state %#", (state) => {
    expect(isWireDownloadState(state)).toBe(false);
  });

  test.each([
    { info: { srcUrl: 2 } },
    { info: { sourceKind: "script" } },
    { info: { comment: 2 } },
    { info: { modifiers: "Shift" } },
    { info: { modifiers: [2] } },
    { info: { contentFetchDisabled: "yes" } },
    { info: { currentTab: { id: Number.MAX_SAFE_INTEGER + 1 } } },
    { info: { currentTab: { url: 2 } } },
  ])("rejects malformed validation info %#", (body) => {
    expect(isExternalMessage({ type: MESSAGE_TYPES.VALIDATE, body })).toBe(false);
  });

  test.each([
    { info: { suggestedFilename: null, menuIndex: null, comment: null } },
    { info: { modifiers: [] } },
    { info: { currentTab: null } },
    { info: { currentTab: { id: 1, url: "https://x/", incognito: false } } },
  ])("accepts optional download request info %#", (body) => {
    expect(isExternalMessage({ type: MESSAGE_TYPES.DOWNLOAD, body })).toBe(true);
  });

  test("rejects malformed persisted download state", () => {
    expect(isWireDownloadState({ info: { contentFetchDisabled: "yes" } })).toBe(false);
    expect(isWireDownloadState({ info: { mime: 42 } })).toBe(false);
    expect(isWireDownloadState({ info: { referrerUrl: false } })).toBe(false);
    expect(isWireDownloadState({ info: { mimeExtension: 42 } })).toBe(false);
  });
});
