const constants = (await import("../src/constants.js")).default;

Object.assign(global, constants);
const router = (await import("../src/router.js")).default;
const Variable = (await import("../src/variable.js")).default;
const Path = (await import("../src/path.js")).default;

global.Path = Path;
global.Download = (await import("../src/download.js")).default;

describe("variables", () => {
  const specialDirs = global.SPECIAL_DIRS;
  const info = {
    url: "http://www.source.com/foobar/file.jpg",
    pageUrl: "http://www.example.com/foobar/",
    sourceUrl: "http://srcurl.com",
    linkText: "linkfoobar",
    selectionText: "selectionfoobar",
    currentTab: { title: "foobartitle" },
    filename: "lol.jpeg",
    now: new Date(),
  };

  beforeAll(() => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.RULE_TYPES = constants.RULE_TYPES;
    global.currentTab = { title: "foobartitle" };
    global.matchRules = router.matchRules;
    global.options = { replacementChar: "_" };
  });

  afterAll(() => {
    global.SPECIAL_DIRS = specialDirs;
    global.currentTab = undefined;
    global.matchRules = undefined;
  });

  describe("standard variables", () => {
    test("interpolates :date:", async () => {
      const input = new Path.Path(":date:/a/b");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(info.now.getFullYear()));
      expect(output.split("-")).toHaveLength(3);
    });

    test("interpolates :unixdate:", async () => {
      const timestamp = Math.floor(info.now / 1000);
      const input = new Path.Path(":unixdate:/a/b");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe(`${timestamp}/a/b`);
    });

    test("interpolates :isodate:", async () => {
      const now = new Date();
      const input = new Path.Path(":isodate:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getUTCFullYear()));
    });

    test("interpolates :pagedomain:", async () => {
      const input = new Path.Path("a/b/:pagedomain:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.example.com");
    });

    test("interpolates :sourcedomain:", async () => {
      const input = new Path.Path("a/b/:sourcedomain:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.source.com/c");
    });

    test("interpolates multiple :sourcedomain:s", async () => {
      const input = new Path.Path("a/b/:sourcedomain::sourcedomain:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/www.source.comwww.source.com/c");
    });

    test("interpolates multiple :sourceurl:", async () => {
      const input = new Path.Path("a/b/:sourceurl::sourceurl:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/http___srcurl.comhttp___srcurl.com/c");
    });

    test("interpolates :pageurl:", async () => {
      const input = new Path.Path("a/b/:pageurl:/c");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("a/b/http___www.example.com_foobar_/c");
    });

    test("interpolates :year:", async () => {
      const now = new Date();
      const input = new Path.Path(":year:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getFullYear()));
    });

    test("interpolates :month:", async () => {
      const now = new Date();
      const input = new Path.Path(":month:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getMonth() + 1));
    });

    test("interpolates :day:", async () => {
      const now = new Date();
      const input = new Path.Path(":day:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getDay()));
    });

    test("interpolates :hour:", async () => {
      const now = new Date();
      const input = new Path.Path(":hour:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getDay()));
    });

    test("interpolates :minute:", async () => {
      const now = new Date();
      const input = new Path.Path(":minute");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output.startsWith(now.getMinutes()));
    });

    test("interpolates :selectiontext:", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("selectionfoobar");
    });

    test("interpolates :filename:", async () => {
      const input = new Path.Path(":filename::filename:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("lol.jpeglol.jpeg");
    });

    test("interpolates :fileext:", async () => {
      const input = new Path.Path(":fileext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("jpeg");
    });

    test("interpolates :linktext:", async () => {
      const input = new Path.Path(":linktext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("linkfoobar");
    });

    test("interpolates :pagetitle:", async () => {
      const input = new Path.Path(":pagetitle:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("foobartitle");
    });
  });

  describe("root domain variables (GH #221)", () => {
    test("interpolates :pagerootdomain: stripped to the last two labels", async () => {
      const input = new Path.Path("a/b/:pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://sub.cdn.example.com/foobar/",
        })
      ).finalize();
      expect(output).toBe("a/b/example.com");
    });

    test("interpolates :sourcerootdomain: stripped to the last two labels", async () => {
      const input = new Path.Path("a/b/:sourcerootdomain:/c");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          url: "http://sub.cdn.example.com/foobar/file.jpg",
        })
      ).finalize();
      expect(output).toBe("a/b/example.com/c");
    });

    test("leaves a bare two-label domain unchanged", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://example.com/foobar/",
        })
      ).finalize();
      expect(output).toBe("example.com");
    });

    test("leaves a single-label host (e.g. localhost) unchanged", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          pageUrl: "http://localhost:8080/foobar/",
        })
      ).finalize();
      expect(output).toBe("localhost");
    });

    test("leaves an IPv4 address unchanged", async () => {
      const input = new Path.Path(":sourcerootdomain:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          url: "http://192.168.1.100/foobar/",
        })
      ).finalize();
      expect(output).toBe("192.168.1.100");
    });

    test("falls back to the raw string for an invalid page URL (withUrl catch)", async () => {
      const input = new Path.Path(":pagerootdomain:");
      const output = (
        await Variable.applyVariables(input, { ...info, pageUrl: "not a url" })
      ).finalize();
      expect(output).toBe("not a url");
    });

    test("falls back to the raw string for an invalid source URL (withUrl catch)", async () => {
      const input = new Path.Path(":sourcerootdomain:");
      const output = (
        await Variable.applyVariables(input, { ...info, url: "not a url" })
      ).finalize();
      expect(output).toBe("not a url");
    });
  });

  describe("Variable.toRootDomain", () => {
    test("strips subdomains to the last two labels", async () => {
      expect(Variable.toRootDomain("sub.cdn.example.com")).toBe("example.com");
    });

    test("leaves bare two-label domains unchanged", async () => {
      expect(Variable.toRootDomain("example.com")).toBe("example.com");
    });

    test("leaves single-label hosts unchanged", async () => {
      expect(Variable.toRootDomain("localhost")).toBe("localhost");
    });

    test("leaves IPv4 addresses unchanged", async () => {
      expect(Variable.toRootDomain("127.0.0.1")).toBe("127.0.0.1");
      expect(Variable.toRootDomain("192.168.1.100")).toBe("192.168.1.100");
    });

    test("leaves falsy input unchanged", async () => {
      expect(Variable.toRootDomain("")).toBe("");
      expect(Variable.toRootDomain(undefined)).toBeUndefined();
    });
  });

  describe("remaining variables and edge cases", () => {
    test("withUrl returns the input for invalid URLs", async () => {
      expect(Variable.withUrl("not a url", (url) => url.hostname)).toBe("not a url");
    });

    test("interpolates :minute: and :second:", async () => {
      const input = new Path.Path(":minute:/:second:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      const expected = [
        Variable.padDateComponent(info.now.getMinutes()),
        Variable.padDateComponent(info.now.getSeconds()),
      ].join("/");
      expect(output).toBe(expected);
    });

    test("interpolates :pagetitle: as empty without a tab", async () => {
      const input = new Path.Path(":pagetitle:");
      const output = (
        await Variable.applyVariables(input, { ...info, currentTab: undefined })
      ).finalize();
      expect(output).toBe("_");
    });

    test("interpolates :selectiontext: as empty when nothing is selected", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          selectionText: undefined,
        })
      ).finalize();
      expect(output).toBe("_");
    });

    test("trims :selectiontext:", async () => {
      const input = new Path.Path(":selectiontext:");
      const output = (
        await Variable.applyVariables(input, {
          ...info,
          selectionText: "  padded  ",
        })
      ).finalize();
      expect(output).toBe("padded");
    });

    test("interpolates :naivefilename:", async () => {
      const input = new Path.Path(":naivefilename:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("file.jpg");
    });

    test("interpolates :naivefileext:", async () => {
      const input = new Path.Path(":naivefileext:");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("jpg");
    });

    test("interpolates :fileext: as empty for extensionless filenames", async () => {
      const input = new Path.Path(":fileext:");
      const output = (
        await Variable.applyVariables(input, { ...info, filename: "noext" })
      ).finalize();
      expect(output).toBe("_");
    });

    test("passes through variable tokens without a transformer", async () => {
      // "---" (the menu separator) parses as a variable but has no transformer
      const input = new Path.Path("---");
      const output = (await Variable.applyVariables(input, info)).finalize();
      expect(output).toBe("---");
    });

    test("leaves paths without a parsed buffer alone", async () => {
      const result = await Variable.applyVariables({ buf: undefined }, info);
      expect(result.buf).toBeUndefined();
    });
  });
});

describe("date-name variables (:weekday:, :monthname:, :ampm:, :isoweek:)", () => {
  const interpolate = async (variable, now) => {
    const input = new Path.Path(variable);
    return (await Variable.applyVariables(input, { now })).finalize();
  };

  test(":weekday: and :monthname: are English names", async () => {
    // 2026-07-10 is a Friday
    const now = new Date(2026, 6, 10, 9, 30, 0);
    expect(await interpolate(":weekday:", now)).toBe("friday");
    expect(await interpolate(":monthname:", now)).toBe("july");
  });

  test(":ampm: follows local hours", async () => {
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 0, 0, 0))).toBe("am");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 11, 59, 0))).toBe("am");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 12, 0, 0))).toBe("pm");
    expect(await interpolate(":ampm:", new Date(2026, 6, 10, 23, 0, 0))).toBe("pm");
  });

  test(":isoweek: and :week: are the zero-padded ISO week number", async () => {
    // 2026-01-01 is a Thursday -> ISO week 1
    expect(await interpolate(":isoweek:", new Date(2026, 0, 1))).toBe("01");
    expect(await interpolate(":week:", new Date(2026, 0, 1))).toBe("01");
    // 2021-01-01 is a Friday -> belongs to 2020's ISO week 53
    expect(await interpolate(":isoweek:", new Date(2021, 0, 1))).toBe("53");
    // 2026-07-10 -> ISO week 28
    expect(await interpolate(":isoweek:", new Date(2026, 6, 10))).toBe("28");
    // 2024-12-30 (Monday) -> ISO week 1 of 2025
    expect(await interpolate(":isoweek:", new Date(2024, 11, 30))).toBe("01");
  });
});

describe("page-title slug variables", () => {
  const interpolate = async (variable, title) => {
    const input = new Path.Path(variable);
    return (
      await Variable.applyVariables(input, {
        now: new Date(),
        currentTab: { title },
      })
    ).finalize();
  };

  test(":pagetitleslug: lowercases and dashes punctuation runs", async () => {
    expect(await interpolate(":pagetitleslug:", "My Webpage: Title!")).toBe("my-webpage-title");
  });

  test(":pagetitlesnake: uses underscores", async () => {
    expect(await interpolate(":pagetitlesnake:", "My Webpage: Title!")).toBe("my_webpage_title");
  });

  test("keeps unicode letters and digits", async () => {
    expect(await interpolate(":pagetitleslug:", "Ünïcode 123 – Tïtle")).toBe("ünïcode-123-tïtle");
  });

  test("missing title becomes the replacement char", async () => {
    const input = new Path.Path(":pagetitleslug:");
    const result = (await Variable.applyVariables(input, { now: new Date() })).finalize();
    expect(result).toBe("_");
  });
});

describe("URL-part variables", () => {
  const interpolate = async (variable, url) => {
    const input = new Path.Path(variable);
    return (await Variable.applyVariables(input, { now: new Date(), url })).finalize();
  };

  test(":sourcepath: is the pathname without the leading slash", async () => {
    // Separators inside a variable value are sanitized like any segment
    expect(await interpolate(":sourcepath:", "https://x.com/a/b/pic.jpg")).toBe("a_b_pic.jpg");
  });

  test(":tld: is the last hostname label", async () => {
    expect(await interpolate(":tld:", "https://cdn.example.co.uk/pic.jpg")).toBe("uk");
    expect(await interpolate(":tld:", "https://example.com/pic.jpg")).toBe("com");
  });

  test(":tld: is empty (replacement char) for IPs and single-label hosts", async () => {
    expect(await interpolate(":tld:", "http://192.168.0.1/pic.jpg")).toBe("_");
    expect(await interpolate(":tld:", "http://localhost/pic.jpg")).toBe("_");
  });

  test("invalid URLs fall back to the raw value (withUrl contract)", async () => {
    expect(await interpolate(":tld:", "not a url")).toBe("not a url");
  });
});

describe(":counter: (async, persistent)", () => {
  beforeEach(() => {
    global.Counter = {
      next: vi.fn(() => Promise.resolve(7)),
      peek: vi.fn(() => Promise.resolve(41)),
    };
  });
  afterEach(() => {
    delete global.Counter;
  });

  test("consumes one value and caches it across the whole download", async () => {
    const shared = { now: new Date() };
    const a = (await Variable.applyVariables(new Path.Path("img-:counter:"), shared)).finalize();
    expect(a).toBe("img-7");
    // The same info bag (path then route in one download) reuses the value
    const b = (await Variable.applyVariables(new Path.Path(":counter:/x"), shared)).finalize();
    expect(b).toBe("7/x");
    expect(global.Counter.next).toHaveBeenCalledTimes(1);
  });

  test("preview mode peeks the next value without consuming", async () => {
    const out = (
      await Variable.applyVariables(new Path.Path("n-:counter:"), { preview: true })
    ).finalize();
    expect(out).toBe("n-42"); // peek() 41 + 1
    expect(global.Counter.next).not.toHaveBeenCalled();
    expect(global.Counter.peek).toHaveBeenCalled();
  });
});

describe(":uuid:", () => {
  test("interpolates a random v4 UUID", async () => {
    const out = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("is fresh on each interpolation", async () => {
    const a = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    const b = (await Variable.applyVariables(new Path.Path(":uuid:"), {})).finalize();
    expect(a).not.toBe(b);
  });
});
