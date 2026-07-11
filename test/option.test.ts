// OptionsManagement: option schema/defaults, storage load, and the routing
// dry-run used by the options page's "check routes" preview

import * as constants from "../src/constants.ts";

// Router/Variable/Path/Download are heavy real modules exercised elsewhere;
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
  Router: {} as Record<string, any>,
  Variable: {} as Record<string, any>,
  Path: {} as Record<string, any>,
  Download: {} as Record<string, any>,
}));

vi.mock("../src/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get WEB_EXTENSION_CAPABILITIES() {
    return { conflictActionPrompt: mocks.currentBrowser === "FIREFOX" };
  },
}));
vi.mock("../src/router.ts", () => ({ Router: mocks.Router }));
vi.mock("../src/variable.ts", () => ({ Variable: mocks.Variable }));
vi.mock("../src/path.ts", () => ({ Path: mocks.Path }));
vi.mock("../src/download.ts", () => ({ Download: mocks.Download }));

Object.assign(global, constants);

const setupGlobals = () => {
  mocks.currentBrowser = "UNKNOWN";
  Object.assign(mocks.Router, { parseRules: vi.fn((v) => v), getCaptureMatches: vi.fn() });
  Object.assign(mocks.Variable, { applyVariables: vi.fn() });
  Object.assign(mocks.Path, { Path: vi.fn() });
  Object.assign(mocks.Download, { getRoutingMatches: vi.fn() });
  global.browser.storage.local.get = vi.fn(() => Promise.resolve({}));
  delete global.window.SI_DEBUG;
};

describe("OptionsManagement", () => {
  let OptionsManagement: (typeof import("../src/option.ts"))["OptionsManagement"];
  type SchemaKey = (typeof OptionsManagement)["OPTION_KEYS"][number];
  type LoadKey = SchemaKey & { onLoad(value: any): any };
  type SaveKey = SchemaKey & { onSave(value: any): any };

  beforeEach(async () => {
    jest.resetModules();
    setupGlobals();
    const optionModule = await import("../src/option.ts");
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
  });

  describe("setOption", () => {
    test("sets the option when a value is provided", async () => {
      OptionsManagement.setOption("conflictAction", "overwrite");
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.conflictAction).toBe("overwrite");
    });

    test("leaves the option untouched when the value is undefined", async () => {
      OptionsManagement.setOption("conflictAction", "overwrite");
      OptionsManagement.setOption("conflictAction", undefined);
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.conflictAction).toBe("overwrite");
    });
  });

  describe("checkRoutes", () => {
    test("returns nulls when there is no state (SW restart, nothing downloaded yet)", async () => {
      expect(await OptionsManagement.checkRoutes(null)).toEqual({ path: null, captures: null });
      expect(await OptionsManagement.checkRoutes(undefined)).toEqual({
        path: null,
        captures: null,
      });
    });

    test("builds the routing preview from a download state", async () => {
      OptionsManagement.setOption("filenamePatterns", ["rule-a", "rule-b"]);

      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
      mocks.Path.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.Variable.applyVariables.mockImplementation((path: { routingMatches: unknown }) => ({
        finalize: () => `finalized:${path.routingMatches}`,
      }));
      mocks.Router.getCaptureMatches
        .mockReturnValueOnce(null) // rule-a: no match, loop continues
        .mockReturnValueOnce(["cap1"]); // rule-b: match, loop breaks

      const state = { info: { filename: "photo.png", url: "https://x/photo.png" } };

      const result = await OptionsManagement.checkRoutes(state);

      expect(mocks.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.objectContaining({
            filename: "photo.png",
            filenamePatterns: ["rule-a", "rule-b"],
          }),
        }),
      );
      expect(mocks.Path.Path).toHaveBeenCalledWith("routed/dir");
      expect(mocks.Variable.applyVariables).toHaveBeenCalledWith(
        expect.objectContaining({ routingMatches: "routed/dir" }),
        expect.objectContaining({ filename: "photo.png" }),
      );

      expect(mocks.Router.getCaptureMatches).toHaveBeenCalledTimes(2);
      expect(mocks.Router.getCaptureMatches).toHaveBeenNthCalledWith(
        1,
        "rule-a",
        expect.objectContaining({ filename: "photo.png" }),
        "photo.png",
      );
      expect(mocks.Router.getCaptureMatches).toHaveBeenNthCalledWith(
        2,
        "rule-b",
        expect.objectContaining({ filename: "photo.png" }),
        "photo.png",
      );

      expect(result).toEqual({ path: "finalized:routed/dir", captures: ["cap1"] });
    });

    test("prefers initialFilename over filename (Chrome mutates filename with `_`)", async () => {
      OptionsManagement.setOption("filenamePatterns", []);
      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
      mocks.Path.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.Variable.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));

      const state = {
        info: { filename: "sanitized_.png", initialFilename: "café.png", url: "https://x/f.png" },
      };

      await OptionsManagement.checkRoutes(state);

      expect(mocks.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({ info: expect.objectContaining({ filename: "café.png" }) }),
      );
    });

    test("falls back to url for capture matching when there is no filename", async () => {
      OptionsManagement.setOption("filenamePatterns", ["only-rule"]);
      mocks.Download.getRoutingMatches.mockReturnValue("routed/dir");
      mocks.Path.Path.mockImplementation(function fakePath(
        this: { routingMatches: unknown },
        routingMatches: unknown,
      ) {
        this.routingMatches = routingMatches;
      });
      mocks.Variable.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));
      mocks.Router.getCaptureMatches.mockReturnValue(null);

      const state = { info: { url: "https://x/nofilename" } };

      const result = await OptionsManagement.checkRoutes(state);

      expect(mocks.Router.getCaptureMatches).toHaveBeenCalledWith(
        "only-rule",
        expect.objectContaining({ url: "https://x/nofilename" }),
        "https://x/nofilename",
      );
      expect(result.captures).toBeNull();
    });
  });

  describe("loadOptions", () => {
    test("requests every option key from storage", async () => {
      await OptionsManagement.loadOptions();
      expect(global.browser.storage.local.get).toHaveBeenCalledWith(OptionsManagement.getKeys());
    });

    test("sets window.SI_DEBUG when the stored debug flag is true", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ debug: true }));
      await OptionsManagement.loadOptions();
      expect(global.window.SI_DEBUG).toBe(1);
    });

    test("does not set window.SI_DEBUG when debug is false or absent", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ debug: false }));
      await OptionsManagement.loadOptions();
      expect(global.window.SI_DEBUG).toBeUndefined();
    });

    test("applies each stored value's onLoad transform, defaulting to identity", async () => {
      mocks.Router.parseRules.mockReturnValue("PARSED_RULES");
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ filenamePatterns: "raw-pattern-source", conflictAction: "overwrite" }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(mocks.Router.parseRules).toHaveBeenCalledWith("raw-pattern-source");
      expect(resolved.filenamePatterns).toBe("PARSED_RULES");
      expect(resolved.conflictAction).toBe("overwrite");
    });

    test("sanitizes a forbidden stored replacementChar (#221)", async () => {
      global.browser.storage.local.get = vi.fn(() => Promise.resolve({ replacementChar: "/" }));
      const resolved = await OptionsManagement.loadOptions();
      expect(resolved.replacementChar).toBe("_");
    });
  });
});

describe("loadOptions resilience", () => {
  test("ignores unknown stored keys instead of throwing", async () => {
    vi.resetModules();
    setupGlobals();
    const OptionsManagement = (await import("../src/option.ts")).OptionsManagement;
    global.browser.storage.local.get = jest.fn(() =>
      Promise.resolve({ conflictAction: "overwrite", someRemovedOption: 1 }),
    );

    const loaded = await OptionsManagement.loadOptions();
    expect(loaded.conflictAction).toBe("overwrite");
  });
});
