// OptionsManagement: option schema/defaults and storage normalization. The
// background route-preview service is exercised here against the same routing
// dependency fakes because it consumes the normalized options bag.

import * as constants from "../src/shared/constants.ts";
import type { RoutingRule } from "../src/routing/router.ts";

const routingRule = (name: string): RoutingRule => [
  { name, value: ".*", type: constants.RULE_TYPES.MATCHER },
];

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

vi.mock("../src/platform/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get WEB_EXTENSION_CAPABILITIES() {
    return { conflictActionPrompt: mocks.currentBrowser === "FIREFOX" };
  },
}));
vi.mock("../src/routing/router.ts", () => mocks.router);
vi.mock("../src/routing/variable.ts", () => ({ applyVariables: mocks.applyVariables }));
vi.mock("../src/routing/path.ts", () => ({ Path: mocks.Path }));
vi.mock("../src/downloads/download.ts", () => ({ Download: mocks.Download }));

const setupGlobals = () => {
  mocks.currentBrowser = "UNKNOWN";
  Object.assign(mocks.router, { parseRules: vi.fn((v) => v), getCaptureMatches: vi.fn() });
  mocks.applyVariables.mockReset();
  mocks.Path.mockReset();
  Object.assign(mocks.Download, { getRoutingMatches: vi.fn() });
  global.browser.storage.local.get = vi.fn(() => Promise.resolve({}));
};

describe("OptionsManagement", () => {
  let OptionsManagement: (typeof import("../src/config/option.ts"))["OptionsManagement"];
  let previewRoutes: (typeof import("../src/background/route-preview.ts"))["previewRoutes"];
  type SchemaKey = (typeof OptionsManagement)["OPTION_KEYS"][number];
  type LoadKey = SchemaKey & { onLoad(value: any): any };
  type SaveKey = SchemaKey & { onSave(value: any): any };

  beforeEach(async () => {
    vi.resetModules();
    setupGlobals();
    const optionModule = await import("../src/config/option.ts");
    ({ previewRoutes } = await import("../src/background/route-preview.ts"));
    OptionsManagement = optionModule.OptionsManagement;
    // Seeding is deferred out of module eval (Task #2); seed defaults here the
    // way the entry does at startup, so loadOptions overlays storage onto them.
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
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ fallbackFetch: true }));
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.includeFetchCredentials).toBe(true);
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    });

    test("preserves an explicit fetch-credentials preference without migration", async () => {
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ fallbackFetch: true, includeFetchCredentials: false }),
      );
      global.browser.storage.local.set = vi.fn(() => Promise.resolve());

      const resolved = await OptionsManagement.loadOptions();

      expect(resolved.includeFetchCredentials).toBe(false);
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    });

    test("starts new profiles with a small useful Downloads menu", async () => {
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.paths).toBe(
        ". // (alias: Downloads)\nimages\nimages/cats\n>images/cats/tabby\nvideos",
      );
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

    test("downgrades the Firefox-only 'prompt' to 'uniquify' on Chrome", () => {
      mocks.currentBrowser = "CHROME";
      expect(conflictKey().onLoad("prompt")).toBe("uniquify");
      expect(conflictKey().onLoad("overwrite")).toBe("overwrite");
    });

    test("keeps 'prompt' on Firefox", () => {
      mocks.currentBrowser = "FIREFOX";
      expect(conflictKey().onLoad("prompt")).toBe("prompt");
    });
  });

  describe("replacementChar validation (#221)", () => {
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
      ["notifyDuration", "7000.4", 7000],
    ])("normalizes %s input to a whole number", (name, input, expected) => {
      const key = OptionsManagement.OPTION_KEYS.find((k) => k.name === name)! as SaveKey;
      expect(key.onSave(input)).toBe(expected);
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
      const { options } = await import("../src/config/options-data.ts");
      expect(options.conflictAction).toBe("overwrite");
    });

    test("leaves the option untouched when the value is undefined", async () => {
      OptionsManagement.setOption("conflictAction", "overwrite");
      OptionsManagement.setOption("conflictAction", undefined);
      const { options } = await import("../src/config/options-data.ts");
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

      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation((path: { routingMatches: unknown }) => ({
        finalize: () => `finalized:${path.routingMatches}`,
      }));
      mocks.router.getCaptureMatches
        .mockReturnValueOnce(null) // rule-a: no match, loop continues
        .mockReturnValueOnce(["cap1"]); // rule-b: match, loop breaks

      const state = { info: { filename: "photo.png", url: "https://x/photo.png" } };

      const result = await previewRoutes(state);

      expect(mocks.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.objectContaining({
            filename: "photo.png",
            filenamePatterns: [ruleA, ruleB],
          }),
        }),
      );
      expect(mocks.Path).toHaveBeenCalledWith("routed/dir");
      expect(mocks.applyVariables).toHaveBeenCalledWith(
        expect.objectContaining({ routingMatches: "routed/dir" }),
        expect.objectContaining({ filename: "photo.png" }),
      );

      expect(mocks.router.getCaptureMatches).toHaveBeenCalledTimes(2);
      expect(mocks.router.getCaptureMatches).toHaveBeenNthCalledWith(
        1,
        ruleA,
        expect.objectContaining({ filename: "photo.png" }),
      );
      expect(mocks.router.getCaptureMatches).toHaveBeenNthCalledWith(
        2,
        ruleB,
        expect.objectContaining({ filename: "photo.png" }),
      );

      expect(result).toEqual({ path: "finalized:routed/dir", captures: ["cap1"] });
    });

    test("prefers initialFilename over filename (Chrome mutates filename with `_`)", async () => {
      OptionsManagement.setOption("filenamePatterns", []);
      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
      mocks.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));

      const state = {
        info: { filename: "sanitized_.png", initialFilename: "café.png", url: "https://x/f.png" },
      };

      await previewRoutes(state);

      expect(mocks.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({ info: expect.objectContaining({ filename: "café.png" }) }),
      );
    });

    test("falls back to url for capture matching when there is no filename", async () => {
      const onlyRule = routingRule("only-rule");
      OptionsManagement.setOption("filenamePatterns", [onlyRule]);
      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
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
  });

  describe("loadOptions", () => {
    test("requests every option key from storage", async () => {
      await OptionsManagement.loadOptions();
      expect(global.browser.storage.local.get).toHaveBeenCalledWith(OptionsManagement.getKeys());
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

    test("sanitizes a forbidden stored replacementChar (#221)", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ replacementChar: "/" }));
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.replacementChar).toBe("_");
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
    const OptionsManagement = (await import("../src/config/option.ts")).OptionsManagement;
    global.browser.storage.local.get = vi.fn(() =>
      Promise.resolve({ conflictAction: "overwrite", someRemovedOption: 1 }),
    );

    const loaded = await OptionsManagement.loadOptions();
    expect(loaded.conflictAction).toBe("overwrite");
  });
});
