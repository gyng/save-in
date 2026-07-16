// OptionsManagement: option schema/defaults and storage normalization. The
// background route-preview service is exercised here against the same routing
// dependency fakes because it consumes the normalized options bag.

import * as constants from "../../src/shared/constants.ts";
import type { RoutingRule, RuleClause } from "../../src/routing/router.ts";
import {
  PATH_TRUNCATION_MIGRATION_STORAGE_KEY,
  PATH_TRUNCATION_MIGRATION_VERSION,
} from "../../src/shared/storage-keys.ts";

const routingRule = (name: string): RoutingRule => {
  const clauses = [
    { name, value: /.*/, type: constants.RULE_TYPES.MATCHER, matcher: () => null },
    { name: "into", value: name, type: constants.RULE_TYPES.DESTINATION },
  ] satisfies RuleClause[];
  // This fixture supplies post-parse rules while the routing service itself is mocked.
  return clauses as RoutingRule;
};

// Routing, variable interpolation, path, and download logic are exercised elsewhere;
// option.ts only needs to call specific methods on them, so mock those with
// plain objects mutated in place (Object.assign), hoisted above the
// vi.mock() calls so the (cached, only-ever-invoked-once) mock factories
// close over stable references that later mutations stay visible through.
//
// CURRENT_BROWSER: chrome-detector now exports setCurrentBrowser (used by
// download-flow to flip the real live binding), but this suite resetModules +
// re-imports option.ts per test, which re-binds a fresh chrome-detector each
// time. A hoisted-holder getter is the stable control point across those
// re-binds (read at the conflictAction key's onLoad call time); re-grabbing the
// fresh setter on every re-import would be strictly more plumbing for no gain.
const mocks = vi.hoisted(() => ({
  currentBrowser: "UNKNOWN",
  router: {} as Record<string, any>,
  applyVariables: vi.fn(),
  Path: vi.fn(),
  Download: {} as Record<string, any>,
}));

vi.mock("../../src/platform/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get WEB_EXTENSION_CAPABILITIES() {
    return {
      conflictActionPrompt: mocks.currentBrowser === "CHROME",
      // Mirrors detectCapabilities: only Firefox validates a download filename
      // against its dangerous-extension list and rejects .url/.desktop (#207).
      shortcutFileExtensions: mocks.currentBrowser !== "FIREFOX",
    };
  },
}));
vi.mock("../../src/routing/router.ts", () => mocks.router);
vi.mock("../../src/routing/variable.ts", () => ({ applyVariables: mocks.applyVariables }));
vi.mock("../../src/routing/path.ts", () => ({ Path: mocks.Path }));
vi.mock("../../src/downloads/download-plan.ts", () => ({
  getRoutingMatches: (...args: unknown[]) => mocks.Download.getRoutingMatches(...args),
  getRoutingMatch: (...args: unknown[]) => mocks.Download.getRoutingMatch(...args),
}));

const setupGlobals = () => {
  mocks.currentBrowser = "UNKNOWN";
  Object.assign(mocks.router, {
    parseRules: vi.fn((v) => v),
    matchRule: vi.fn(),
    getCaptureMatches: vi.fn(),
    expandRenameTransform: vi.fn(async (transform: unknown) => transform),
    applyRenameTransform: vi.fn((value: string) => value),
  });
  mocks.applyVariables.mockReset();
  mocks.Path.mockReset();
  Object.assign(mocks.Download, { getRoutingMatches: vi.fn(), getRoutingMatch: vi.fn() });
  global.browser.storage.local.get = vi.fn(() => Promise.resolve({}));
  global.browser.storage.local.set = vi.fn(() => Promise.resolve());
};

describe("OptionsManagement", () => {
  let OptionsManagement: (typeof import("../../src/config/option.ts"))["OptionsManagement"];
  let previewRoutes: (typeof import("../../src/background/route-preview.ts"))["previewRoutes"];
  type SchemaKey = (typeof OptionsManagement)["OPTION_KEYS"][number];
  type LoadKey = SchemaKey & { onLoad(value: any): any };
  type SaveKey = SchemaKey & { onSave(value: any): any };

  beforeEach(async () => {
    vi.resetModules();
    setupGlobals();
    const optionModule = await import("../../src/config/option.ts");
    ({ previewRoutes } = await import("../../src/background/route-preview.ts"));
    OptionsManagement = optionModule.OptionsManagement;
    // Seed defaults the way the entry does before loadOptions overlays storage.
    optionModule.seedOptions();
  });

  describe("getKeys", () => {
    test("returns every declared option name", () => {
      const keys = OptionsManagement.getKeys();
      expect(keys).toContain("conflictAction");
      expect(keys).toContain("filenamePatterns");
      expect(keys.length).toBe(OptionsManagement.OPTION_KEYS.length);
    });
  });

  describe("OPTION_DESCRIPTIONS", () => {
    test("every option has a one-line description (surfaced by GET_SCHEMA)", () => {
      OptionsManagement.OPTION_KEYS.forEach((k) => {
        expect(typeof OptionsManagement.OPTION_DESCRIPTIONS[k.name]).toBe("string");
        expect(OptionsManagement.OPTION_DESCRIPTIONS[k.name].length).toBeGreaterThan(0);
      });
    });
  });

  describe("defaults", () => {
    test("every option is seeded with its declared default", async () => {
      const resolved = await OptionsManagement.loadOptions();
      OptionsManagement.OPTION_KEYS.forEach((k) => {
        expect(resolved[k.name]).toBe(k.default);
      });
    });

    test("disables Page Sources for new profiles", async () => {
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.sourcePanelEnabled).toBe(false);
    });

    test("sends credentials from extension fetches for new profiles", async () => {
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.includeFetchCredentials).toBe(true);
    });

    test("uses the browser locale unless an available AI locale is selected", async () => {
      expect((await OptionsManagement.loadOptions()).uiLocale).toBe("");
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ uiLocale: "en" }));
      expect((await OptionsManagement.loadOptions()).uiLocale).toBe("en");
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ uiLocale: "zh_TW" }));
      expect((await OptionsManagement.loadOptions()).uiLocale).toBe("zh_TW");
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ uiLocale: "unknown" }));
      expect((await OptionsManagement.loadOptions()).uiLocale).toBe("");
    });

    test("enables credentials for legacy profiles without a stored preference", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          fallbackFetch: true,
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.includeFetchCredentials).toBe(true);
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    });

    test("preserves an explicit fetch-credentials preference without migration", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          fallbackFetch: true,
          includeFetchCredentials: false,
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.includeFetchCredentials).toBe(false);
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    });

    test("splits the legacy routing-only setting without changing its behavior", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          routeExclusive: true,
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.routeExclusive).toBe(false);
      expect(resolved.routeHideFolderChoices).toBe(true);
      expect(resolved.routeSkipUnmatched).toBe(true);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        routeExclusive: false,
        routeHideFolderChoices: true,
        routeSkipUnmatched: true,
      });
    });

    test("preserves explicit split routing behavior during legacy cleanup", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          routeExclusive: true,
          routeHideFolderChoices: false,
          routeSkipUnmatched: true,
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.routeHideFolderChoices).toBe(false);
      expect(resolved.routeSkipUnmatched).toBe(true);
    });

    test("automatically records the UTF-8 byte migration for a legacy truncation setting", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ truncateLength: 999 }));
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.truncateLength).toBe(999);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        truncateLength: 999,
        [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
      });
    });

    test("does not repeat the path truncation migration", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          truncateLength: 200,
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      expect((await OptionsManagement.loadOptions()).truncateLength).toBe(200);
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    });

    test("loads options when the path truncation marker cannot be persisted", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ truncateLength: 200 }));
      global.browser.storage.local.set = vi.fn(() =>
        Promise.reject(new Error("storage quota exceeded")),
      );

      await expect(OptionsManagement.loadOptions()).resolves.toEqual(
        expect.objectContaining({ truncateLength: 200 }),
      );
    });

    test("starts new profiles with a small useful Downloads menu", async () => {
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.paths).toBe(". // (alias: Downloads)\nImages\nVideos\nAudio\nDocuments");
    });

    test("preserves an existing enabled Page Sources preference", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ sourcePanelEnabled: true }));
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.sourcePanelEnabled).toBe(true);
    });

    test("restores defaults when previously stored keys are removed", async () => {
      global.browser.storage.local.get = vi
        .fn()
        .mockResolvedValueOnce({
          prompt: true,
          links: false,
          sourcePanelEnabled: true,
          notifyDuration: 1200,
        })
        .mockResolvedValueOnce({});

      await OptionsManagement.loadOptions();
      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.prompt).toBe(false);
      expect(resolved.links).toBe(true);
      expect(resolved.sourcePanelEnabled).toBe(false);
      expect(resolved.notifyDuration).toBe(7000);
    });
  });

  describe("conflictAction validation (#89/#217)", () => {
    const conflictKey = () =>
      OptionsManagement.OPTION_KEYS.find((k) => k.name === "conflictAction")! as LoadKey;

    // Firefox never implemented the "prompt" conflict action and fails the
    // download outright, which is what #89/#217 reported; Chrome has had it
    // since 28. An imported profile must not carry prompt onto Firefox.
    test("downgrades the Chrome-only 'prompt' to 'uniquify' on Firefox", () => {
      mocks.currentBrowser = "FIREFOX";
      expect(conflictKey().onLoad("prompt")).toBe("uniquify");
      expect(conflictKey().onLoad("overwrite")).toBe("overwrite");
    });

    test("keeps 'prompt' on Chrome", () => {
      mocks.currentBrowser = "CHROME";
      expect(conflictKey().onLoad("prompt")).toBe("prompt");
    });
  });

  // Firefox 112 (bug 1815062 / CVE-2023-29542) moved the dangerous-extension
  // check into the sanitizer downloads.download validates against, so a
  // filename ending .url or .desktop fails the whole download with "filename
  // must not contain illegal characters" — #207 verbatim, reproduced on a
  // current Firefox. Firefox always passes filename (browserFilenameResolution
  // is Chrome-only), so it always gets validated.
  describe("shortcutType validation (#207)", () => {
    const shortcutKey = () =>
      OptionsManagement.OPTION_KEYS.find((k) => k.name === "shortcutType")! as LoadKey;

    test.each(["WINDOWS", "MAC", "FREEDESKTOP"])(
      "downgrades %s to the HTML redirect on Firefox, which refuses its extension",
      (type) => {
        mocks.currentBrowser = "FIREFOX";
        expect(shortcutKey().onLoad(type)).toBe("HTML_REDIRECT");
      },
    );

    test("leaves the formats Firefox accepts alone", () => {
      mocks.currentBrowser = "FIREFOX";
      // .webloc and .html are not on the dangerous list; both save fine.
      expect(shortcutKey().onLoad("MAC_WEBLOC")).toBe("MAC_WEBLOC");
      expect(shortcutKey().onLoad("HTML_REDIRECT")).toBe("HTML_REDIRECT");
    });

    test("keeps every format on Chrome", () => {
      mocks.currentBrowser = "CHROME";
      expect(shortcutKey().onLoad("WINDOWS")).toBe("WINDOWS");
      expect(shortcutKey().onLoad("FREEDESKTOP")).toBe("FREEDESKTOP");
    });
  });

  describe("replacementChar validation", () => {
    const replacementCharKey = () =>
      OptionsManagement.OPTION_KEYS.find((k) => k.name === "replacementChar")! as LoadKey;

    test("falls back to '_' for forbidden filesystem characters", () => {
      expect(replacementCharKey().onLoad("/")).toBe("_");
      expect(replacementCharKey().onLoad("\\")).toBe("_");
      expect(replacementCharKey().onLoad(":")).toBe("_");
      expect(replacementCharKey().onLoad("*")).toBe("_");
      expect(replacementCharKey().onLoad("?")).toBe("_");
      expect(replacementCharKey().onLoad("<")).toBe("_");
      expect(replacementCharKey().onLoad(">")).toBe("_");
      expect(replacementCharKey().onLoad('"')).toBe("_");
      expect(replacementCharKey().onLoad("|")).toBe("_");
    });

    test("falls back to '_' for control characters", () => {
      expect(replacementCharKey().onLoad("\n")).toBe("_");
      expect(replacementCharKey().onLoad("\t")).toBe("_");
      expect(replacementCharKey().onLoad("\x00")).toBe("_");
    });

    test("falls back to '_' for invisible format characters", () => {
      expect(replacementCharKey().onLoad("\u200b")).toBe("_");
      expect(replacementCharKey().onLoad("\ufe0f")).toBe("_");
    });

    test("falls back to '_' for dot-segments", () => {
      expect(replacementCharKey().onLoad(".")).toBe("_");
      expect(replacementCharKey().onLoad("..")).toBe("_");
    });

    test("falls back to '_' when a forbidden character appears amid other characters", () => {
      expect(replacementCharKey().onLoad("a/b")).toBe("_");
    });

    test("keeps an empty string (means: delete the offending character)", () => {
      expect(replacementCharKey().onLoad("")).toBe("");
    });

    test("keeps an ordinary custom replacement character untouched", () => {
      expect(replacementCharKey().onLoad("x")).toBe("x");
      expect(replacementCharKey().onLoad("-")).toBe("-");
      expect(replacementCharKey().onLoad("_")).toBe("_");
    });
  });

  describe("onSave hooks", () => {
    test("filenamePatterns are trimmed on save", () => {
      const key = OptionsManagement.OPTION_KEYS.find(
        (k) => k.name === "filenamePatterns",
      )! as SaveKey;
      expect(key.onSave("  pageurl: .*\ninto: dir  ")).toBe("pageurl: .*\ninto: dir");
    });

    test("paths are trimmed on save and default to the downloads directory", () => {
      const key = OptionsManagement.OPTION_KEYS.find((k) => k.name === "paths")! as SaveKey;
      expect(key.onSave("  images  ")).toBe("images");
      expect(key.onSave("   ")).toBe(".");
    });

    test("external download allowlists are trimmed on save", () => {
      const key = OptionsManagement.OPTION_KEYS.find(
        (k) => k.name === "externalDownloadAllowlist",
      )! as SaveKey;
      expect(key.onSave("  extension-one\nextension-two  \n")).toBe("extension-one\nextension-two");
    });

    test.each([
      ["truncateLength", "239.6", 240],
      ["truncateLength", 999, 999],
      ["notifyDuration", "7000.4", 7000],
    ])("normalizes %s input to a whole number", (name, input, expected) => {
      const key = OptionsManagement.OPTION_KEYS.find((k) => k.name === name)! as SaveKey;
      expect(key.onSave(input)).toBe(expected);
    });

    test("validates nonnegative numeric settings at their schema boundary", () => {
      const key = OptionsManagement.OPTION_KEYS.find(
        ({ name }) => name === "notifyDuration",
      )! as SaveKey & { validate(value: unknown): boolean };

      expect(key.validate(true)).toBe(false);
      expect(key.validate(" ")).toBe(false);
      expect(key.validate("12")).toBe(true);
      expect(key.validate(Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(key.validate(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
      expect(key.validate("1e100")).toBe(false);
    });

    test("validates locale options and preserves legacy shortcut types on load", () => {
      const locale = OptionsManagement.OPTION_KEYS.find(({ name }) => name === "uiLocale")! as {
        validate(value: unknown): boolean;
      };
      const shortcut = OptionsManagement.OPTION_KEYS.find(
        ({ name }) => name === "shortcutType",
      )! as LoadKey;

      expect(locale.validate(7)).toBe(false);
      expect(locale.validate("")).toBe(true);
      expect(locale.validate("fr")).toBe(true);
      expect(shortcut.onLoad("HTML_REDIRECT")).toBe("HTML_REDIRECT");
    });
  });

  test("loads legacy numeric strings and fractional numbers as whole values", async () => {
    global.browser.storage.local.get = vi.fn(() =>
      Promise.resolve({ truncateLength: "239.6", notifyDuration: 7000.4 }),
    );
    const resolved = await OptionsManagement.loadOptions();
    expect(resolved.truncateLength).toBe(240);
    expect(resolved.notifyDuration).toBe(7000);
  });

  describe("setOption", () => {
    test("sets the option when a value is provided", async () => {
      OptionsManagement.setOption("conflictAction", "overwrite");
      const { options } = await import("../../src/config/options-data.ts");
      expect(options.conflictAction).toBe("overwrite");
    });

    test("leaves the option untouched when the value is undefined", async () => {
      OptionsManagement.setOption("conflictAction", "overwrite");
      OptionsManagement.setOption("conflictAction", undefined);
      const { options } = await import("../../src/config/options-data.ts");
      expect(options.conflictAction).toBe("overwrite");
    });
  });

  describe("checkRoutes", () => {
    test("returns nulls when there is no state (SW restart, nothing downloaded yet)", async () => {
      expect(await previewRoutes(null)).toEqual({ path: null, captures: null });
      expect(await previewRoutes(undefined)).toEqual({
        path: null,
        captures: null,
      });
    });

    test("builds the routing preview from a download state", async () => {
      const ruleA = routingRule("rule-a");
      const ruleB = routingRule("rule-b");
      OptionsManagement.setOption("filenamePatterns", [ruleA, ruleB]);

      // The preview mirrors the pipeline's own unfiltered match: path and
      // captures both come from the single winning rule (fetch rules incl.).
      mocks.Download.getRoutingMatch.mockReturnValue({
        rule: ruleB,
        destination: "routed/dir",
        fetch: null,
      });
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation((path: { routingMatches: unknown }) => ({
        finalize: () => `finalized:${path.routingMatches}`,
      }));
      mocks.router.getCaptureMatches.mockReturnValueOnce(["cap1"]);

      const state = { info: { filename: "photo.png", url: "https://x/photo.png" } };

      const result = await previewRoutes(state);

      expect(mocks.Download.getRoutingMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.objectContaining({
            filename: "photo.png",
            filenamePatterns: [ruleA, ruleB],
            now: expect.any(Date),
          }),
        }),
      );
      expect(mocks.Path).toHaveBeenCalledWith("routed/dir");
      expect(mocks.applyVariables).toHaveBeenCalledWith(
        expect.objectContaining({ routingMatches: "routed/dir" }),
        expect.objectContaining({ filename: "photo.png", now: expect.any(Date) }),
      );

      expect(mocks.router.getCaptureMatches).toHaveBeenCalledOnce();
      expect(mocks.router.getCaptureMatches).toHaveBeenCalledWith(
        ruleB,
        expect.objectContaining({ filename: "photo.png" }),
      );

      expect(result).toEqual({ path: "finalized:routed/dir", captures: ["cap1"] });
    });

    test("applies the winning rule's rename to the previewed final component", async () => {
      const rule = routingRule("rule-a");
      OptionsManagement.setOption("filenamePatterns", [rule]);
      mocks.Download.getRoutingMatch.mockReturnValue({
        rule,
        destination: "routed/name.txt",
        fetch: null,
        rename: { find: "name", flags: "", replacement: ":pagedomain:" },
      });
      mocks.router.expandRenameTransform = vi.fn(async (transform: Record<string, string>) => ({
        ...transform,
        replacement: "example.com",
      }));
      mocks.router.applyRenameTransform = vi.fn((value: string) => `renamed(${value})`);
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      const finalize = vi.fn(
        (options: { transformFinalComponent?: (value: string) => string }) =>
          options.transformFinalComponent?.("name.txt") ?? "no-transform",
      );
      mocks.applyVariables.mockImplementation(() => ({ finalize }));

      const result = await previewRoutes({
        info: { filename: "name.txt", url: "https://x/name.txt" },
      });

      // The replacement expands in preview mode before the transform applies.
      expect(mocks.router.expandRenameTransform).toHaveBeenCalledWith(
        { find: "name", flags: "", replacement: ":pagedomain:" },
        expect.objectContaining({ preview: true }),
      );
      expect(finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          finalComponentIsFilename: true,
          transformFinalComponent: expect.any(Function),
        }),
      );
      expect(mocks.router.applyRenameTransform).toHaveBeenCalledWith("name.txt", {
        find: "name",
        flags: "",
        replacement: "example.com",
      });
      expect(result.path).toBe("renamed(name.txt)");
    });

    test("a folder-only route ignores the rename in the preview path", async () => {
      const rule = routingRule("rule-a");
      OptionsManagement.setOption("filenamePatterns", [rule]);
      mocks.Download.getRoutingMatch.mockReturnValue({
        rule,
        destination: "routed/dir/",
        fetch: null,
        rename: { find: "a", flags: "", replacement: "b" },
      });
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      const finalize = vi.fn(() => "routed/dir/");
      mocks.applyVariables.mockImplementation(() => ({ finalize }));

      await previewRoutes({ info: { filename: "name.txt", url: "https://x/name.txt" } });

      // The folder route keeps the download's own name, so the previewed
      // directory must not receive the filename transform.
      expect(finalize).toHaveBeenCalledWith(
        expect.not.objectContaining({ transformFinalComponent: expect.anything() }),
      );
    });

    test("prefers initialFilename over filename (Chrome mutates filename with `_`)", async () => {
      OptionsManagement.setOption("filenamePatterns", []);
      mocks.Download.getRoutingMatch.mockReturnValue(null);
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));

      const now = new Date("2026-07-14T00:00:00.000Z");
      const state = {
        info: {
          filename: "sanitized_.png",
          initialFilename: "café.png",
          url: "https://x/f.png",
          now,
        },
      };

      await previewRoutes(state);

      expect(mocks.Download.getRoutingMatch).toHaveBeenCalledWith(
        expect.objectContaining({ info: expect.objectContaining({ filename: "café.png", now }) }),
      );
    });

    test("falls back to url for capture matching when there is no filename", async () => {
      const onlyRule = routingRule("only-rule");
      OptionsManagement.setOption("filenamePatterns", [onlyRule]);
      mocks.Download.getRoutingMatch.mockReturnValue({
        rule: onlyRule,
        destination: "routed/dir",
        fetch: null,
      });
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));
      mocks.router.getCaptureMatches.mockReturnValue(null);

      const state = { info: { url: "https://x/nofilename" } };

      const result = await previewRoutes(state);

      expect(mocks.router.getCaptureMatches).toHaveBeenCalledWith(
        onlyRule,
        expect.objectContaining({ url: "https://x/nofilename" }),
      );
      expect(result.captures).toBeNull();
    });

    test("tolerates an unnormalized rule value and an unmatched route", async () => {
      OptionsManagement.setOption("filenamePatterns", "legacy value" as never);
      mocks.Download.getRoutingMatch.mockReturnValue(null);
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation(() => ({ finalize: vi.fn(() => "fallback") }));

      await expect(previewRoutes({ info: { pageUrl: "https://example.test" } })).resolves.toEqual({
        path: "fallback",
        captures: null,
      });
    });
  });

  describe("loadOptions", () => {
    test("requests every option key from storage", async () => {
      await OptionsManagement.loadOptions();
      expect(global.browser.storage.local.get).toHaveBeenCalledWith([
        ...OptionsManagement.getKeys(),
        PATH_TRUNCATION_MIGRATION_STORAGE_KEY,
      ]);
    });

    test("applies each stored value's onLoad transform, defaulting to identity", async () => {
      mocks.router.parseRules.mockReturnValue("PARSED_RULES");
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ filenamePatterns: "raw-pattern-source", conflictAction: "overwrite" }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(mocks.router.parseRules).toHaveBeenCalledWith("raw-pattern-source");
      expect(resolved.filenamePatterns).toBe("PARSED_RULES");
      expect(resolved.conflictAction).toBe("overwrite");
    });

    test("moves legacy automatic rules into the shared routing rule list", async () => {
      mocks.router.parseRules.mockImplementation((value: string) => value);
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          filenamePatterns: "filename: pdf\ninto: documents/",
          autoDownloadRules:
            "name: Gallery\npageurl: example\\.com\nsourcekind: image\ninto: gallery/",
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );

      const resolved = await OptionsManagement.loadOptions();

      const migrated = [
        "filename: pdf",
        "into: documents/",
        "",
        "// Gallery",
        "context: ^auto$",
        "pageurl: example\\.com",
        "sourcekind: image",
        "into: gallery/",
      ].join("\n");
      expect(resolved.filenamePatterns).toBe(migrated);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        filenamePatterns: migrated,
        autoDownloadRules: "",
      });
    });

    test("loads a migrated automatic rule when cleanup persistence fails", async () => {
      mocks.router.parseRules.mockImplementation((value: string) => value);
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          autoDownloadRules: "pageurl: example\\.com\nsourcekind: image\ninto: gallery/",
          [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
        }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.reject(new Error("quota")));

      await expect(OptionsManagement.loadOptions()).resolves.toEqual(
        expect.objectContaining({ filenamePatterns: expect.stringContaining("context: ^auto$") }),
      );
    });

    test("sanitizes a forbidden stored replacementChar", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ replacementChar: "/" }));
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.replacementChar).toBe("_");
    });

    test("extends the untouched Pixiv Referer preset for MangaDex (#218)", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ setRefererHeaderFilter: "*://i.pximg.net/*" }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.setRefererHeaderFilter).toBe("*://i.pximg.net/*\n*://*.mangadex.network/*");
    });

    test("preserves a customized Referer filter", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ setRefererHeaderFilter: "*://media.example/*" }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.setRefererHeaderFilter).toBe("*://media.example/*");
    });

    test("falls back to defaults for malformed stored value types", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ notifyOnSuccess: "yes", notifyDuration: "forever", paths: null }),
      );
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.notifyOnSuccess).toBe(true);
      expect(resolved.notifyDuration).toBe(7000);
      expect(resolved.paths).toContain("Downloads");
    });

    test("keeps MV2 numeric click-to-save keycodes", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ contentClickToSaveCombo: 18 }),
      );
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.contentClickToSaveCombo).toBe(18);
    });

    test("falls back for unknown enum values and invalid numeric ranges", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          conflictAction: "destroy",
          contentClickToSaveButton: "DOUBLE_CLICK",
          shortcutType: "PDF",
          notifyDuration: -1,
          truncateLength: Number.NaN,
        }),
      );
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.conflictAction).toBe("uniquify");
      expect(resolved.contentClickToSaveButton).toBe("LEFT_CLICK");
      expect(resolved.shortcutType).toBe("HTML_REDIRECT");
      expect(resolved.notifyDuration).toBe(7000);
      expect(resolved.truncateLength).toBe(240);
    });

    test("falls back from whole-number settings outside the safe integer range", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({
          notifyDuration: Number.MAX_SAFE_INTEGER + 1,
          truncateLength: "1e100",
        }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.notifyDuration).toBe(7000);
      expect(resolved.truncateLength).toBe(240);
    });

    test("tolerates a storage backend returning null", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve(null as any));
      await expect(OptionsManagement.loadOptions()).resolves.toEqual(
        expect.objectContaining({ conflictAction: "uniquify", notifyDuration: 7000 }),
      );
    });

    test("falls back when an onLoad migration rejects corrupt data", async () => {
      mocks.router.parseRules.mockImplementation(() => {
        throw new Error("bad rules");
      });
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ filenamePatterns: "broken" }),
      );
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.filenamePatterns).toBe("");
    });
  });
});

describe("loadOptions resilience", () => {
  test("ignores unknown stored keys instead of throwing", async () => {
    vi.resetModules();
    setupGlobals();
    const OptionsManagement = (await import("../../src/config/option.ts")).OptionsManagement;
    global.browser.storage.local.get = vi.fn(() =>
      Promise.resolve({ conflictAction: "overwrite", someRemovedOption: 1 }),
    );

    const loaded = await OptionsManagement.loadOptions();
    expect(loaded.conflictAction).toBe("overwrite");
  });
});
