// OptionsManagement: option schema/defaults, storage load, and the routing
// dry-run used by the options page's "check routes" preview

const constants = (await import("../src/constants.js")).default;
Object.assign(global, constants);

const setupGlobals = () => {
  global.Router = { parseRules: vi.fn((v) => v), getCaptureMatches: vi.fn() };
  global.Variable = { applyVariables: vi.fn() };
  global.Path = { Path: vi.fn() };
  global.Download = { getRoutingMatches: vi.fn() };
  global.browser.storage.local.get = vi.fn(() => Promise.resolve({}));
  delete global.window.SI_DEBUG;
};

describe("OptionsManagement", () => {
  let OptionsManagement;

  beforeEach(async () => {
    jest.resetModules();
    setupGlobals();
    OptionsManagement = (await import("../src/option.js")).default;
  });

  describe("getKeys", () => {
    test("returns every declared option name", () => {
      const keys = OptionsManagement.getKeys();
      expect(keys).toContain("conflictAction");
      expect(keys).toContain("filenamePatterns");
      expect(keys.length).toBe(OptionsManagement.OPTION_KEYS.length);
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
      OptionsManagement.OPTION_KEYS.find((k) => k.name === "conflictAction");

    test("downgrades the Firefox-only 'prompt' to 'uniquify' on Chrome", () => {
      global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
      global.CURRENT_BROWSER = "CHROME";
      expect(conflictKey().onLoad("prompt")).toBe("uniquify");
      expect(conflictKey().onLoad("overwrite")).toBe("overwrite");
    });

    test("keeps 'prompt' on Firefox", () => {
      global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
      global.CURRENT_BROWSER = "FIREFOX";
      expect(conflictKey().onLoad("prompt")).toBe("prompt");
    });
  });

  describe("replacementChar validation (#221)", () => {
    const replacementCharKey = () =>
      OptionsManagement.OPTION_KEYS.find((k) => k.name === "replacementChar");

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
      const key = OptionsManagement.OPTION_KEYS.find((k) => k.name === "filenamePatterns");
      expect(key.onSave("  pageurl: .*\ninto: dir  ")).toBe("pageurl: .*\ninto: dir");
    });

    test("paths are trimmed on save and default to the downloads directory", () => {
      const key = OptionsManagement.OPTION_KEYS.find((k) => k.name === "paths");
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
    test("returns nulls when there is no state (SW restart, nothing downloaded yet)", () => {
      expect(OptionsManagement.checkRoutes(null)).toEqual({ path: null, captures: null });
      expect(OptionsManagement.checkRoutes(undefined)).toEqual({ path: null, captures: null });
    });

    test("builds the routing preview from a download state", () => {
      OptionsManagement.setOption("filenamePatterns", ["rule-a", "rule-b"]);

      global.Download.getRoutingMatches.mockReturnValue("routed/dir");
      global.Path.Path.mockImplementation(function fakePath(routingMatches) {
        this.routingMatches = routingMatches;
      });
      global.Variable.applyVariables.mockImplementation((path) => ({
        finalize: () => `finalized:${path.routingMatches}`,
      }));
      global.Router.getCaptureMatches
        .mockReturnValueOnce(null) // rule-a: no match, loop continues
        .mockReturnValueOnce(["cap1"]); // rule-b: match, loop breaks

      const state = { info: { filename: "photo.png", url: "https://x/photo.png" } };

      const result = OptionsManagement.checkRoutes(state);

      expect(global.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.objectContaining({
            filename: "photo.png",
            filenamePatterns: ["rule-a", "rule-b"],
          }),
        }),
      );
      expect(global.Path.Path).toHaveBeenCalledWith("routed/dir");
      expect(global.Variable.applyVariables).toHaveBeenCalledWith(
        expect.objectContaining({ routingMatches: "routed/dir" }),
        expect.objectContaining({ filename: "photo.png" }),
      );

      expect(global.Router.getCaptureMatches).toHaveBeenCalledTimes(2);
      expect(global.Router.getCaptureMatches).toHaveBeenNthCalledWith(
        1,
        "rule-a",
        expect.objectContaining({ filename: "photo.png" }),
        "photo.png",
      );
      expect(global.Router.getCaptureMatches).toHaveBeenNthCalledWith(
        2,
        "rule-b",
        expect.objectContaining({ filename: "photo.png" }),
        "photo.png",
      );

      expect(result).toEqual({ path: "finalized:routed/dir", captures: ["cap1"] });
    });

    test("prefers initialFilename over filename (Chrome mutates filename with `_`)", () => {
      OptionsManagement.setOption("filenamePatterns", []);
      global.Download.getRoutingMatches.mockReturnValue("routed/dir");
      global.Path.Path.mockImplementation(function fakePath(routingMatches) {
        this.routingMatches = routingMatches;
      });
      global.Variable.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));

      const state = {
        info: { filename: "sanitized_.png", initialFilename: "café.png", url: "https://x/f.png" },
      };

      OptionsManagement.checkRoutes(state);

      expect(global.Download.getRoutingMatches).toHaveBeenCalledWith(
        expect.objectContaining({ info: expect.objectContaining({ filename: "café.png" }) }),
      );
    });

    test("falls back to url for capture matching when there is no filename", () => {
      OptionsManagement.setOption("filenamePatterns", ["only-rule"]);
      global.Download.getRoutingMatches.mockReturnValue("routed/dir");
      global.Path.Path.mockImplementation(function fakePath(routingMatches) {
        this.routingMatches = routingMatches;
      });
      global.Variable.applyVariables.mockImplementation(() => ({ finalize: () => "x" }));
      global.Router.getCaptureMatches.mockReturnValue(null);

      const state = { info: { url: "https://x/nofilename" } };

      const result = OptionsManagement.checkRoutes(state);

      expect(global.Router.getCaptureMatches).toHaveBeenCalledWith(
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
      global.Router.parseRules.mockReturnValue("PARSED_RULES");
      global.browser.storage.local.get = vi.fn(() =>
        Promise.resolve({ filenamePatterns: "raw-pattern-source", conflictAction: "overwrite" }),
      );

      const resolved = await OptionsManagement.loadOptions();

      expect(global.Router.parseRules).toHaveBeenCalledWith("raw-pattern-source");
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
    const OptionsManagement = (await import("../src/option.js")).default;
    global.browser.storage.local.get = jest.fn(() =>
      Promise.resolve({ conflictAction: "overwrite", someRemovedOption: 1 }),
    );

    const loaded = await OptionsManagement.loadOptions();
    expect(loaded.conflictAction).toBe("overwrite");
  });
});
