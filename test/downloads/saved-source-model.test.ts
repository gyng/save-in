import { DOWNLOAD_TYPES } from "../../src/shared/constants.ts";
import {
  savedSourceLookupUrl,
  type SavedSourceCheck,
} from "../../src/downloads/saved-source-model.ts";

const URL = "https://cdn.example/photo.jpg";

const check = (overrides: Partial<SavedSourceCheck> = {}): SavedSourceCheck => ({
  mode: "all",
  context: DOWNLOAD_TYPES.MEDIA,
  url: URL,
  isolatedPrivate: false,
  explicitPrompt: false,
  repeatsSavedSource: false,
  ...overrides,
});

const MANUAL_CONTEXTS = [
  DOWNLOAD_TYPES.MEDIA,
  DOWNLOAD_TYPES.LINK,
  DOWNLOAD_TYPES.SELECTION,
  DOWNLOAD_TYPES.PAGE,
  DOWNLOAD_TYPES.CLICK,
  DOWNLOAD_TYPES.TAB,
  DOWNLOAD_TYPES.UNKNOWN,
  // External and e2e saves carry no context of their own.
  undefined,
];

describe("savedSourceLookupUrl", () => {
  // Option value × context: which saves the option covers at all.
  test.each([
    ...[...MANUAL_CONTEXTS, DOWNLOAD_TYPES.AUTO, DOWNLOAD_TYPES.SIDECAR].map(
      (context) => ["never", context, false] as const,
    ),
    ...MANUAL_CONTEXTS.map((context) => ["automatic", context, false] as const),
    ["automatic", DOWNLOAD_TYPES.AUTO, true] as const,
    ["automatic", DOWNLOAD_TYPES.SIDECAR, false] as const,
    ...MANUAL_CONTEXTS.map((context) => ["all", context, true] as const),
    ["all", DOWNLOAD_TYPES.AUTO, true] as const,
    ["all", DOWNLOAD_TYPES.SIDECAR, false] as const,
  ])("mode %s with context %s is looked up: %s", (mode, context, covered) => {
    expect(savedSourceLookupUrl(check({ mode, context }))).toBe(covered ? URL : null);
  });

  // A stored value from a malformed or newer profile must leave saves alone.
  test.each([undefined, null, true, 1, "", "ALL", "always", {}])(
    "treats the unrecognised mode %j as never",
    (mode) => {
      expect(savedSourceLookupUrl(check({ mode }))).toBeNull();
      expect(savedSourceLookupUrl(check({ mode, context: DOWNLOAD_TYPES.AUTO }))).toBeNull();
    },
  );

  // Private × forced prompt × re-route, for both modes that can cover a save.
  const covering = [
    ["all", DOWNLOAD_TYPES.MEDIA],
    ["all", DOWNLOAD_TYPES.AUTO],
    ["automatic", DOWNLOAD_TYPES.AUTO],
  ] as const;
  const flags = [false, true];
  test.each(
    covering.flatMap(([mode, context]) =>
      flags.flatMap((isolatedPrivate) =>
        flags.flatMap((explicitPrompt) =>
          flags.map(
            (repeatsSavedSource) =>
              [mode, context, isolatedPrivate, explicitPrompt, repeatsSavedSource] as const,
          ),
        ),
      ),
    ),
  )(
    "mode %s, context %s, isolated private %s, explicit prompt %s, repeat %s",
    (mode, context, isolatedPrivate, explicitPrompt, repeatsSavedSource) => {
      const exempt = isolatedPrivate || explicitPrompt || repeatsSavedSource;
      expect(
        savedSourceLookupUrl(
          check({ mode, context, isolatedPrivate, explicitPrompt, repeatsSavedSource }),
        ),
      ).toBe(exempt ? null : URL);
    },
  );

  test.each([
    ["https://cdn.example/a.png?size=2#frag", true],
    ["http://cdn.example/a.png", true],
    ["HTTPS://CDN.EXAMPLE/a.png", true],
    ["data:image/png;base64,AAAA", false],
    ["blob:https://cdn.example/7f1c", false],
    ["ftp://cdn.example/a.png", false],
    ["file:///tmp/a.png", false],
    ["", false],
  ])("the address %s has a stable identity: %s", (url, stable) => {
    // The address is compared exactly as recorded, never rewritten.
    expect(savedSourceLookupUrl(check({ url }))).toBe(stable ? url : null);
  });
});
